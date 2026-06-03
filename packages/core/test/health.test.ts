import { describe, expect, it } from 'vitest';
import { InferenceHealth, SaturationMonitor } from '../src/health.js';

describe('InferenceHealth', () => {
  it('counts stuck slots and reports saturated at capacity', () => {
    const h = new InferenceHealth(2);
    expect(h.stuckCount).toBe(0);
    expect(h.saturated).toBe(false);

    h.markStuck();
    expect(h.stuckCount).toBe(1);
    expect(h.saturated).toBe(false); // 1/2 はまだ余力あり

    h.markStuck();
    expect(h.stuckCount).toBe(2);
    expect(h.saturated).toBe(true); // 全スロット詰まり

    h.markResolved();
    expect(h.stuckCount).toBe(1);
    expect(h.saturated).toBe(false); // 自己回復
  });

  it('never decrements below zero', () => {
    const h = new InferenceHealth(1);
    h.markResolved();
    h.markResolved();
    expect(h.stuckCount).toBe(0);
  });
});

describe('SaturationMonitor', () => {
  it('signals exit only after threshold consecutive saturated observations', () => {
    const m = new SaturationMonitor(3);
    expect(m.observe(true)).toBe(false);
    expect(m.observe(true)).toBe(false);
    expect(m.consecutiveCount).toBe(2);
    expect(m.observe(true)).toBe(true); // 3 回連続で exit 判定
  });

  it('resets the consecutive count when an observation is not saturated', () => {
    const m = new SaturationMonitor(2);
    expect(m.observe(true)).toBe(false);
    expect(m.observe(false)).toBe(false); // 一過性なのでリセット
    expect(m.consecutiveCount).toBe(0);
    expect(m.observe(true)).toBe(false); // 1 回目から数え直し
    expect(m.observe(true)).toBe(true);
  });

  it('rejects a non-positive threshold', () => {
    expect(() => new SaturationMonitor(0)).toThrow(RangeError);
    expect(() => new SaturationMonitor(1.5)).toThrow(RangeError);
  });
});
