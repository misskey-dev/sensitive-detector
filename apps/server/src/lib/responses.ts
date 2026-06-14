import type { DetectErrorCode } from '@misskey-sensitive-detector/core';
import type { Context } from 'hono';
import type { AppEnv } from '../types.js';
import { statusForCode } from './error-mapping.js';

/**
 * リクエスト全体の失敗レスポンス。code から HTTP ステータスを引く。message は診断用（契約外）。
 * 成功・部分成功のバッチ応答（{ result: { results } }）は detect-images ルートが直接組み立てる。
 */
export function fail(c: Context<AppEnv>, code: DetectErrorCode, message?: string) {
  return c.json({ success: false as const, error: { code, message: message ?? code } }, statusForCode(code));
}
