---
name: native-deps-guard
description: onnxruntime-node / Node / Docker ベースイメージなどネイティブ ML スタック依存を上げる前に、glibc・Docker runtime の Node22 との整合を確認する。依存のバージョンを上げる時に使う。
disable-model-invocation: true
allowed-tools: Read, Grep, Bash, WebFetch
---

# native-deps-guard — ネイティブ ML スタック依存の互換チェック

対象依存（指定があれば $ARGUMENTS、無ければ下記すべて）の更新可否を、このリポジトリの
固定制約に照らして判定する。**結論（上げてよい / だめ / 条件付き）と根拠を報告するだけ。
勝手にバージョンを書き換えない。**

## 固定されている制約（根拠）

- **Docker/runtime は Node 22 系**。Dockerfile のベースイメージは `node:22-bookworm-slim`。
  ルート [package.json](../../../package.json) の `engines.node` は `>=22` なので、
  ローカル実行の上限は固定していない。
- **glibc 依存**（`onnxruntime-node` のネイティブバイナリの制約）。Alpine(musl) は不可、
  ベースは `node:22-bookworm-slim`（glibc 2.36）。
- バージョンは **[pnpm-workspace.yaml](../../../pnpm-workspace.yaml) の catalog 1 箇所**で集中管理。
- ネイティブビルド許可は同ファイルの `onlyBuiltDependencies` と `allowBuilds` に `onnxruntime-node` を記載。
  これを外すとネイティブ依存の install/build スクリプトが走らず実行時エラーになる。

## 手順

1. 現状把握: `pnpm-workspace.yaml`(catalog)・各 `package.json`・`Dockerfile` を読む。
2. 上げたい依存の **リリースノート / CHANGELOG** を WebFetch で確認する:
   - **onnxruntime-node**: 対応 Node バージョン、glibc の最低要件、CPU 命令セット要件の変化。
   - **Node engines / Docker ベース**: Docker runtime の Node 22 とローカル engines `>=22` の範囲で動くか。
3. 判定観点:
   - Docker runtime の Node 22 との互換は壊れないか。
   - engines `>=22` のままで問題ないか（上限が必要な依存に変わっていないか）。
   - glibc 前提（bookworm-slim = 2.36）を崩していないか。
   - `onlyBuiltDependencies` / `allowBuilds` への追記が必要な新たなネイティブ依存が増えていないか。
4. **報告**: 各依存を `✅ 上げてOK / ⚠️ 条件付き / ❌ 非推奨` ＋ 一行根拠 ＋
   実施するなら「catalog のどの行をどう変える / 何を検証する」まで。

## 上げた後の検証（案内のみ。実行は `/preflight`）

`pnpm install` → `pnpm run build` → `pnpm run test:integration`
（モデル不在なら統合テストは skip される）→ `docker build .`。
