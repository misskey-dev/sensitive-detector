import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { checkImages, HTTP_TIMEOUT_MS } from './check-images.js';

type ContainerInfo = {
  State: { Running: boolean; Status: string; Health?: { Status: string } };
  NetworkSettings: { Ports: Record<string, { HostIp: string; HostPort: string }[] | null | undefined> };
};

/** Require Docker's own HEALTHCHECK, not just a reachable host port. */
export async function waitForContainer(
  inspect: (signal: AbortSignal) => Promise<ContainerInfo>,
  {
    signal,
    startupTimeoutMs = 120_000,
    pollIntervalMs = 250,
  }: { signal?: AbortSignal; startupTimeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<string> {
  const timeout = AbortSignal.timeout(startupTimeoutMs);
  const starting = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    for (;;) {
      starting.throwIfAborted();
      const info = await inspect(starting);
      starting.throwIfAborted();
      assert(info.State.Running, `container stopped: ${info.State.Status}`);
      const health = info.State.Health?.Status;
      assert(health, 'container has no built-in HEALTHCHECK');
      assert(health === 'starting' || health === 'healthy', `container HEALTHCHECK is ${health}`);
      if (health === 'healthy') {
        const ports = info.NetworkSettings.Ports['3009/tcp'];
        const port = ports?.[0];
        assert(
          ports?.length === 1 &&
            port?.HostIp === '127.0.0.1' &&
            /^\d+$/.test(port.HostPort) &&
            Number(port.HostPort) >= 1 &&
            Number(port.HostPort) <= 65535,
          'container must publish port3009 on one ephemeral loopback port',
        );
        return `http://127.0.0.1:${port.HostPort}`;
      }
      await delay(pollIntervalMs, undefined, { signal: starting });
    }
  } catch (error) {
    starting.throwIfAborted(); // Preserve the timeout/caller reason instead of a subprocess AbortError.
    throw error;
  }
}

export async function checkDockerHttp({
  baseUrl,
  apiKey,
  signal,
  requestTimeoutMs = HTTP_TIMEOUT_MS,
}: {
  baseUrl: string;
  apiKey: string;
  signal?: AbortSignal;
  requestTimeoutMs?: number;
}): Promise<void> {
  async function expectStatus(path: string, method: string, expected: number) {
    const timeout = AbortSignal.timeout(requestTimeoutMs);
    const response = await fetch(new URL(path, baseUrl), {
      method,
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    try {
      assert.equal(response.status, expected, `${method} ${path}: expected HTTP ${expected}, got ${response.status}`);
      await response.arrayBuffer(); // The deadline includes the response body.
    } finally {
      await response.body?.cancel().catch(() => {});
    }
  }

  await expectStatus('/health', 'GET', 200);
  await expectStatus('/v1/detect-images', 'POST', 401);
  await checkImages({ baseUrl, apiKey, signal, requestTimeoutMs });
}
