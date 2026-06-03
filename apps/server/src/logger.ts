import { type Logger, pino } from 'pino';

/**
 * ルートロガーを生成する。開発時（NODE_ENV !== 'production'）は pino-pretty で整形する。
 * 本番イメージは NODE_ENV=production を設定し、構造化 JSON ログを出力する。
 */
export function createLogger(): Logger {
  const usePretty = process.env.NODE_ENV !== 'production';
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    ...(usePretty
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:standard', ignore: 'pid,hostname' } } }
      : {}),
  });
}
