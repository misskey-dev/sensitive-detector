import { type BatchItemResult, detectImage } from '@misskey-sensitive-detector/core';
import type { Context } from 'hono';
import { mapWithConcurrency } from '../lib/concurrency.js';
import { exceedsImageLimits, readImageDimensions } from '../lib/image-metadata.js';
import type { AppDeps, AppEnv } from '../types.js';

const ACCEPTED_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/bmp']);

function parseContentType(value: string): string {
  return value.split(';')[0]?.trim().toLowerCase() ?? '';
}

/**
 * 1 パーツを検査・推論し BatchItemResult を返す。失敗は throw せず error を格納する。
 * 検査順: 非 File 400 → 非対応 Content-Type 415 → 空 400 → サイズ超過 413 →
 * dimensions 読取失敗 422 → dimensions 上限超過 413 → 推論。
 */
async function classifyPart(value: File | string, deps: AppDeps): Promise<BatchItemResult> {
  if (!(value instanceof File)) {
    return { success: false, error: { code: 'INVALID_REQUEST', message: 'part is not a file' } };
  }

  const partContentType = parseContentType(value.type);
  if (!ACCEPTED_CONTENT_TYPES.has(partContentType)) {
    return {
      success: false,
      error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: `unsupported content-type: ${partContentType || '(none)'}` },
    };
  }

  if (value.size === 0) {
    return { success: false, error: { code: 'INVALID_REQUEST', message: 'part body is empty' } };
  }

  if (value.size > deps.config.maxBinarySize) {
    return {
      success: false,
      error: { code: 'REQUEST_TOO_LARGE', message: `part exceeds ${deps.config.maxBinarySize} bytes` },
    };
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await value.arrayBuffer());
  } catch {
    // パーツ本体の読み取り失敗も throw せず per-part エラーにする（部分成功不変条件: 全体は 200 のまま）。
    return { success: false, error: { code: 'IMAGE_DECODE_FAILED', message: 'failed to read part body' } };
  }

  const dimensions = readImageDimensions(buffer);
  if (dimensions === undefined) {
    return { success: false, error: { code: 'IMAGE_DECODE_FAILED', message: 'failed to read image dimensions' } };
  }

  if (
    exceedsImageLimits(dimensions, {
      maxImageWidth: deps.config.maxImageWidth,
      maxImageHeight: deps.config.maxImageHeight,
      maxImagePixels: deps.config.maxImagePixels,
    })
  ) {
    return {
      success: false,
      error: {
        code: 'REQUEST_TOO_LARGE',
        message: `image dimensions ${dimensions.width}x${dimensions.height} exceed configured limits`,
      },
    };
  }

  const detected = await detectImage(buffer, {
    classifier: deps.classifier,
    semaphore: deps.semaphore,
    requestTimeoutMs: deps.config.requestTimeoutMs,
    health: deps.health,
  });

  if (detected.success) {
    return { success: true, predictions: detected.result.predictions };
  }
  return { success: false, error: { code: detected.error.code, message: detected.error.message } };
}

/**
 * POST /v1/detect-images: multipart/form-data で複数の正規化済み画像を受け取り、各画像の生予測値を返す。
 * フィールド名は任意（順序を保持）。部分成功: 失敗パーツは error を格納し全体は 200 を返す。
 * サイズ制限は各パーツ個別に maxBinarySize で検査する。
 */
export function detectImagesRoute(deps: AppDeps) {
  return async (c: Context<AppEnv>) => {
    const contentType = c.req.header('content-type') ?? '';
    // media type のみで厳密一致（`multipart/form-data; boundary=...` は許可、`multipart/form-dataxxx` は拒否）。
    if (parseContentType(contentType) !== 'multipart/form-data') {
      return c.json(
        {
          success: false as const,
          error: { code: 'UNSUPPORTED_MEDIA_TYPE' as const, message: 'content-type must be multipart/form-data' },
        },
        415,
      );
    }

    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json(
        {
          success: false as const,
          error: { code: 'INVALID_REQUEST' as const, message: 'failed to parse multipart body' },
        },
        400,
      );
    }

    // 注意: maxParts はここ（multipart 全パース後）でしか効かない。パース時のメモリ/CPU を抑える
    // 一次防御は bodyLimit(maxBodySize) が担う。多数の極小パーツは maxBodySize の範囲内で生成され得るため、
    // maxBodySize は maxParts×maxBinarySize + 余白に絞るのが望ましい（不整合は起動時に warn する）。
    const entries = [...formData.entries()];
    if (entries.length === 0) {
      return c.json(
        { success: false as const, error: { code: 'INVALID_REQUEST' as const, message: 'no parts in multipart body' } },
        400,
      );
    }

    if (entries.length > deps.config.maxParts) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'REQUEST_TOO_LARGE' as const,
            message: `too many parts: ${entries.length} exceeds limit of ${deps.config.maxParts}`,
          },
        },
        413,
      );
    }

    const logger = c.get('logger');
    // 同時に実体化されるバッファ本数を maxConcurrentJobs 相当に抑える（推論は core の semaphore が別途律速）。
    // 結果は入力パーツ順で返るため、results[i] とリクエストパーツ i の対応は保たれる。
    const results = await mapWithConcurrency(entries, deps.config.maxConcurrentJobs, async ([, value], index) => {
      let result: BatchItemResult;
      try {
        result = await classifyPart(value, deps);
      } catch (err) {
        // 不変条件防衛: classifyPart は本来 total（throw しない）だが、将来の改変でパーツ処理が想定外に
        // throw すると mapWithConcurrency の fail-fast 経由でバッチ全体が 500 になり、「パーツ単位の失敗で
        // 全体を 4xx/5xx にしない（部分成功は常に 200）」不変条件が破れる。ここで per-part に畳んで防ぐ。
        logger.error({ index, err }, 'unexpected error while classifying part');
        result = {
          success: false,
          error: { code: 'DETECTION_FAILED', message: 'internal error while processing part' },
        };
      }
      if (!result.success) {
        // パーツ失敗は全体 200 のまま results に格納するが、失敗率の急増を運用ログから追えるよう記録する。
        // index はリクエストパーツ順（＝応答 results の順）と一致する。
        logger.warn({ index, code: result.error.code }, 'detect-images part failed');
      }
      return result;
    });

    return c.json({ success: true as const, result: { results } }, 200);
  };
}
