---
name: native-deps-guard
description: tfjs-node / nsfwjs / Node / Docker ベースイメージなどネイティブ ML スタック依存を上げる前に、N-API v8・avx2+fma・glibc・Node22 固定との整合を確認する。依存のバージョンを上げる時に使う。
disable-model-invocation: true
allowed-tools: Read, Grep, Bash, WebFetch
---

# native-deps-guard — ネイティブ ML スタック依存の互換チェック

対象依存（指定があれば $ARGUMENTS、無ければ下記すべて）の更新可否を、このリポジトリの
固定制約に照らして判定する。**結論（上げてよい / だめ / 条件付き）と根拠を報告するだけ。
勝手にバージョンを書き換えない。**

## 固定されている制約（根拠）

- **Node 22 系に固定**。`@tensorflow/tfjs-node@4.22.0` の配布バイナリは N-API v8 まで前提で、
  Node 24+ のビルド/実行互換は未保証（[Dockerfile](../../../Dockerfile) 冒頭コメント /
  ルート [package.json](../../../package.json) の `engines.node >= 22`）。
- **x64 avx2+fma 必須・glibc 依存**（libtensorflow バイナリの制約）。Alpine(musl) は不可、
  ベースは `node:22-bookworm-slim`（glibc 2.36）。
- バージョンは **[pnpm-workspace.yaml](../../../pnpm-workspace.yaml) の catalog 1 箇所**で集中管理。
  `@tensorflow/tfjs` と `@tensorflow/tfjs-node` は **必ず同じ版に揃える**。
- ネイティブビルド許可は同ファイルの `onlyBuiltDependencies` にある
  （`@tensorflow/tfjs-node` を外すとビルドが走らない）。

## 手順

1. 現状把握: `pnpm-workspace.yaml`(catalog)・各 `package.json`・`Dockerfile` を読む。
2. 上げたい依存の **リリースノート / CHANGELOG / peerDependencies** を WebFetch で確認する:
   - **tfjs-node**: N-API ターゲット、対応 Node、libtensorflow の版と CPU 命令要件。
   - **nsfwjs**: 要求する `@tensorflow/tfjs(-node)` の版（tfjs と歩調を合わせる）。
   - **Node engines / Docker ベース**: tfjs-node が対応する Node 範囲を出ない glibc イメージか。
3. 判定観点:
   - N-API/Node 互換は壊れないか（Node 24+ は tfjs-node が N-API v9+ バイナリを配布してから）。
   - avx2+fma / glibc 前提を崩していないか。
   - tfjs と tfjs-node の版が一致しているか。
4. **報告**: 各依存を `✅ 上げてOK / ⚠️ 条件付き / ❌ 非推奨` ＋ 一行根拠 ＋
   実施するなら「catalog のどの行をどう変える / 何を検証する」まで。

## 上げた後の検証（案内のみ。実行は `/preflight`）

`pnpm install` → `pnpm run build` → `pnpm run test:integration`
（CPU が avx2+fma 非対応 or モデル不在なら統合テストは skip される）→ `docker build .`。
