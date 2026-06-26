---
name: preflight
description: PR・コミット前に CI 相当のローカル関門（typecheck / lint / unit / integration / docker build）を順に通し、落ちた所だけ報告する。CI が未整備の間の関門であり、のちの CI 仕様でもある。
disable-model-invocation: true
allowed-tools: Bash, Read
---

# preflight — ローカル関門（CI 相当）

リポジトリルートで以下を順に実行する。**途中で落ちても残りは続行**し、最後に
「どこが緑/赤か」を一覧にする。すべて緑なら「PR 可」と明言する。

1. `pnpm run typecheck`        — core を build してから各 package を `tsc --noEmit`。
2. `pnpm run lint`             — `biome check .`。
3. `pnpm run test:unit`        — 純粋ロジック。
4. `pnpm run test:integration` — 実モデルロード＋実 classify。
   **モデル不在なら自動 skip** される（その場合は「skip」と明示し、緑とは区別する）。
   CPU/arch 非対応（x64 / arm64 以外）は skip ではなく失敗として扱う。
   モデルは環境変数 `SENSITIVE_DETECTOR_TEST_MODEL_DIR` で上書き可。
5. `docker build -t sensitive-detector:preflight .` — ネイティブ依存（onnxruntime-node）の install/build が通るか。
   **イメージの push はしない**（レジストリ publish は予定なし）。一番遅いステップなので最後に置く。

## 報告フォーマット

| step | 結果 |
| --- | --- |
| typecheck | ✅ / ❌ |
| lint | ✅ / ❌ |
| test:unit | ✅ / ❌ |
| test:integration | ✅ / ❌ / ⏭ skip |
| docker build | ✅ / ❌ |

赤があれば、そのコマンドの末尾出力から原因行を引用し、最小の修正方針を添える。
