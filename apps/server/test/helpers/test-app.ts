import {
  type Classifier,
  type ClassifyResult,
  InferenceHealth,
  type ResolvedConfig,
  Semaphore,
} from '@misskey-sensitive-detector/core';
import { type Logger, pino } from 'pino';
import { createApp } from '../../src/app.js';
import type { AppDeps } from '../../src/types.js';

type TestOverrides = {
  config?: Partial<ResolvedConfig>;
  classifier?: Classifier;
  semaphore?: Semaphore;
  health?: InferenceHealth;
  logger?: Logger;
};

export const silentLogger = pino({ level: 'silent' });

export function mockClassifier(result: ClassifyResult, available = true): Classifier {
  return { available, classify: () => Promise.resolve(result) };
}

const okClassifier = mockClassifier({
  ok: true,
  predictions: [
    { className: 'Neutral', probability: 0.95 },
    { className: 'Drawing', probability: 0.03 },
    { className: 'Sexy', probability: 0.01 },
    { className: 'Hentai', probability: 0.005 },
    { className: 'Porn', probability: 0.005 },
  ],
});

export function buildTestApp(overrides: TestOverrides = {}) {
  const config: ResolvedConfig = {
    listen: { kind: 'port', port: 0, host: '127.0.0.1' },
    modelDir: '/models/',
    allowUnauthenticatedTcp: true,
    maxBinarySize: 1024,
    maxImageWidth: 299,
    maxImageHeight: 299,
    maxImagePixels: 299 * 299,
    maxParts: 10,
    maxBodySize: 10 * 1024 * 1024,
    maxConcurrentJobs: 2,
    requestTimeoutMs: 1_000,
    ...overrides.config,
  };
  const deps: AppDeps = {
    config,
    classifier: overrides.classifier ?? okClassifier,
    semaphore: overrides.semaphore ?? new Semaphore(config.maxConcurrentJobs),
    health: overrides.health ?? new InferenceHealth(config.maxConcurrentJobs),
    logger: overrides.logger ?? silentLogger,
  };
  return createApp(deps);
}

/** multipart/form-data として複数の画像パーツを POST する。 */
export function postImages(
  app: ReturnType<typeof createApp>,
  parts: { data: Uint8Array; contentType: string }[],
  extraHeaders: Record<string, string> = {},
) {
  const form = new FormData();
  for (const [i, part] of parts.entries()) {
    form.append(`image${i}`, new File([part.data], `image${i}`, { type: part.contentType }));
  }
  return app.request('/v1/detect-images', { method: 'POST', headers: extraHeaders, body: form });
}
