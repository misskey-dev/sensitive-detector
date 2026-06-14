import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../src/lib/concurrency.js';

describe('mapWithConcurrency', () => {
  it('returns results in input order regardless of completion order', async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      // 後ろの要素ほど早く終わらせ、完了順と入力順を意図的にずらす。
      await new Promise((resolve) => setTimeout(resolve, (6 - n) * 2));
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it('never runs more than `limit` tasks at once', async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 10 }, (_, i) => i),
      3,
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 3));
        active -= 1;
      },
    );
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('handles an empty input', async () => {
    expect(await mapWithConcurrency([], 4, async (n) => n)).toEqual([]);
  });

  it('passes the original index to fn', async () => {
    const out = await mapWithConcurrency(['a', 'b', 'c'], 2, async (item, index) => `${index}:${item}`);
    expect(out).toEqual(['0:a', '1:b', '2:c']);
  });

  it('rejects with the first error and stops scheduling new items (fail-fast)', async () => {
    const started: number[] = [];
    await expect(
      mapWithConcurrency(
        Array.from({ length: 10 }, (_, i) => i),
        2,
        async (n) => {
          started.push(n);
          await new Promise((resolve) => setTimeout(resolve, 1));
          if (n === 1) {
            throw new Error('boom');
          }
          return n;
        },
      ),
    ).rejects.toThrow('boom');
    // 2 並列なので 0,1 は着手するが、失敗後に 10 件すべてを着手することはない。
    expect(started.length).toBeLessThan(10);
  });
});
