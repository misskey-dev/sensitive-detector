import { describe, expect, it, vi } from 'vitest';
import { createClassifier } from '../src/classifier.js';

describe('classifier', () => {
  it('decodes images without expanding GIF animations', async () => {
    const decodedImage = { dispose: vi.fn() };
    const decodeCalls: unknown[][] = [];
    const input = Buffer.from('image bytes');
    const predictions = [{ className: 'Neutral', probability: 1 }];

    const classifier = await createClassifier('/models/', {
      arch: 'arm64',
      loadTfNode: async () =>
        ({
          env: () => ({ global: {} }),
          node: {
            decodeImage: (...args: unknown[]) => {
              decodeCalls.push(args);
              return decodedImage;
            },
          },
        }) as never,
      loadNsfw: async () =>
        ({
          load: async () => ({
            classify: async (image: unknown) => {
              expect(image).toBe(decodedImage);
              return predictions;
            },
          }),
        }) as never,
    });

    const result = await classifier.classify(input);

    expect(result).toEqual({ ok: true, predictions });
    expect(decodeCalls).toEqual([[input, 3, 'int32', false]]);
    expect(decodedImage.dispose).toHaveBeenCalledOnce();
  });
});
