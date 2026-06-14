import { createHash, timingSafeEqual } from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import { fail } from '../lib/responses.js';
import type { AppDeps, AppEnv } from '../types.js';

function parseBearer(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1];
}

/**
 * 両者を SHA-256 で固定長(32B)に畳んでから timingSafeEqual で比較する。
 * 長さ不一致での早期 return を無くし、トークン長がタイミングから漏れるのを防ぐ。
 */
function safeEqual(a: string, b: string): boolean {
  const ah = createHash('sha256').update(a, 'utf8').digest();
  const bh = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ah, bh);
}

/**
 * config.apiKey が設定されている場合のみ Bearer トークンを要求する。
 * 欠落・不一致はどちらも AUTHENTICATION_REQUIRED（401）。ボディ読み取りより前に実行する。
 */
export function auth(deps: AppDeps) {
  const apiKey = deps.config.apiKey;
  return createMiddleware<AppEnv>(async (c, next) => {
    if (apiKey === undefined) {
      return next();
    }
    const token = parseBearer(c.req.header('authorization'));
    if (token === undefined || !safeEqual(token, apiKey)) {
      return fail(c, 'AUTHENTICATION_REQUIRED', 'missing or invalid bearer token');
    }
    return next();
  });
}
