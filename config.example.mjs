// @ts-check

import path from 'node:path';

/**
 * sensitive-detector の設定例。`--config <path>` か環境変数 SENSITIVE_DETECTOR_CONFIG で指定する。
 * default export がそのまま設定として読み込まれる。
 *
 * @type {import('./packages/core/src/index.js').Config}
 */
export default {
  // --- 待ち受け（port と socket はどちらか一方が必須） ---
  port: 3009,
  // bind ホスト（port 待ち受け時のみ）。既定は 127.0.0.1（ローカルのみ）。
  // 外部公開する場合のみ '0.0.0.0' を明示する（コンテナは config.docker.mjs で 0.0.0.0 指定済み）。
  // host: '127.0.0.1',
  // socket: '/run/sensitive-detector/app.sock',

  // --- モデル（必須） ---
  // Misskey 本体にあった packages/backend/nsfw-model に相当するディレクトリ。
  modelDir: path.resolve(process.env.INIT_CWD || process.cwd(), 'nsfw-model/'),

  // --- 認証 ---
  // 静的な共有シークレット。自分で十分長いランダムな値を決めて、
  // リクエスト元には Authorization: Bearer <この値> として送らせる。
  // port で TCP 待ち受けする場合は apiKey か allowUnauthenticatedTcp: true が必須。
  apiKey: 'change-me-to-a-long-random-secret',
  // 開発用など、外部から到達不能な TCP で apiKey 未設定を明示的に許す場合のみ true。
  // allowUnauthenticatedTcp: true,

  // --- リクエスト制限（任意。以下はデフォルト値） ---
  maxBinarySize: 1_048_576, // 1MB（パーツ個別の上限）
  maxImageWidth: 299,
  maxImageHeight: 299,
  maxImagePixels: 89_401, // 299 × 299
  maxParts: 10, // multipart パーツ数の上限
  maxBodySize: 12_582_912, // 12MB（総 body の上限: 10 parts × 1MB + boundary/header 余白）
  maxConcurrentJobs: 2,
  requestTimeoutMs: 60_000,
};
