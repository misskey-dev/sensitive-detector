import type { Classifier } from './classifier.js';
import { DetectError, normalizeUnknownError, toFailedResult } from './errors.js';
import type { InferenceHealth } from './health.js';
import type { Semaphore } from './semaphore.js';
import type { DetectImageResult } from './types.js';

export type DetectContext = {
  classifier: Classifier;
  semaphore: Semaphore;
  requestTimeoutMs: number;
  /** 任意。タイムアウト後も解放されないスロット（hung）を /health に反映するためのトラッカー。 */
  health?: InferenceHealth;
};

/**
 * 正規化済み画像バイトを推論し、生の予測値（または分類済みエラー）を返す。
 *
 * 失敗は throw せず `DetectFailedResult` として返す。
 * タイムアウトは「セマフォ待機の解放＋ DETECTION_FAILED 応答」で表現する。
 * tf の推論自体は中断不能なため、走り出した推論は裏で完了させる（その結果は破棄する）。
 *
 * 設計上の制約: timeout 後も classify が裏で走り続けるため、semaphore slot は classify の
 * 完了まで返らない。slot を timeout 時に強制返却すると maxConcurrentJobs の不変条件が破れる
 * （実際の同時推論数 > maxConcurrentJobs になる）ため、意図的に runExclusive に任せている。
 * hung 発生時は外部ヘルスチェックでプロセスを再起動する運用を推奨する。
 */
export async function detectImage(buffer: Buffer, ctx: DetectContext): Promise<DetectImageResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // タイムアウト発火時にスロットを「詰まり」として記録したか。work 完了時に戻すために覚えておく。
  let markedStuck = false;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      // タイムアウト発火＝この時点で work は未完了。走り出した推論はスロットを保持したまま裏で
      // 走り続ける（or 二度と完了しない）可能性があるため、liveness 判定に「詰まり」を 1 件記録する。
      // 注: スロット未取得（待機キューで abort）の場合も一旦 +1 するが、acquire の reject により
      // 直後の onSettled で -1 され microtask 内で相殺する（saturated を誤って立て続けることはない）。
      if (ctx.health) {
        markedStuck = true;
        ctx.health.markStuck();
      }
      reject(new DetectError('DETECTION_FAILED', `inference timed out after ${ctx.requestTimeoutMs}ms`));
    }, ctx.requestTimeoutMs);
  });

  const work = ctx.semaphore.runExclusive(() => ctx.classifier.classify(buffer), controller.signal);
  // タイムアウトが先に解決した場合に work の遅延 rejection が unhandled にならないよう握りつぶす。
  work.catch(() => undefined);
  // work が（裏で）最終的に解決/失敗したら、記録した「詰まり」を戻して自己回復させる。
  // 永続 hung の場合はここに到達しないため、saturated が立ったまま /health が 503 を返し続ける。
  if (ctx.health) {
    const onSettled = (): void => {
      if (markedStuck) {
        ctx.health?.markResolved();
      }
    };
    work.then(onSettled, onSettled);
  }

  try {
    const result = await Promise.race([work, timeout]);
    if (result.ok) {
      return { success: true, result: { predictions: result.predictions } };
    }
    return toFailedResult(result.code);
  } catch (err) {
    return normalizeUnknownError(err);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
