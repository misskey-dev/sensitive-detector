import type { DetectErrorCode } from '@misskey-sensitive-detector/core';
import { describe, expect, it } from 'vitest';
import { statusForCode } from '../src/lib/error-mapping.js';

// Record で網羅性をコンパイル時に強制しつつ、実行時にも全コードを照合する。
const EXPECTED: Record<DetectErrorCode, number> = {
  AUTHENTICATION_REQUIRED: 401,
  INVALID_REQUEST: 400,
  UNSUPPORTED_MEDIA_TYPE: 415,
  REQUEST_TOO_LARGE: 413,
  IMAGE_DECODE_FAILED: 422,
  MODEL_UNAVAILABLE: 503,
  DETECTION_FAILED: 500,
};

describe('statusForCode', () => {
  it('maps every DetectErrorCode to the expected HTTP status', () => {
    for (const code of Object.keys(EXPECTED) as DetectErrorCode[]) {
      expect(statusForCode(code)).toBe(EXPECTED[code]);
    }
  });
});
