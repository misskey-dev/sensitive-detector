import { createServer, type RequestListener } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { assertPredictions, checkImages, FIXTURES } from '../e2e/check-images.js';

const predictions = [
  { className: 'Neutral', probability: 0.9 },
  { className: 'Drawing', probability: 0.04 },
  { className: 'Hentai', probability: 0.03 },
  { className: 'Porn', probability: 0.02 },
  { className: 'Sexy', probability: 0.01 },
];
const fixture = { file: FIXTURES[0].file, expectedClass: 'Neutral' as const };
const response = (values: unknown = predictions) => ({
  success: true,
  result: { results: [{ success: true, predictions: values }] },
});

describe('E2E prediction assertions', () => {
  it('accepts valid predictions regardless of response order', () => {
    expect(() => assertPredictions(response([...predictions].reverse()), [fixture])).not.toThrow();
  });

  it('rejects a prediction of the wrong class', () => {
    expect(() => assertPredictions(response(), [{ ...fixture, expectedClass: 'Sexy' }])).toThrow(/expected Sexy/);
  });

  it.each([NaN, Infinity, -0.01, 1.01, '0.9', null])('rejects invalid probability %s', (probability) => {
    expect(() =>
      assertPredictions(response([{ className: 'Neutral', probability }, ...predictions.slice(1)]), [fixture]),
    ).toThrow(/probability/);
  });

  it('rejects ties for the highest probability', () => {
    expect(() =>
      assertPredictions(response([{ ...predictions[0], probability: 0.04 }, ...predictions.slice(1)]), [fixture]),
    ).toThrow(/expected Neutral/);
  });

  it.each([
    undefined,
    { success: false },
    { success: true, result: { results: [] } },
    { success: true, result: { results: [{ success: false }] } },
    response(predictions.slice(1)),
    response([...predictions.slice(0, 4), predictions[0]]),
    response([...predictions.slice(0, 4), { className: 'Unknown', probability: 0.01 }]),
  ])('rejects malformed, partial, or failed results %#', (body) => {
    expect(() => assertPredictions(body, [fixture])).toThrow();
  });
});

describe('E2E HTTP checks', () => {
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

  it('sends the real fixture as multipart with bearer authentication', async () => {
    let received = '';
    let authorization: string | undefined;
    let contentType: string | undefined;
    const baseUrl = await listen(async (req, res) => {
      authorization = req.headers.authorization;
      contentType = req.headers['content-type'];
      for await (const chunk of req) received += chunk.toString('latin1');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(response()));
    });
    await checkImages({ baseUrl, apiKey: 'test-api-key', fixtures: [fixture] });
    expect(authorization).toBe('Bearer test-api-key');
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(received).toContain('neutral-synthetic-cat.png');
    expect(received).toContain('\x89PNG\r\n\x1a\n');
  });

  it('fails for a missing image instead of skipping it', async () => {
    await expect(
      checkImages({
        baseUrl: 'http://127.0.0.1:1',
        apiKey: 'test',
        fixtures: [{ ...fixture, file: new URL('file:///missing-e2e-image.png') }],
      }),
    ).rejects.toThrow(/ENOENT/);
  });

  it('fails on an HTTP error', async () => {
    const baseUrl = await listen((_req, res) => {
      res.writeHead(401).end();
    });
    await expect(checkImages({ baseUrl, apiKey: 'test', fixtures: [fixture] })).rejects.toThrow(/401/);
  });

  it('times out even when headers arrive but the response body stalls', async () => {
    const baseUrl = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{');
    });
    await expect(checkImages({ baseUrl, apiKey: 'test', fixtures: [fixture], requestTimeoutMs: 50 })).rejects.toThrow(
      /timeout/i,
    );
  });
});
