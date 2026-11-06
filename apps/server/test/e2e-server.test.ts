import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withServer } from '../e2e/server.js';

// A real child process isolates lifecycle failures from expensive ONNX inference.
describe('E2E server lifecycle', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'e2e-lifecycle-test-'));
    await writeFile(join(dir, 'nsfw_model.onnx'), 'model presence sentinel');
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function entry(body: string) {
    const file = join(dir, 'server.mjs');
    await writeFile(
      file,
      `import {writeFileSync} from 'node:fs';
       writeFileSync(${JSON.stringify(join(dir, 'pid'))}, String(process.pid));
       ${body}`,
    );
    return pathToFileURL(file);
  }
  const healthy = `
    import {createServer} from 'node:http';
    const {default: config} = await import(process.argv[3]);
    createServer((req, res) => res.end('ok')).listen(config.port, config.host, () => {
      console.log(JSON.stringify({msg: 'listening on http://' + config.host + ':' + config.port}));
    });
  `;
  async function expectChildStopped() {
    const pid = Number(await readFile(join(dir, 'pid'), 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow(/ESRCH/);
  }

  it('stops the server after a successful check', async () => {
    await withServer(async () => {}, { entry: await entry(healthy), modelDir: dir });
    await expectChildStopped();
  });

  it('stops the server after an assertion failure', async () => {
    await expect(
      withServer(
        async () => {
          throw new Error('wrong prediction');
        },
        { entry: await entry(healthy), modelDir: dir },
      ),
    ).rejects.toThrow('wrong prediction');
    await expectChildStopped();
  });

  it('fails and stops a server that never becomes healthy', async () => {
    await expect(
      withServer(async () => {}, {
        entry: await entry('setInterval(() => {}, 1000);'),
        modelDir: dir,
        startupTimeoutMs: 1_000,
      }),
    ).rejects.toThrow(/timeout/i);
    await expectChildStopped();
  });

  it('bounds a stalled health response by the startup deadline', async () => {
    await expect(
      withServer(async () => {}, {
        entry: await entry(healthy.replace("res.end('ok')", "{ res.writeHead(503); res.write('unavailable'); }")),
        modelDir: dir,
        startupTimeoutMs: 1_000,
      }),
    ).rejects.toThrow(/timeout/i);
    await expectChildStopped();
  });

  it('reports an early server exit without waiting for startup timeout', async () => {
    await expect(withServer(async () => {}, { entry: await entry('process.exit(7);'), modelDir: dir })).rejects.toThrow(
      /exited.*7/,
    );
    await expectChildStopped();
  });

  it('stops the server when the caller cancels an active check', async () => {
    const controller = new AbortController();
    await expect(
      withServer(
        async (_url, signal) => {
          controller.abort(new Error('cancelled test'));
          signal.throwIfAborted();
        },
        { entry: await entry(healthy), modelDir: dir, signal: controller.signal },
      ),
    ).rejects.toThrow('cancelled test');
    await expectChildStopped();
  });

  it('rejects a missing model without starting the server', async () => {
    const options = { entry: await entry(healthy), modelDir: join(dir, 'missing') };
    await expect(withServer(async () => {}, options)).rejects.toThrow(/ENOENT/);
    await expect(readFile(join(dir, 'pid'))).rejects.toThrow(/ENOENT/);
  });

  it('does not accept a healthy competing listener before its own child binds', async () => {
    const competing = createServer((_req, res) => res.end('ok'));
    const portFile = join(dir, 'port');
    const selectedEntry = await entry(`
      const {default: config} = await import(process.argv[3]);
      writeFileSync(${JSON.stringify(portFile)}, String(config.port));
      setInterval(() => {}, 1000);
    `);
    const checked = withServer(async () => {}, { entry: selectedEntry, modelDir: dir, startupTimeoutMs: 2_000 });
    const rejected = expect(checked).rejects.toThrow(/timeout/i);
    try {
      let port = 0;
      for (let attempt = 0; attempt < 100 && !port; attempt++) {
        port = Number(await readFile(portFile, 'utf8').catch(() => '0'));
        if (!port) await delay(10);
      }
      expect(port).toBeGreaterThan(0);
      await new Promise<void>((resolve, reject) => {
        competing.once('error', reject);
        competing.listen(port, '127.0.0.1', resolve);
      });
      await rejected;
      await expectChildStopped();
    } finally {
      competing.closeAllConnections();
      await new Promise<void>((resolve) => competing.close(() => resolve()));
      await checked.catch(() => {});
    }
  });
});
