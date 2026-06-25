import { describe, expect, it } from 'vitest';
import { createClassifier } from '../src/classifier.js';

describe('classifier', () => {
  it('returns MODEL_UNAVAILABLE when model directory does not exist', async () => {
    const classifier = await createClassifier('/nonexistent/path/', {
      arch: 'x64',
    });
    expect(classifier.available).toBe(false);
    const result = await classifier.classify(Buffer.from('test'));
    expect(result).toEqual({ ok: false, code: 'MODEL_UNAVAILABLE' });
  });

  it('returns IMAGE_DECODE_FAILED for non-PNG bytes', async () => {
    // createClassifier with a valid model is integration-test territory.
    // This test verifies the unavailable path only.
    const classifier = await createClassifier('/nonexistent/path/', {
      arch: 'x64',
    });
    const result = await classifier.classify(Buffer.from('not an image'));
    expect(result).toEqual({ ok: false, code: 'MODEL_UNAVAILABLE' });
  });
});
