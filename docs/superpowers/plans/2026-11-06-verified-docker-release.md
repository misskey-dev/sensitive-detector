# Verified Docker Release Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. The user requested implementing release-time verification using the existing Docker checks.

**Goal:** リリース時も実際に検証したイメージだけを公開する。
**Architecture:** native amd64/arm64でbuild/loadし、CIと共通のcomposite actionで検証する。actionが検証した不変のimage IDを出力し、そのIDをtag/pushする。再ビルドしない。両architectureの成功後、公開先のdigestから既存のsemver manifestを作る。
**Spec:** この会話の「リリースworkflowでも同じ検証を通してからpush」。#41はマージ済み。
**Decision:** キャッシュを使う再ビルドより、検証したimage IDの直接pushを選ぶ。同一成果物であることが明確。OCI転送ツールの追加は避け、既存Docker CLIを使う。受け渡し用に`build-<run-id>-<attempt>-linux-<arch>`補助タグがGHCRに残る。ユーザー向けsemverタグの規則は維持する。

## Constraints

- amd64=`ubuntu-24.04`、arm64=`ubuntu-24.04-arm`。configだけをreadonly mountし、モデルはimage同梱。
- HEALTHCHECK、health200、unauthenticated401、固定画像Neutral/Sexyの推論を必須とする。
- 起動120秒、HTTP60秒、Docker管理操作60秒。pushは大きなlayer転送を考慮して最大600秒。
- 検証失敗時はlogin/push/digest exportを実行しない。ログ・状態を出力し、コンテナ削除を試行する。
- 本番レジストリへの実pushやrelease作成は、この実装作業では行わない。
- 公開API・モデル判定・fixtureは変更しない。

## Tasks

- [x] Baseline165testsを確認する。
- [x] `.github/actions/test-docker-image/action.yml`に既存のDocker lifecycle/host setupを移し、immutable image IDで起動・出力する。CIはこのactionを使う。
- [x] releaseworkflowをnativebuild/load→共通検証→login→同じimage IDのpush→registry digest exportに変更する。既存mergeは両方の成功を待つ。
- [x] 実際のaction/stepのshellを使い、localregistryでtest/push/manifestを検証し、registry manifestのconfig digestが検証済みimage IDに一致することを確認する。
- [x] 検証失敗時のpush阻止とcleanup、異常digest拒否をfault injectionで確認する。actionlint・全テスト・型・lint・serverE2Eを実行する。
- [x] 独立エージェントの敵対的レビューで実質的な指摘がなくなるまで修正・再レビューする。

**PR verification:** 共通actionを使うamd64/arm64を含むCI全5ジョブの最終結果は、PR本文とChecksに記録する。

## Review Focus

- testとpushの間で再ビルドや可変tagの再解決をしない。
- composite内部のfailureがcleanup成功によって握りつぶされない。
- release tagをcheckoutし、誤ったbranchのコードを公開しない。
- digestがローカルimage IDではなく公開先のmanifest digestであること。
- 片方が失敗した場合、semver manifestの公開を行わない。

**Review result:** checkoutの未修飾タグ名が同名branchを選び得る問題を公式helperで再現し、`github.sha`へ固定して解消した。再レビューで残る実質的な指摘なし。CodeRabbitも共通actionを含む全5ファイルをレビューし指摘なし。
