/**
 * items を最大 `limit` 並列で `fn` に通し、結果を**入力順で**返す。
 *
 * 全要素を一斉に走らせる `Promise.all(items.map(...))` と違い、同時に処理中の要素数を `limit` に抑える。
 * detect-images では各パーツの `arrayBuffer()` 実体化・metadata 読み取り・推論待ちが同時に走るのを抑え、
 * 同時メモリ圧（実体化されたバッファ本数）を maxConcurrentJobs 相当に制限するために使う。
 *
 * `fn` が reject した場合は最初のエラーで全体が reject する（fail-fast）。以降は新規 item を取得せず
 * 無駄な処理を始めない（実行中の `fn` は中断できないので走り切る）。`fn` を total に保てば reject しない。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let failed = false;

  const worker = async (): Promise<void> => {
    while (!failed && cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await fn(items[index] as T, index);
      } catch (err) {
        failed = true; // 他 worker に後続 item の取得を止めさせ、最初のエラーを伝播する。
        throw err;
      }
    }
  };

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
