import { describe, expect, it } from 'vitest';
import { computeIsSupportedCpu } from '../src/classifier.js';

describe('computeIsSupportedCpu', () => {
  it('returns true on x64 with both avx2 and fma', async () => {
    const ok = await computeIsSupportedCpu({
      arch: 'x64',
      loadCpuFlags: async () => ['sse', 'avx2', 'fma', 'bmi2'],
    });
    expect(ok).toBe(true);
  });

  it('returns false on x64 missing a required flag', async () => {
    expect(await computeIsSupportedCpu({ arch: 'x64', loadCpuFlags: async () => ['avx2'] })).toBe(false);
    expect(await computeIsSupportedCpu({ arch: 'x64', loadCpuFlags: async () => ['fma'] })).toBe(false);
    expect(await computeIsSupportedCpu({ arch: 'x64', loadCpuFlags: async () => [] })).toBe(false);
  });

  it('returns false on x64 when cpu flag lookup fails', async () => {
    const ok = await computeIsSupportedCpu({
      arch: 'x64',
      loadCpuFlags: async () => {
        throw new Error('si failed');
      },
    });
    expect(ok).toBe(false);
  });

  it('returns true on arm64 without checking flags', async () => {
    let called = false;
    const ok = await computeIsSupportedCpu({
      arch: 'arm64',
      loadCpuFlags: async () => {
        called = true;
        return [];
      },
    });
    expect(ok).toBe(true);
    expect(called).toBe(false);
  });

  it('returns false on unsupported architectures', async () => {
    expect(await computeIsSupportedCpu({ arch: 'ia32' })).toBe(false);
    expect(await computeIsSupportedCpu({ arch: 'ppc64' })).toBe(false);
  });
});
