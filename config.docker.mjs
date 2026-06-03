// @ts-check

/**
 * compose.yml から使う設定。/config/config.mjs としてマウントされる。
 * apiKey は秘密なのでファイルに直書きせず、環境変数 SENSITIVE_DETECTOR_API_KEY から読む
 * （compose は .env から注入する）。スキーマと既定値は config.example.mjs を参照。
 *
 * @type {import('./packages/core/src/index.js').Config}
 */
export default {
  // コンテナ内では 0.0.0.0:3009 で待ち受け、compose 側で公開ポートにマッピングする
  // （ホスト側の公開範囲は compose.yml の HOST_BIND（既定 127.0.0.1）で絞る）。
  port: 3009,
  host: '0.0.0.0',

  // モデルは Dockerfile で /models へ同梱済み。
  modelDir: '/models',

  // 静的な共有シークレット。TCP 待ち受けでは apiKey 必須。空のまま起動すると ConfigError で落ちる。
  apiKey: process.env.SENSITIVE_DETECTOR_API_KEY,
};
