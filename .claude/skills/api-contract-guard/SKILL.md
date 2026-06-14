---
name: api-contract-guard
description: detect-images の応答形・エラーコード・HTTP ステータス・エラー優先順位・部分成功不変条件に後方互換を壊す変更が無いかを検査する。PR 前や API 周辺を変更した後に使う。
disable-model-invocation: true
context: fork
allowed-tools: Read, Grep, Glob, Bash
---

# api-contract-guard — 外部消費者（Misskey 本体）向け API 契約の破壊検出

このサービスの応答は Misskey 本体の `judgePrediction`（`FileInfoService.ts` の
`find(x => x.className === 'Sexy' / 'Porn')`）が直接参照する。**形・コード・ステータス・
部分成功の挙動を壊すと本体が無言で誤動作する。** 現在の差分を正本と突き合わせ、破壊的変更を洗い出す。

エンドポイントは **`POST /v1/detect-images`（multipart/form-data・バッチ）** の 1 本。
複数の正規化済み画像を一括推論し、各パーツの生予測値を順序保持で返す。

## 差分（自動注入）

- 変更ファイル一覧: !`git diff --name-only main...HEAD`
- API/契約関連の差分: !`git diff main...HEAD -- apps/server/src packages/core/src README.md`

## 正本（これらを基準に判定する）

- 応答型: `packages/core/src/types.ts`
  - `Prediction` = `{ className:string; probability:number }`（nsfwjs 生出力・確率降順。
    `PredictionType` を re-export しつつ className を string に緩めた契約）。
  - `BatchItemResult` = `{ success:true; predictions: Prediction[] }`
    ｜ `{ success:false; error:{ code:DetectErrorCode; message:string } }`（パーツ単位の結果）。
  - `DetectImageSuccessResult` / `DetectFailedResult` は core 内部の単一推論型（`detectImage`）であり、
    **HTTP 応答の形ではない**点に注意。
- **HTTP 応答形**（`apps/server/src/routes/detect-images.ts` / `app.ts`）:
  - 成功（200）= `{ success:true, result:{ results: BatchItemResult[] } }`。
    `results` の順序はリクエストパーツ順と一致する。
  - リクエスト全体の失敗（4xx）= `{ success:false, error:{ code, message } }`。
- エラーコード: `DetectErrorCode`（7 種）と HTTP ステータス表 `STATUS_BY_CODE`
  （`apps/server/src/lib/error-mapping.ts`）。7 種 =
  `AUTHENTICATION_REQUIRED`(401) / `INVALID_REQUEST`(400) / `UNSUPPORTED_MEDIA_TYPE`(415) /
  `REQUEST_TOO_LARGE`(413) / `IMAGE_DECODE_FAILED`(422) / `MODEL_UNAVAILABLE`(503) /
  `DETECTION_FAILED`(500)。
- **リクエスト全体の優先順位（先勝ち。`app.ts` のミドルウェア順 ＋ `detect-images.ts`）**:
  認証(401) → bodyLimit 超過 413(`maxBodySize`) → 非 multipart 415 →
  multipart パース失敗 400 → パーツ 0 件 400 → パーツ数超過 413(`maxParts`)。
- **パーツ単位の検査順（`detect-images.ts` 内、各パーツ毎・全体は 200 のまま `results[i].error` に格納）**:
  非 File 400 → 非対応 part Content-Type 415 → 空ボディ 400 → サイズ超過 413(`maxBinarySize`) →
  dimensions 読取失敗 422(`IMAGE_DECODE_FAILED`) → dimensions 上限超過 413
  (`maxImageWidth`/`maxImageHeight`/`maxImagePixels`) → 推論。
- 受理する **パーツの** Content-Type: `image/png|jpeg|gif|bmp`
  （`detect-images.ts` の `ACCEPTED_CONTENT_TYPES`）。リクエスト全体は `multipart/form-data`。
- `README.md` の API 表。

## 破壊的変更とみなすもの（❌ で報告）

- `result.results[]` 構造の変更・`BatchItemResult` のキー改名・`predictions` の形変更・
  確率降順保証の喪失。
- **部分成功不変条件の破壊**: パーツ単位の失敗で全体を 4xx にする、`results` の順序保証の喪失、
  パーツ失敗を 200 以外で返す。
- `DetectErrorCode` の削除・改名、`STATUS_BY_CODE` のステータス変更。
- リクエスト全体／パーツ単位いずれかのエラー優先順位の入れ替え。
- `success` フラグの廃止・意味変更、`error.code` 以外での分岐を強要する変更。
- 受理する Content-Type（リクエスト=multipart / パーツ=image/*）の縮小。

## 報告

各論点を ✅(影響なし) / ⚠️(要確認) / ❌(後方互換破壊) で列挙し、❌ は
「どのファイルのどの変更が・本体の何を壊すか・どう直すか」まで一行で示す。
**新規エンドポイントの追加など既存契約を変えない拡張は ✅**（scope-guard の判断軸に従う）。
