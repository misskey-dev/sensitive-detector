import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { checkDockerHttp, waitForContainer } from './check-docker.js';
import { HTTP_TIMEOUT_MS } from './check-images.js';
import { withSignals } from './signals.js';

const exec = promisify(execFile);

try {
  const [, , containerName, ...extra] = process.argv;
  const apiKey = process.env.SENSITIVE_DETECTOR_API_KEY;
  assert(containerName && extra.length === 0, 'usage: pnpm test:e2e:docker <container-name>');
  assert(apiKey, 'SENSITIVE_DETECTOR_API_KEY is required');
  await withSignals(async (signal) => {
    const baseUrl = await waitForContainer(
      async (starting) => {
        const { stdout } = await exec('docker', ['inspect', '--format', '{{json .}}', containerName], {
          signal: starting,
          timeout: HTTP_TIMEOUT_MS,
          killSignal: 'SIGKILL',
        });
        return JSON.parse(stdout);
      },
      { signal },
    );
    await checkDockerHttp({ baseUrl, apiKey, signal });
  });
  console.log('Docker E2E passed: healthy, HTTP200/401, Neutral and Sexy fixture predictions.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
