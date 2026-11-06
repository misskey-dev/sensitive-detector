import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { expect, it } from 'vitest';

it.each([
  ['SIGINT', false],
  ['SIGTERM', false],
  ['SIGINT', true],
  ['SIGTERM', true],
] as const)('finishes cleanup and fails after %s during teardown (repeated: %s)', async (signal, repeated) => {
  const moduleUrl = new URL('../e2e/signals.ts', import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      `import {withSignals} from ${JSON.stringify(moduleUrl)};
       try {
         await withSignals(async signal => {
           const finishCleanup = new Promise(resolve => process.once('message', resolve));
           signal.addEventListener('abort', () => console.log('interrupted'), {once:true});
           console.log('ready');
           console.log('cleaning');
           await finishCleanup;
           console.log('cleaned');
         });
       } catch { process.exitCode = 1; }
       finally { process.disconnect(); }`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );
  const stdout = child.stdout;
  assert(stdout, 'child stdout must be piped');
  const closed = once(child, 'close');
  let output = '';
  const waitFor = (marker: string) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`child never reported ${marker}: ${output}`)), 3_000);
      const inspect = () => {
        if (output.includes(marker)) {
          clearTimeout(timer);
          stdout.off('data', inspect);
          resolve();
        }
      };
      stdout.on('data', inspect);
      inspect();
    });
  stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  try {
    await waitFor('ready');
    child.kill(signal);
    await waitFor('interrupted');
    if (repeated) child.kill(signal);
    child.send('finish cleanup', () => {});
    const [code, exitSignal] = await closed;
    expect(exitSignal).toBe(null);
    expect(code).toBe(1);
    expect(output).toContain('cleaned');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  }
});
