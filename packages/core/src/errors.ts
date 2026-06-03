import type { DetectErrorCode, DetectFailedResult } from './types.js';

/**
 * 分類済みの検出エラー。`code` で失敗種別を保持する。
 */
export class DetectError extends Error {
  readonly code: DetectErrorCode;

  constructor(code: DetectErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'DetectError';
    this.code = code;
  }
}

export function isDetectError(value: unknown): value is DetectError {
  return value instanceof DetectError;
}

export function toFailedResult(code: DetectErrorCode, message?: string): DetectFailedResult {
  return { success: false, error: { code, message: message ?? code } };
}

/**
 * 未分類の例外を `DETECTION_FAILED` に畳む。`DetectError` はその code を保つ。
 */
export function normalizeUnknownError(value: unknown): DetectFailedResult {
  if (isDetectError(value)) {
    return toFailedResult(value.code, value.message);
  }
  const message = value instanceof Error ? value.message : String(value);
  return toFailedResult('DETECTION_FAILED', message);
}
