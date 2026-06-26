---
name: scope-guard
description: sensitive-detector に機能を足す時の判断軸と、生予測値サービスとしての不変条件。コードを書く・レビューする・新機能を検討する時に常に適用する。
user-invocable: false
---

# scope-guard — sensitive-detector のスコープ判断と不変条件

このサービスは Misskey の `AiService.detectSensitive`（ONNX Runtime 推論）を
HTTP サイドカーに切り出したもの。切り出して嬉しいのは **ネイティブ ML スタック
（onnxruntime-node、モデルのメモリ常駐、glibc 依存）の隔離** だけ。

## 機能を足してよいかの判断軸（エンドポイント数は不変条件ではない）

新機能・新エンドポイントを検討する時は、まず次を問う:

1. **ネイティブ ML スタックの隔離に必要か？** 必要なら足してよい（例: 将来の detect-file 構想、
   モデル情報の公開など）。「`/v1/detect-images` 1 本のみ」は *現状の数* であって固定ルールではない。
2. **「正規化済み入力 → 推論 → 生予測値」に徹しているか？**
3. **正規化・しきい値・集約を持ち込んでいないか？**

「便利そう」「ついでに」で 2 / 3 を侵すものは足さない。

## 守る不変条件（数とは無関係に常に成立させる）

- 返すのは **推論の生予測値だけ**。`sensitive` / `porn` のしきい値判定・フレーム集約・
  per-user ポリシーは **Misskey 本体（`FileInfoService.ts` の `judgePrediction`）に残す**。ここには入れない。
- 受け取るのは **299×299 の正規化済み PNG**。画像正規化（sharp の resize/rotate/flatten/PNG 変換）と
  動画・APNG のフレーム抽出（ffmpeg）は本体に残す。**sharp / fluent-ffmpeg / ffmpeg を依存に足さない。**
- **物理パス入力・mediaDir・ディレクトリトラバーサル防御・JSON 入力スキーマ** は持ち込まない
  （入力は画像バイナリ本体）。
- 予測値の形は ONNX モデルの生出力（全クラス・確率降順）。`predictions[].className` は本体が
  `find(x => x.className === 'Sexy')` で引ける契約（[packages/core/src/types.ts](../../../packages/core/src/types.ts) の `Prediction`）。
- **HTTP 応答はバッチ形**。成功は `{ success:true, result:{ results: BatchItemResult[] } }`
  （パーツ順保持）。`BatchItemResult` はパーツ毎に `{ success:true, predictions }` か
  `{ success:false, error:{ code, message } }`。**パーツ単位の失敗で全体を 4xx にしない（部分成功は常に 200）**。
- **エラーは throw せず** `{ success:false, error:{ code } }` を返す（[packages/core/src/errors.ts](../../../packages/core/src/errors.ts)）。
  `code` は `DetectErrorCode` の 7 種のみ。`message` は診断用で API 契約上の意味を持たない。
- リクエスト全体のエラー優先順位（先勝ち）: **認証(401) → bodyLimit 413 → 非 multipart 415 →
  multipart パース失敗/パーツ 0 件 400 → パーツ数超過 413**。認証と bodyLimit は手前のミドルウェアで処理済み。
  パーツ単位の検査（非対応 Content-Type 415 / 空 400 / サイズ・dimensions 超過 413 / decode 失敗 422 / 推論）は
  `results[i].error` に格納し全体は 200。詳細な突合は `/api-contract-guard`。

## 迷ったら

[README.md](../../../README.md) の「Misskey 本体との統合」節（本体に残す責務 = 正規化・フレーム抽出・
`judgePrediction`・集約）を確認する。そこに隔離済みのもの・本体に残すものは v1 では着手しない。
契約（応答形・エラーコード）に触れる変更は `/api-contract-guard` で後方互換を確認する。
ネイティブ依存を上げる変更は `/native-deps-guard` で互換を確認する。
