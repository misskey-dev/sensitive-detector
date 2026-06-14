import { beforeAll, describe, expect, it } from 'vitest';
import { type Classifier, createClassifier } from '../src/classifier.js';
import { integrationEnabled, TEST_MODEL_DIR } from './helpers/integration-guard.js';
import { encodeRgbPng } from './helpers/png.js';

const NSFW_CLASS_NAMES = ['Drawing', 'Hentai', 'Neutral', 'Porn', 'Sexy'];

const d = (await integrationEnabled()) ? describe : describe.skip;

d('classifier (real nsfwjs model)', () => {
  let classifier: Classifier;

  beforeAll(async () => {
    // 実モデルを file:// 経路でロードする（参照: AiService.ts:53）。
    classifier = await createClassifier(TEST_MODEL_DIR);
  });

  it('loads the model and reports availability', () => {
    expect(classifier.available).toBe(true);
  });

  it('classifies a normalized 299x299 PNG into the five NSFW classes', async () => {
    const png = encodeRgbPng(299, 299, [119, 119, 119]);
    const result = await classifier.classify(png);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.predictions).toHaveLength(5);
    expect([...result.predictions.map((p) => p.className)].sort()).toEqual(NSFW_CLASS_NAMES);
    for (const prediction of result.predictions) {
      expect(prediction.probability).toBeGreaterThanOrEqual(0);
      expect(prediction.probability).toBeLessThanOrEqual(1);
    }
    const sum = result.predictions.reduce((acc, p) => acc + p.probability, 0);
    expect(sum).toBeCloseTo(1, 1);
  });

  it('returns IMAGE_DECODE_FAILED for corrupt (non-image) bytes', async () => {
    const result = await classifier.classify(Buffer.from('this is definitely not an image'));
    expect(result).toEqual({ ok: false, code: 'IMAGE_DECODE_FAILED' });
  });
});
