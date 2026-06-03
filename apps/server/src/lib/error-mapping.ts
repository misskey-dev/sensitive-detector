import type { DetectErrorCode } from '@misskey-sensitive-detector/core';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * DetectErrorCode → HTTP ステータスの単一表。全コードを網羅する（テストで保証）。
 */
const STATUS_BY_CODE: Record<DetectErrorCode, ContentfulStatusCode> = {
  AUTHENTICATION_REQUIRED: 401,
  INVALID_REQUEST: 400,
  UNSUPPORTED_MEDIA_TYPE: 415,
  REQUEST_TOO_LARGE: 413,
  IMAGE_DECODE_FAILED: 422,
  MODEL_UNAVAILABLE: 503,
  DETECTION_FAILED: 500,
};

export function statusForCode(code: DetectErrorCode): ContentfulStatusCode {
  return STATUS_BY_CODE[code];
}
