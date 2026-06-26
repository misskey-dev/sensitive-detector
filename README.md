# sensitive-detector

Misskey 本体の `AiService.detectSensitive`（NSFW 推論）を切り出した、独立 HTTP サイドカーサービス。推論エンジンには [ONNX Runtime](https://onnxruntime.ai/) を使用する。

切り出して嬉しいのは **ネイティブ ML スタック（ONNX Runtime、モデルのメモリ常駐）の隔離** であり、本サービスはそこだけに徹する。画像の正規化（リサイズ・回転・透過塗りつぶし）や動画フレーム抽出は **Misskey 本体に残し**、本サービスは **299×299 に正規化済みの PNG を受け取り、生の予測値をそのまま返す**。しきい値判定（`sensitive` / `porn`）も本体側に残す。

背景: [misskey-dev/misskey#16804](https://github.com/misskey-dev/misskey/issues/16804)

## API

### `POST /v1/detect-images`

複数の正規化済み画像を一括推論する。詳しい入出力仕様、型、エラー、実装例は
[docs/api-detect-images.md](docs/api-detect-images.md) を参照。

| | |
| --- | --- |
| Content-Type | `multipart/form-data` |
| Authorization | `Bearer <token>`（`config.apiKey` 設定時のみ要求） |
| Body | 各パートに画像バイナリ（フィールド名は任意、順序を保持）。パートの Content-Type は `image/png` |

成功（200）:

```json
{
  "success": true,
  "result": {
    "results": [
      {
        "success": true,
        "predictions": [{ "className": "Neutral", "probability": 0.98 }]
      },
      {
        "success": false,
        "error": { "code": "IMAGE_DECODE_FAILED", "message": "..." }
      }
    ]
  }
}
```

`results` の順序はリクエストパーツの順序と一致する。1 枚でも失敗しても全体は 200 を返す（部分成功）。
成功パートの `predictions` は推論モデルの生出力で、サービス側ではしきい値判定をしない。
各パーツのサイズ上限は `maxBinarySize` を個別適用する。

全体失敗（4xx/5xx）はリクエスト全体に問題がある場合のみ:

| code | status | 意味 |
| --- | --- | --- |
| `AUTHENTICATION_REQUIRED` | 401 | トークン欠落 / 不一致 |
| `INVALID_REQUEST` | 400 | パーツなし / multipart パース失敗 |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Content-Type が `multipart/form-data` 以外 |
| `REQUEST_TOO_LARGE` | 413 | リクエストボディが `maxBodySize` 超過、またはパーツ数が `maxParts` 超過 |
| `DETECTION_FAILED` | 500 | リクエスト処理パイプラインの想定外エラー |

パーツ個別の失敗（画像 dimensions 上限超過による `REQUEST_TOO_LARGE`、`IMAGE_DECODE_FAILED` 等）は
`results[i].error.code` に入り、HTTP は 200。

動作確認:

```sh
curl -X POST localhost:3000/v1/detect-images \
  -F 'a=@frame1.png;type=image/png' \
  -F 'b=@frame2.png;type=image/png'
```

## 設定

`--config <path>` または環境変数 `SENSITIVE_DETECTOR_CONFIG` で `.mjs` / `.cjs` のパスを指定する（default export が設定）。スキーマと既定値は [config.example.mjs](config.example.mjs) を参照。

- `port` / `socket`: どちらか一方必須。
- `host`: `port` 待ち受け時の bind ホスト。既定 `127.0.0.1`（ローカルのみ）。外部公開する場合のみ `0.0.0.0` を明示する（Docker は `config.docker.mjs` で `0.0.0.0` 指定済み）。
  - **移行メモ**: 既定が `0.0.0.0` から `127.0.0.1` に変わった。`port` 待ち受けで別ホスト／別コンテナから到達させていた既存利用者は、`host: '0.0.0.0'`（や特定の bind アドレス）を明示する必要がある。Docker 利用は変更不要。
- `modelDir`: 必須。ONNX モデルディレクトリ（`nsfw_model.onnx` を含むパス）。
- `apiKey`: 静的 Bearer token。`port` で TCP 待ち受けする場合は `apiKey` が必須。
- `allowUnauthenticatedTcp`: `port` で `apiKey` なしを許すためのフラグ。開発用・外部から到達不能な環境以外では使わない。
- `maxBinarySize`(1MB) / `maxImageWidth`(299) / `maxImageHeight`(299) / `maxImagePixels`(89401) / `maxParts`(10) / `maxBodySize`(12MB) / `maxConcurrentJobs`(2) / `requestTimeoutMs`(60000)。

## 開発

```sh
pnpm install
pnpm run build          # tsdown（高速 JS 出力。依存は external）
pnpm run typecheck      # core を build してから各 package を型チェック
pnpm run lint           # biome
pnpm run test:unit      # 純粋ロジック
pnpm run test:integration  # 実モデルロード＋実 classify（モデルが無ければ skip）

# ローカル起動（config に modelDir を設定）
pnpm --filter @misskey-sensitive-detector/server dev -- --config ./config.dev.mjs
```

統合テストは `SENSITIVE_DETECTOR_TEST_MODEL_DIR` でモデルディレクトリを上書きできる
（既定: `/home/osamu/develop/misskey/packages/backend/nsfw-model`）。モデルが無い環境では自動的に skip する。

## 構成

- `packages/core` (`@misskey-sensitive-detector/core`): 推論エンジン。重いネイティブ実依存（onnxruntime-node）はここに集約。
- `apps/server` (`@misskey-sensitive-detector/server`): 薄い HTTP 層（Hono + pino）。

## Docker

モデル（`nsfw-model/`）はイメージに同梱され `/models` へ焼き込まれる。config だけ実行時にマウントする。
ベースは `node:22-bookworm-slim`（glibc）。フレーム抽出は本体側に残すため **ffmpeg は不要**。

### compose（推奨）

```sh
cp .env.example .env        # SENSITIVE_DETECTOR_API_KEY を埋める（必須）
docker compose up -d --build
```

ホスト側は既定で `3009` に公開する（`.env` の `HOST_PORT` で変更可。Misskey 本体が 3000 を使うため
ずらしてある）。設定は [config.docker.mjs](config.docker.mjs) をマウントし、`apiKey` のみ環境変数から注入する。
ヘルスチェック・自動再起動・リソース制限・ログ rotation・最小権限実行は compose 側で設定済み。

### docker run（compose を使わない場合）

```sh
docker build -t sensitive-detector .
docker run --rm -p 127.0.0.1:3009:3009 \
  -v /path/to/config.mjs:/config/config.mjs \
  sensitive-detector
```

`config.mjs` 内で `modelDir: '/models'`、`port: 3009` を指定する。別のモデルを使う場合のみ
`-v /path/to/nsfw-model:/models:ro` で同梱モデルを上書きする。

## Misskey 本体との統合（このリポジトリの範囲外）

本体側で `AiService.detectSensitive` を本サービスへの HTTP 呼び出しに置換する。`FileInfoService` は
現行どおり正規化・フレーム抽出・`judgePrediction`・集約を担い、各フレームを 299×299 PNG に正規化して
`/v1/detect-images` に一括送信する。これにより現行挙動が完全に保存される。
