import { serve } from '@hono/node-server';
import { createClassifier, InferenceHealth, type ResolvedConfig, Semaphore } from '@misskey-sensitive-detector/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integrationEnabled, TEST_MODEL_DIR } from '../../../packages/core/test/helpers/integration-guard.js';
import { encodeRgbPng } from '../../../packages/core/test/helpers/png.js';
import { createApp } from '../src/app.js';
import { silentLogger } from './helpers/test-app.js';

const API_KEY = 'integration-test-key';

const d = (await integrationEnabled()) ? describe : describe.skip;

d('POST /v1/detect-images (real model, real HTTP server)', () => {
  let server: ReturnType<typeof serve> | undefined;
  let baseUrl = '';

  beforeAll(async () => {
    const classifier = await createClassifier(TEST_MODEL_DIR, { logger: silentLogger });
    const config: ResolvedConfig = {
      listen: { kind: 'port', port: 0, host: '127.0.0.1' },
      modelDir: TEST_MODEL_DIR,
      apiKey: API_KEY,
      allowUnauthenticatedTcp: false,
      maxBinarySize: 1_048_576,
      maxImageWidth: 299,
      maxImageHeight: 299,
      maxImagePixels: 299 * 299,
      maxParts: 10,
      maxBodySize: 12_582_912,
      maxConcurrentJobs: 2,
      requestTimeoutMs: 60_000,
    };
    const app = createApp({
      config,
      classifier,
      semaphore: new Semaphore(config.maxConcurrentJobs),
      health: new InferenceHealth(config.maxConcurrentJobs),
      logger: silentLogger,
    });

    const port = await new Promise<number>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0 }, (info) => resolve(info.port));
    });
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    server?.close();
  });

  function buildForm(parts: { data: Uint8Array; contentType: string }[]): FormData {
    const form = new FormData();
    for (const [i, part] of parts.entries()) {
      form.append(`image${i}`, new File([part.data], `image${i}`, { type: part.contentType }));
    }
    return form;
  }

  const authedPost = (form: FormData) =>
    fetch(`${baseUrl}/v1/detect-images`, {
      method: 'POST',
      headers: { authorization: `Bearer ${API_KEY}` },
      body: form,
    });

  it('returns 200 with five predictions per image for two normalized PNGs', async () => {
    const png = encodeRgbPng(299, 299, [119, 119, 119]);
    const res = await authedPost(
      buildForm([
        { data: png, contentType: 'image/png' },
        { data: png, contentType: 'image/png' },
      ]),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      result: { results: { success: boolean; predictions: { className: string; probability: number }[] }[] };
    };
    expect(body.success).toBe(true);
    expect(body.result.results).toHaveLength(2);
    for (const r of body.result.results) {
      expect(r.success).toBe(true);
      expect(r.predictions).toHaveLength(5);
      expect([...r.predictions.map((p) => p.className)].sort()).toEqual([
        'Drawing',
        'Hentai',
        'Neutral',
        'Porn',
        'Sexy',
      ]);
    }
  });

  it('returns partial success when one part has corrupt image bytes', async () => {
    const png = encodeRgbPng(299, 299, [119, 119, 119]);
    const res = await authedPost(
      buildForm([
        { data: png, contentType: 'image/png' },
        { data: Buffer.from('not an image'), contentType: 'image/png' },
      ]),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { results: { success: boolean; error?: { code: string } }[] };
    };
    expect(body.result.results[0]?.success).toBe(true);
    expect(body.result.results[1]?.success).toBe(false);
    expect(body.result.results[1]?.error?.code).toBe('IMAGE_DECODE_FAILED');
  });

  it('returns 401 without a bearer token', async () => {
    const png = encodeRgbPng(8, 8, [119, 119, 119]);
    const res = await fetch(`${baseUrl}/v1/detect-images`, {
      method: 'POST',
      body: buildForm([{ data: png, contentType: 'image/png' }]),
    });
    expect(res.status).toBe(401);
  });
});
