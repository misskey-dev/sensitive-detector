import { InferenceHealth } from '@misskey-sensitive-detector/core';
import { describe, expect, it } from 'vitest';
import { encodeRgbPng } from '../../../packages/core/test/helpers/png.js';
import { buildTestApp, mockClassifier, postImages } from './helpers/test-app.js';

const png = encodeRgbPng(8, 8, [119, 119, 119]);
const pngPart = { data: png, contentType: 'image/png' };

describe('POST /v1/detect-images', () => {
  it('returns 200 with results array for a single image', async () => {
    const app = buildTestApp();
    const res = await postImages(app, [pngPart]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; result: { results: unknown[] } };
    expect(body.success).toBe(true);
    expect(body.result.results).toHaveLength(1);
    const results = body.result.results as { success: boolean; predictions: unknown[] }[];
    expect(results[0]?.success).toBe(true);
  });

  it('returns 200 with results array for multiple images', async () => {
    const app = buildTestApp();
    const res = await postImages(app, [pngPart, pngPart]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { results: unknown[] } };
    expect(body.result.results).toHaveLength(2);
  });

  it('returns 415 when content-type is not multipart/form-data', async () => {
    const app = buildTestApp();
    const res = await app.request('/v1/detect-images', {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: png,
    });
    expect(res.status).toBe(415);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('returns 415 for a content-type that only prefixes multipart/form-data', async () => {
    const app = buildTestApp();
    const res = await app.request('/v1/detect-images', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-dataxxx' },
      body: png,
    });
    expect(res.status).toBe(415);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('returns 400 when no parts are provided', async () => {
    const app = buildTestApp();
    const res = await app.request('/v1/detect-images', { method: 'POST', body: new FormData() });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('returns partial success with UNSUPPORTED_MEDIA_TYPE for bad content-type part', async () => {
    const app = buildTestApp();
    const res = await postImages(app, [pngPart, { data: png, contentType: 'text/plain' }]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { results: { success: boolean; error?: { code: string } }[] };
    };
    expect(body.result.results[0]?.success).toBe(true);
    expect(body.result.results[1]?.success).toBe(false);
    expect(body.result.results[1]?.error?.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('preserves part order across the concurrency limit (parts > maxConcurrentJobs)', async () => {
    // maxConcurrentJobs=2 < 5 パーツ。index 2 だけ非対応 Content-Type。
    // mapWithConcurrency 経由でも results[i] とパーツ i の対応（順序）が保たれることを検証する。
    const app = buildTestApp({ config: { maxConcurrentJobs: 2 } });
    const parts = [pngPart, pngPart, { data: png, contentType: 'text/plain' }, pngPart, pngPart];
    const res = await postImages(app, parts);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { results: { success: boolean; error?: { code: string } }[] };
    };
    const results = body.result.results;
    expect(results).toHaveLength(5);
    expect(results.map((r) => r.success)).toEqual([true, true, false, true, true]);
    expect(results[2]?.error?.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('accepts image/jpeg, image/gif, image/bmp', async () => {
    const app = buildTestApp();
    for (const contentType of ['image/jpeg', 'image/gif', 'image/bmp']) {
      const res = await postImages(app, [{ data: png, contentType }]);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { result: { results: { success: boolean }[] } };
      expect(body.result.results[0]?.success).toBe(true);
    }
  });

  it('propagates classifier error codes into per-part results', async () => {
    const cases = [
      { code: 'IMAGE_DECODE_FAILED' },
      { code: 'MODEL_UNAVAILABLE' },
      { code: 'DETECTION_FAILED' },
    ] as const;
    for (const { code } of cases) {
      const app = buildTestApp({ classifier: mockClassifier({ ok: false, code }) });
      const res = await postImages(app, [pngPart]);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        result: { results: { success: boolean; error?: { code: string } }[] };
      };
      expect(body.result.results[0]?.success).toBe(false);
      expect(body.result.results[0]?.error?.code).toBe(code);
    }
  });

  it('returns per-part REQUEST_TOO_LARGE when a part exceeds maxBinarySize', async () => {
    const app = buildTestApp({ config: { maxBinarySize: 4 } });
    const res = await postImages(app, [{ data: new Uint8Array(5).fill(1), contentType: 'image/png' }]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { results: { success: boolean; error?: { code: string } }[] };
    };
    expect(body.result.results[0]?.success).toBe(false);
    expect(body.result.results[0]?.error?.code).toBe('REQUEST_TOO_LARGE');
  });

  it('accepts a part up to the size limit', async () => {
    const app = buildTestApp({ config: { maxBinarySize: png.length } });
    const res = await postImages(app, [pngPart]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { results: { success: boolean }[] } };
    expect(body.result.results[0]?.success).toBe(true);
  });

  it('rejects a part when decoded image dimensions exceed configured limits', async () => {
    const app = buildTestApp({ config: { maxImageWidth: 16, maxImageHeight: 16, maxImagePixels: 256 } });
    const res = await postImages(app, [{ data: encodeRgbPng(17, 16, [119, 119, 119]), contentType: 'image/png' }]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { results: { success: boolean; error?: { code: string } }[] };
    };
    expect(body.result.results[0]?.success).toBe(false);
    expect(body.result.results[0]?.error?.code).toBe('REQUEST_TOO_LARGE');
  });
});

describe('authentication', () => {
  const apiKey = 'super-secret-token';
  const withAuth = () => buildTestApp({ config: { apiKey } });

  it('passes through when no apiKey is configured', async () => {
    const res = await postImages(buildTestApp(), [pngPart]);
    expect(res.status).toBe(200);
  });

  it('rejects a missing Authorization header with 401', async () => {
    const res = await postImages(withAuth(), [pngPart]);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('rejects a wrong token with 401', async () => {
    const res = await postImages(withAuth(), [pngPart], { authorization: 'Bearer wrong-token' });
    expect(res.status).toBe(401);
  });

  it('accepts the correct bearer token', async () => {
    const res = await postImages(withAuth(), [pngPart], { authorization: `Bearer ${apiKey}` });
    expect(res.status).toBe(200);
  });
});

describe('GET /health', () => {
  it('returns 200 ok when the model is available', async () => {
    const res = await buildTestApp().request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('returns 503 unavailable with reason model_unavailable when the model is not loaded', async () => {
    const unavailable = mockClassifier({ ok: false, code: 'MODEL_UNAVAILABLE' }, false);
    const res = await buildTestApp({ classifier: unavailable }).request('/health');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; reason?: string };
    expect(body.status).toBe('unavailable');
    expect(body.reason).toBe('model_unavailable');
  });

  it('returns 503 unavailable with reason inference_saturated when all slots are stuck', async () => {
    const health = new InferenceHealth(1);
    health.markStuck(); // 容量 1 が hung で詰まった状態を再現。
    const res = await buildTestApp({ health }).request('/health');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; reason?: string };
    expect(body.status).toBe('unavailable');
    expect(body.reason).toBe('inference_saturated');
  });

  it('does not require authentication even when apiKey is configured', async () => {
    const res = await buildTestApp({ config: { apiKey: 'super-secret-token' } }).request('/health');
    expect(res.status).toBe(200);
  });
});

describe('unknown routes', () => {
  it('returns 400 INVALID_REQUEST for unmatched routes', async () => {
    const res = await buildTestApp().request('/nope');
    expect(res.status).toBe(400);
  });
});

describe('request correlation id', () => {
  it('echoes a valid inbound x-request-id back on the response', async () => {
    const res = await postImages(buildTestApp(), [pngPart], { 'x-request-id': 'misskey-abc.123_DEF' });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBe('misskey-abc.123_DEF');
  });

  it('generates a request id when the inbound header is missing', async () => {
    const res = await postImages(buildTestApp(), [pngPart]);
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('ignores a malformed inbound x-request-id and generates its own', async () => {
    const res = await postImages(buildTestApp(), [pngPart], { 'x-request-id': 'bad id with spaces!' });
    const echoed = res.headers.get('x-request-id');
    expect(echoed).not.toBe('bad id with spaces!');
    expect(echoed).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('stamps x-request-id on error responses too', async () => {
    const res = await buildTestApp().request('/nope', { headers: { 'x-request-id': 'corr-1' } });
    expect(res.status).toBe(400);
    expect(res.headers.get('x-request-id')).toBe('corr-1');
  });
});

describe('request size limits', () => {
  it('returns 413 when parts exceed maxParts', async () => {
    const app = buildTestApp({ config: { maxParts: 2 } });
    const res = await postImages(app, [pngPart, pngPart, pngPart]);
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('REQUEST_TOO_LARGE');
  });

  it('accepts exactly maxParts parts', async () => {
    const app = buildTestApp({ config: { maxParts: 2 } });
    const res = await postImages(app, [pngPart, pngPart]);
    expect(res.status).toBe(200);
  });

  it('returns 413 when body exceeds maxBodySize', async () => {
    // maxBodySize を小さくして multipart boundary 込みで確実に超えさせる。
    const app = buildTestApp({ config: { maxBodySize: 10 } });
    const res = await postImages(app, [pngPart]);
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('REQUEST_TOO_LARGE');
  });
});
