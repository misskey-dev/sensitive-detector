type Waiter = {
  resolve: (release: () => void) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  abortListener?: () => void;
};

function abortReason(signal: AbortSignal): unknown {
  // AbortController#abort() はデフォルトで AbortError の DOMException を reason に設定する。
  return signal.reason ?? new Error('Aborted');
}

/**
 * FIFO セマフォ。`maxConcurrentJobs` で同時実行を制限する。
 * 待機中に AbortSignal が発火したらキューから除去して reject する。
 */
export class Semaphore {
  private readonly max: number;
  private active = 0;
  private readonly waiters: Waiter[] = [];

  constructor(max: number) {
    if (!Number.isInteger(max) || max < 1) {
      throw new RangeError(`Semaphore concurrency must be a positive integer, got ${max}`);
    }
    this.max = max;
  }

  /** 現在の同時実行数（テスト・診断用）。 */
  get activeCount(): number {
    return this.active;
  }

  /** 待機中の件数（テスト・診断用）。 */
  get pendingCount(): number {
    return this.waiters.length;
  }

  /**
   * スロットを 1 つ取得する。解決値は「解放関数」。必ず一度だけ呼ぶこと（多重呼び出しは無視される）。
   */
  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(abortReason(signal));
    }
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve(this.createRelease());
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal };
      if (signal) {
        waiter.abortListener = () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) {
            this.waiters.splice(index, 1);
            reject(abortReason(signal));
          }
        };
        signal.addEventListener('abort', waiter.abortListener, { once: true });
      }
      this.waiters.push(waiter);
    });
  }

  /**
   * スロットを取得して `fn` を実行し、完了/失敗のいずれでも解放する。
   */
  async runExclusive<T>(fn: () => Promise<T> | T, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.handOffSlot();
    };
  }

  /** 解放されたスロットを次の待機者へ引き継ぐ。待機者がいなければ active を減らす。 */
  private handOffSlot(): void {
    const waiter = this.waiters.shift();
    if (!waiter) {
      this.active -= 1;
      return;
    }
    if (waiter.signal && waiter.abortListener) {
      waiter.signal.removeEventListener('abort', waiter.abortListener);
    }
    // active は引き継ぐため変化させない。
    waiter.resolve(this.createRelease());
  }
}
