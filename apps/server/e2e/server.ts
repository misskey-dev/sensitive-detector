import { spawn } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { HTTP_TIMEOUT_MS } from './check-images.js';

export const API_KEY = 'e2e-only-api-key-not-a-secret';
const ROOT = new URL('../../../', import.meta.url);

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!address || typeof address === 'string') throw new Error('could not allocate an E2E port');
  return address.port;
}

async function waitForHealth(baseUrl: string, signal: AbortSignal): Promise<void> {
  while (true) {
    signal.throwIfAborted();
    try {
      const response = await fetch(new URL('/health', baseUrl), {
        signal: AbortSignal.any([signal, AbortSignal.timeout(HTTP_TIMEOUT_MS)]),
      });
      await response.body?.cancel();
      if (response.status === 200) return;
    } catch (error) {
      signal.throwIfAborted();
      // Retry refused connections while the model loads; HTTP timeouts are failures.
      if (!(error instanceof TypeError)) throw error;
    }
    try {
      await delay(100, undefined, { signal });
    } catch (error) {
      signal.throwIfAborted();
      throw error;
    }
  }
}

/** Start the built entrypoint with isolated configuration and always reap its process. */
export async function withServer<T>(
  check: (baseUrl: string, signal: AbortSignal) => Promise<T>,
  {
    entry = new URL('../dist/main.mjs', import.meta.url),
    modelDir = fileURLToPath(new URL('nsfw-model/', ROOT)),
    startupTimeoutMs = 120_000,
    signal = new AbortController().signal,
  }: { entry?: URL; modelDir?: string; startupTimeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  signal.throwIfAborted();
  await access(entry);
  await access(join(modelDir, 'nsfw_model.onnx')); // E2E must never skip a missing model.
  const dir = await mkdtemp(join(tmpdir(), 'sensitive-detector-e2e-'));
  try {
    const port = await unusedPort();
    const configPath = join(dir, 'config.mjs');
    await writeFile(
      configPath,
      `export default ${JSON.stringify({ port, host: '127.0.0.1', modelDir, apiKey: API_KEY })};\n`,
    );
    const child = spawn(process.execPath, [fileURLToPath(entry), '--config', configPath], {
      cwd: fileURLToPath(ROOT),
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = new AbortController();
    let logs = '';
    const capture = (chunk: Buffer) => {
      logs = (logs + chunk.toString()).slice(-64 * 1024);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.once('error', (error) => exited.abort(error));
    const closed = new Promise<void>((resolve) => {
      child.once('close', (code, exitSignal) => {
        exited.abort(new Error(`server exited (code ${code}, signal ${exitSignal})`));
        resolve();
      });
    });
    const running = AbortSignal.any([signal, exited.signal]);
    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      await waitForHealth(baseUrl, AbortSignal.any([running, AbortSignal.timeout(startupTimeoutMs)]));
      running.throwIfAborted();
      const result = await check(baseUrl, running);
      running.throwIfAborted();
      return result;
    } catch (error) {
      process.stderr.write(`E2E server logs:\n${logs}\n`);
      throw error;
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      const forceKill = setTimeout(() => child.kill('SIGKILL'), 5_000);
      try {
        await closed;
      } finally {
        clearTimeout(forceKill);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
