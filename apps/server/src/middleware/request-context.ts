import { randomUUID } from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import type { AppDeps, AppEnv } from '../types.js';

// 上流（Misskey 本体）が付与した相関 ID を受理する形式。ログ・ヘッダに載るため、英数と
// 限られた区切り文字・妥当な長さのみ許可し、それ以外（注入を狙う制御文字や過長値）は破棄して自前生成する。
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * 受信ヘッダの相関 ID（x-request-id）が妥当ならそれを使い、無ければ生成する。
 * サイドカーとして本体側ログと突合できるよう、上流の ID をそのまま引き継ぐ。
 */
function resolveRequestId(headerValue: string | undefined): string {
  if (headerValue !== undefined && VALID_REQUEST_ID.test(headerValue)) {
    return headerValue;
  }
  return randomUUID();
}

/**
 * リクエストごとに requestId・clientIp（ソケットの接続元、ロギング専用）・child logger を用意する。
 * requestId は上流の x-request-id を引き継ぎ（妥当な場合）、応答にもエコーして本体とログを突合可能にする。
 * 推論のタイムアウトは core の detectImage が内部で管理するため、ここでは扱わない。
 */
export function requestContext(deps: AppDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const requestId = resolveRequestId(c.req.header('x-request-id'));
    c.header('x-request-id', requestId);
    const clientIp = c.env?.incoming?.socket?.remoteAddress ?? 'unknown';
    const logger = deps.logger.child({ requestId, clientIp, method: c.req.method, path: c.req.path });

    c.set('requestId', requestId);
    c.set('clientIp', clientIp);
    c.set('logger', logger);

    logger.info('request received');
    const start = performance.now();
    await next();
    const durationMs = Math.round(performance.now() - start);
    logger.info({ status: c.res.status, durationMs }, 'request completed');
  });
}
