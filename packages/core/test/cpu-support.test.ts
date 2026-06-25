import { describe, expect, it } from 'vitest';
import { computeIsSupportedCpu } from '../src/classifier.js';

describe('computeIsSupportedCpu', () => {
  it('returns true on x64', async () => {
    expect(await computeIsSupportedCpu('x64')).toBe(true);
  });

  it('returns true on arm64', async () => {
    expect(await computeIsSupportedCpu('arm64')).toBe(true);
  });

  it('returns false on unsupported architectures', async () => {
    expect(await computeIsSupportedCpu('ia32')).toBe(false);
    expect(await computeIsSupportedCpu('ppc64')).toBe(false);
  });
});
