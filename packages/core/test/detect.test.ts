import { describe, expect, it } from 'vitest';
import type { Classifier, ClassifyResult } from '../src/classifier.js';
import { detectImage } from '../src/detect.js';
import { InferenceHealth } from '../src/health.js';
import { Semaphore } from '../src/semaphore.js';

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

function classifierReturning(result: ClassifyResult): Classifier {
  return { available: true, classify: () => Promise.resolve(result) };
}

const buffer = Buffer.from('not-a-real-image');

describe('detectImage', () => {
  it('returns success with raw predictions when classify succeeds', async () => {
    const predictions = [
      { className: 'Neutral' as const, probability: 0.9 },
      { className: 'Porn' as const, probability: 0.1 },
    ];
    const ctx = {
      classifier: classifierReturning({ ok: true, predictions }),
      semaphore: new Semaphore(2),
      requestTimeoutMs: 1000,
    };
    const result = await detectImage(buffer, ctx);
    expect(result).toEqual({ success: true, result: { predictions } });
  });

  it('maps each classifier error code to a failed result', async () => {
    for (const code of ['IMAGE_DECODE_FAILED', 'DETECTION_FAILED', 'MODEL_UNAVAILABLE'] as const) {
      const ctx = {
        classifier: classifierReturning({ ok: false, code }),
        semaphore: new Semaphore(2),
        requestTimeoutMs: 1000,
      };
      const result = await detectImage(buffer, ctx);
      expect(result).toEqual({ success: false, error: { code, message: code } });
    }
  });

  it('returns DETECTION_FAILED when a thrown error escapes classify', async () => {
    const classifier: Classifier = {
      available: true,
      classify: () => Promise.reject(new Error('kaboom')),
    };
    const result = await detectImage(buffer, {
      classifier,
      semaphore: new Semaphore(2),
      requestTimeoutMs: 1000,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('DETECTION_FAILED');
    }
  });

  it('returns DETECTION_FAILED on timeout when classify never resolves', async () => {
    const classifier: Classifier = {
      available: true,
      classify: () => new Promise<ClassifyResult>(() => undefined),
    };
    const result = await detectImage(buffer, {
      classifier,
      semaphore: new Semaphore(1),
      requestTimeoutMs: 10,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('DETECTION_FAILED');
    }
  });

  it('marks inference health stuck on timeout and self-heals when classify later settles', async () => {
    let resolveClassify: (r: ClassifyResult) => void = () => undefined;
    const classifier: Classifier = {
      available: true,
      classify: () =>
        new Promise<ClassifyResult>((resolve) => {
          resolveClassify = resolve;
        }),
    };
    const health = new InferenceHealth(1);
    const result = await detectImage(buffer, {
      classifier,
      semaphore: new Semaphore(1),
      requestTimeoutMs: 10,
      health,
    });
    expect(result.success).toBe(false);
    // タイムアウト後もスロットを保持＝詰まり 1 件。容量 1 なので saturated。
    expect(health.stuckCount).toBe(1);
    expect(health.saturated).toBe(true);

    // 裏で classify が完了したら詰まりが戻り、自己回復する。
    resolveClassify({ ok: true, predictions: [] });
    await flushMicrotasks();
    expect(health.stuckCount).toBe(0);
    expect(health.saturated).toBe(false);
  });

  it('does not leak stuck count when a queued request is aborted on timeout', async () => {
    // 容量 1。1 件目がスロットを掴んだまま hung、2 件目は queue で待機中にタイムアウト→abort される。
    // queue で abort された 2 件目は markStuck(+1)→work reject→markResolved(-1) で相殺し、リークしない。
    const semaphore = new Semaphore(1);
    const health = new InferenceHealth(1);
    const hung: Classifier = {
      available: true,
      classify: () => new Promise<ClassifyResult>(() => undefined),
    };
    const ctx = { classifier: hung, semaphore, requestTimeoutMs: 10, health };

    const first = detectImage(buffer, ctx); // スロット取得（hung）
    const second = detectImage(buffer, ctx); // queue 待機 → timeout で abort

    expect((await first).success).toBe(false);
    expect((await second).success).toBe(false);
    await flushMicrotasks();

    // hung な 1 件目の分だけが残る。queue abort された 2 件目は相殺されてリークしない。
    expect(health.stuckCount).toBe(1);
  });

  it('does not exceed maxConcurrentJobs after timeout', async () => {
    // classify が永遠に resolve しない hung 状態をシミュレートする。
    // タイムアウト後に semaphore の activeCount が maxConcurrentJobs を超えないことを検証する。
    let classifyCallCount = 0;
    const semaphore = new Semaphore(1);
    const classifier: Classifier = {
      available: true,
      classify: () => {
        classifyCallCount++;
        return new Promise<ClassifyResult>(() => undefined);
      },
    };
    const ctx = { classifier, semaphore, requestTimeoutMs: 10 };

    // 1 件目: hung classify がタイムアウトしても slot を保持したまま。
    const result = await detectImage(buffer, ctx);
    expect(result.success).toBe(false);

    // activeCount は 1 のまま（slot は hung classify が保持）。
    expect(semaphore.activeCount).toBe(1);
    expect(classifyCallCount).toBe(1);

    // 2 件目をすぐに開始すると slot が空かないため pending に積まれる。
    // もし slot が timeout 時に強制返却されていれば classify が 2 回目に呼ばれ、
    // activeCount が 2 になって不変条件が破れる。
    void detectImage(buffer, ctx);
    // マイクロタスクを消化させて pendingCount に反映させる。
    await Promise.resolve();
    expect(semaphore.pendingCount).toBe(1);
    expect(semaphore.activeCount).toBe(1);
    expect(classifyCallCount).toBe(1);
  });
});
