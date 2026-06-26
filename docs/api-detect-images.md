# `POST /v1/detect-images`

複数の正規化済み画像を `multipart/form-data` で受け取り、各画像について推論モデルの生の予測値を返す。

この API は画像のリサイズ、回転、透過塗りつぶし、動画フレーム抽出、しきい値判定を行わない。呼び出し元は事前に Misskey 本体と同じ正規化を済ませ、返ってきた `predictions` を使って `sensitive` / `porn` などの判定を行う。

## リクエスト

```http
POST /v1/detect-images
Content-Type: multipart/form-data; boundary=...
Authorization: Bearer <token>
```

`Authorization` は `config.apiKey` を設定している場合のみ必須。`apiKey` 未設定時は省略できる。

### ヘッダー

| Header | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `Content-Type` | `multipart/form-data` | はい | JSON や単一画像バイナリではなく、必ず multipart で送る。`boundary` は HTTP クライアントに生成させる。 |
| `Authorization` | `Bearer <string>` | 条件付き | `config.apiKey` 設定時のみ必要。欠落または不一致の場合は 401。 |
| `X-Request-Id` | `string` | いいえ | ログ相関用。英数字、`-`、`_`、`.` の有効な値ならレスポンスにも同じ値が返る。不正または未指定ならサーバーが生成する。 |

### multipart body

各パートに画像ファイルを入れる。フィールド名は任意で、レスポンスの `results` はリクエストパートの順序に対応する。

| 項目 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| field name | `string` | はい | 任意。例: `image0`、`image1`。同じ名前を繰り返してもよいが、呼び出し元では順序で対応付ける。 |
| filename | `string` | 任意 | API の判定には使わない。 |
| part `Content-Type` | `image/png` \| `image/jpeg` \| `image/gif` \| `image/bmp` | はい | これ以外はそのパートだけ `UNSUPPORTED_MEDIA_TYPE` になる。 |
| part body | binary | はい | 正規化済み画像バイト。空ボディはそのパートだけ `INVALID_REQUEST` になる。 |

### 入力制限

設定値は [config.example.mjs](../config.example.mjs) を参照。

| 制限 | 対象 | 超過時 |
| --- | --- | --- |
| `maxBodySize` | リクエスト全体 | HTTP 413。`success: false` の全体エラー。 |
| `maxParts` | multipart パート数 | HTTP 413。`success: false` の全体エラー。 |
| `maxBinarySize` | 各画像パートのバイト数 | HTTP 200 のまま、該当 `results[i]` が `REQUEST_TOO_LARGE`。 |
| `maxImageWidth` / `maxImageHeight` / `maxImagePixels` | デコード後の画像 dimensions | HTTP 200 のまま、該当 `results[i]` が `REQUEST_TOO_LARGE`。 |

既定値では 299x299 までの正規化済み画像を想定している。

## レスポンス

このエンドポイントのレスポンス JSON は、成功または部分成功時と、全体エラー時で形が異なる。

### 成功または部分成功: HTTP 200

パート単位の失敗があっても、multipart リクエスト全体が処理できた場合は HTTP 200 を返す。この場合だけ `result.results` が存在し、`result.results[i]` が i 番目のリクエストパートに対応する。

```ts
type DetectImagesResponse = DetectImagesSuccessResponse | ErrorResponse;

type DetectImagesSuccessResponse = {
  success: true;
  result: {
    results: BatchItemResult[];
  };
};

type BatchItemResult =
  | {
      success: true;
      predictions: Prediction[];
    }
  | {
      success: false;
      error: DetectError;
    };

type Prediction = {
  className: string;
  probability: number;
};

type DetectError = {
  code: DetectErrorCode;
  message: string;
};

type DetectErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'INVALID_REQUEST'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'REQUEST_TOO_LARGE'
  | 'IMAGE_DECODE_FAILED'
  | 'MODEL_UNAVAILABLE'
  | 'DETECTION_FAILED';
```

#### 成功パート

| Field | 型 | 説明 |
| --- | --- | --- |
| `success` | `true` | パート単位の推論に成功したことを表す。 |
| `predictions` | `Prediction[]` | 推論モデルの生出力。サービス側ではしきい値判定やクラスの集約をしない。 |
| `predictions[].className` | `string` | クラス名。現在同梱しているモデルでは `Drawing`、`Hentai`、`Neutral`、`Porn`、`Sexy`。API 型としては将来のモデル差し替えに備えて `string`。 |
| `predictions[].probability` | `number` | 確率。通常は `0` 以上 `1` 以下。 |

#### 失敗パート

| Field | 型 | 説明 |
| --- | --- | --- |
| `success` | `false` | そのパートだけ処理に失敗したことを表す。 |
| `error.code` | `DetectErrorCode` | 呼び出し元が分岐に使う安定したコード。 |
| `error.message` | `string` | 人間向けの診断テキスト。内容は API 契約として固定しない。 |

パート単位で返り得る主な `error.code`:

| code | 意味 |
| --- | --- |
| `INVALID_REQUEST` | パートがファイルではない、または空ボディ。 |
| `UNSUPPORTED_MEDIA_TYPE` | パートの `Content-Type` が未対応。 |
| `REQUEST_TOO_LARGE` | パートサイズまたは画像 dimensions が上限超過。 |
| `IMAGE_DECODE_FAILED` | 画像バイトを読み取れない、または画像 dimensions を読めない。 |
| `MODEL_UNAVAILABLE` | モデルが利用できない。CPU 非対応、モデルロード失敗など。 |
| `DETECTION_FAILED` | 推論処理の失敗、タイムアウト、想定外エラー。 |

### 全体エラー: HTTP 4xx / 5xx

リクエスト全体を処理できない場合は `success: false` を返す。この場合はトップレベルに `error` があり、`result` はない。

```ts
type ErrorResponse = {
  success: false;
  error: {
    code: DetectErrorCode;
    message: string;
  };
};
```

| status | code | 主な原因 |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | multipart パース失敗、パートなし。 |
| 401 | `AUTHENTICATION_REQUIRED` | `config.apiKey` 設定時に Bearer token が欠落または不一致。 |
| 413 | `REQUEST_TOO_LARGE` | リクエスト全体の `maxBodySize` 超過、または `maxParts` 超過。 |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | リクエストの `Content-Type` が `multipart/form-data` ではない。 |
| 500 | `DETECTION_FAILED` | リクエスト処理パイプラインの想定外エラー。 |

このエンドポイントの通常処理では、画像デコード失敗の `IMAGE_DECODE_FAILED` とモデル利用不可の `MODEL_UNAVAILABLE` は全体エラーではなく、HTTP 200 の `results[i].error.code` に入る。

`bodyLimit` は Content-Type 検査より前に実行されるため、上限を超える非 multipart ボディは 415 ではなく 413 になる。

## 例

### curl

```sh
curl -X POST 'http://127.0.0.1:3000/v1/detect-images' \
  -H 'Authorization: Bearer <token>' \
  -F 'image0=@frame1.png;type=image/png' \
  -F 'image1=@frame2.png;type=image/png'
```

`-F` を使う場合、`Content-Type: multipart/form-data; boundary=...` は curl が自動生成するため、手動で指定しない。

### Node.js / fetch

```ts
import { readFile } from 'node:fs/promises';

const form = new FormData();

form.append(
  'image0',
  new File([await readFile('frame1.png')], 'frame1.png', { type: 'image/png' }),
);
form.append(
  'image1',
  new File([await readFile('frame2.png')], 'frame2.png', { type: 'image/png' }),
);

const res = await fetch('http://127.0.0.1:3000/v1/detect-images', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.SENSITIVE_DETECTOR_API_KEY}`,
  },
  body: form,
});

const body = await res.json();

if (!body.success) {
  throw new Error(`${body.error.code}: ${body.error.message}`);
}

for (const [index, result] of body.result.results.entries()) {
  if (!result.success) {
    console.warn(`image ${index} failed: ${result.error.code}`);
    continue;
  }

  const porn = result.predictions.find((p) => p.className === 'Porn')?.probability ?? 0;
  const hentai = result.predictions.find((p) => p.className === 'Hentai')?.probability ?? 0;
  console.log({ index, porn, hentai });
}
```

### 成功レスポンス

```json
{
  "success": true,
  "result": {
    "results": [
      {
        "success": true,
        "predictions": [
          { "className": "Neutral", "probability": 0.95 },
          { "className": "Drawing", "probability": 0.03 },
          { "className": "Sexy", "probability": 0.01 },
          { "className": "Hentai", "probability": 0.005 },
          { "className": "Porn", "probability": 0.005 }
        ]
      }
    ]
  }
}
```

### 部分成功レスポンス

2 枚目だけ壊れた画像だった場合の例:

```json
{
  "success": true,
  "result": {
    "results": [
      {
        "success": true,
        "predictions": [
          { "className": "Neutral", "probability": 0.95 },
          { "className": "Drawing", "probability": 0.03 },
          { "className": "Sexy", "probability": 0.01 },
          { "className": "Hentai", "probability": 0.005 },
          { "className": "Porn", "probability": 0.005 }
        ]
      },
      {
        "success": false,
        "error": {
          "code": "IMAGE_DECODE_FAILED",
          "message": "failed to read image dimensions"
        }
      }
    ]
  }
}
```

### 全体エラーレスポンス

Bearer token が必要な設定で未指定だった場合の例:

```json
{
  "success": false,
  "error": {
    "code": "AUTHENTICATION_REQUIRED",
    "message": "missing or invalid bearer token"
  }
}
```
