import { createServer, type RequestListener } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDockerHttp, waitForContainer } from '../e2e/check-docker.js';

const ready = {
  State: { Running: true, Status: 'running', Health: { Status: 'healthy' } },
  NetworkSettings: { Ports: { '3009/tcp': [{ HostIp: '127.0.0.1', HostPort: '43210' }] } },
};

describe('Docker E2E readiness', () => {
  it('waits for the built-in HEALTHCHECK before returning the published loopback URL', async () => {
    const states = [
      { ...ready, State: { ...ready.State, Health: { Status: 'starting' } }, NetworkSettings: { Ports: {} } },
      ready,
    ];
    await expect(waitForContainer(async () => states.shift() ?? ready, { pollIntervalMs: 1 })).resolves.toBe(
      'http://127.0.0.1:43210',
    );
  });

  it('fails when the container exits before it becomes healthy', async () => {
    await expect(
      waitForContainer(async () => ({ ...ready, State: { Running: false, Status: 'exited' } })),
    ).rejects.toThrow(/exited/);
  });

  it('fails when the built-in HEALTHCHECK reports unhealthy', async () => {
    await expect(
      waitForContainer(async () => ({ ...ready, State: { ...ready.State, Health: { Status: 'unhealthy' } } })),
    ).rejects.toThrow(/unhealthy/);
  });

  it('fails when the image has no HEALTHCHECK', async () => {
    await expect(
      waitForContainer(async () => ({ ...ready, State: { Running: true, Status: 'running' } })),
    ).rejects.toThrow(/HEALTHCHECK/);
  });

  it.each([{}, { '3009/tcp': null }, { '3009/tcp': [{ HostIp: '0.0.0.0', HostPort: '43210' }] }])(
    'fails when the expected loopback port is not published %#',
    async (Ports) => {
      await expect(waitForContainer(async () => ({ ...ready, NetworkSettings: { Ports } }))).rejects.toThrow(/port/i);
    },
  );

  it('times out when the container stays in starting state', async () => {
    await expect(
      waitForContainer(async () => ({ ...ready, State: { ...ready.State, Health: { Status: 'starting' } } }), {
        startupTimeoutMs: 50,
        pollIntervalMs: 1,
      }),
    ).rejects.toThrow(/timeout/i);
  });

  it('includes a stalled Docker inspect in the startup deadline', async () => {
    await expect(
      waitForContainer(
        async (signal) => {
          await delay(10_000, undefined, { signal });
          return ready;
        },
        { startupTimeoutMs: 50 },
      ),
    ).rejects.toThrow(/timeout/i);
  });

  it('cancels startup when the caller aborts', async () => {
    const controller = new AbortController();
    const check = waitForContainer(
      async (signal) => {
        await delay(10_000, undefined, { signal });
        return ready;
      },
      { signal: controller.signal },
    );
    controller.abort(new Error('caller cancelled Docker E2E'));
    await expect(check).rejects.toThrow(/caller cancelled/);
  });
});

function predictions(winner: string) {
  return ['Drawing', 'Hentai', 'Neutral', 'Porn', 'Sexy'].map((className) => ({
    className,
    probability: className === winner ? 0.96 : 0.01,
  }));
}

describe('Docker E2E HTTP verification', () => {
  let server: ReturnType<typeof createServer> | undefined;
  afterEach(async () => {
    server?.closeAllConnections();
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  async function listen(handler: RequestListener) {
    server = createServer(handler);
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing TCP address');
    return `http://127.0.0.1:${address.port}`;
  }

  function handler({ health = 200, unauthenticated = 401, winner = 'Sexy' } = {}): RequestListener {
    return async (req, res) => {
      if (req.method === 'GET' && req.url === '/health') return void res.writeHead(health).end('ok');
      if (req.method !== 'POST' || req.url !== '/v1/detect-images') return void res.writeHead(404).end();
      if (!req.headers.authorization) return void res.writeHead(unauthenticated).end('unauthenticated');
      if (req.headers.authorization !== 'Bearer docker-e2e-test-key') return void res.writeHead(403).end();
      let received = '';
      for await (const chunk of req) received += chunk.toString('latin1');
      if (!received.includes('neutral-synthetic-cat.png') || !received.includes('sexy-synthetic-swimwear.png')) {
        return void res.writeHead(400).end('both fixtures required');
      }
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          success: true,
          result: {
            results: [
              { success: true, predictions: predictions('Neutral') },
              { success: true, predictions: predictions(winner) },
            ],
          },
        }),
      );
    };
  }

  it('requires health200, unauthenticated401 and authenticated predictions for both real fixtures', async () => {
    const baseUrl = await listen(handler());
    await expect(checkDockerHttp({ baseUrl, apiKey: 'docker-e2e-test-key' })).resolves.toBeUndefined();
  });

  it('rejects a failing health endpoint', async () => {
    const baseUrl = await listen(handler({ health: 503 }));
    await expect(checkDockerHttp({ baseUrl, apiKey: 'docker-e2e-test-key' })).rejects.toThrow(/health.*503/);
  });

  it('rejects inference that accepts a request without authentication', async () => {
    const baseUrl = await listen(handler({ unauthenticated: 200 }));
    await expect(checkDockerHttp({ baseUrl, apiKey: 'docker-e2e-test-key' })).rejects.toThrow(/401.*200/);
  });

  it('rejects the wrong winning class using the shared fixture validator', async () => {
    const baseUrl = await listen(handler({ winner: 'Neutral' }));
    await expect(checkDockerHttp({ baseUrl, apiKey: 'docker-e2e-test-key' })).rejects.toThrow(/expected Sexy/);
  });

  it.each(['/health', '/v1/detect-images'])('times out on a stalled response body from %s', async (path) => {
    const normal = handler();
    const baseUrl = await listen((req, res) => {
      if (req.url !== path) return normal(req, res);
      res.writeHead(path === '/health' ? 200 : 401);
      res.write('body never finishes');
    });
    await expect(checkDockerHttp({ baseUrl, apiKey: 'docker-e2e-test-key', requestTimeoutMs: 50 })).rejects.toThrow(
      /timeout/i,
    );
  });
});
