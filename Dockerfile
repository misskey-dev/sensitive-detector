# syntax=docker/dockerfile:1

# @tensorflow/tfjs-node は glibc と TensorFlow C binary に結びつくネイティブアドオン(tfjs_binding.node)に依存する。
# 現行の @tensorflow/tfjs-node@4.22.0 は配布バイナリ設定が N-API v8 までで、Node 24 以上のビルド/実行互換性は未保証。
# nsfwjs も TensorFlow.js backend 経由でこの制約を受けるため、Debian slim(glibc 2.36) + Node 22 系に固定する。
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"

# Node22 前提なので使用可能(25以降からバンドルされなくなる)
RUN corepack enable

WORKDIR /app

# ---- build stage ----
FROM base AS build
# tfjs-node のネイティブアドオン(node-gyp)ビルドに必要なツール。
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

# 依存解決のレイヤキャッシュ用に manifest を先に置く。
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/
COPY apps/server/package.json ./apps/server/

# onlyBuiltDependencies(@tensorflow/tfjs-node) のネイティブビルドを承認しつつ install。
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build
# server とその prod 依存(core / tfjs-node の .node 含む)だけを /app/deploy へ取り出す。
# pnpm v10 では injected workspace でない deploy に --legacy が必要（symlink リンク方式を維持）。
RUN pnpm deploy --legacy --filter=@misskey-sensitive-detector/server --prod /app/deploy

# ---- runtime stage ----
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/deploy ./
# nsfwjs モデルをイメージに同梱する（/models へ焼き込み）。config から modelDir: '/models' で参照する。
# モデルは公開重みで秘密ではないため同梱して構わない。差し替えたい場合は実行時に /models を上書きマウントする。
COPY nsfw-model/ /models/
COPY scripts/healthcheck.mjs /scripts/healthcheck.mjs
# attacker-controlled image bytes を処理するため root 以外で実行する。
USER node

# config は実行時にマウントする想定:
#   docker run -v /path/to/config.mjs:/config/config.mjs ...
# config.mjs 内で modelDir: '/models' を指定すること。
# 実際のリッスンポートは config.port が決める。EXPOSE は config.example.mjs の既定(3009)に揃えた目安。
EXPOSE 3009

# docker run 単体でも readiness を監視できるよう HEALTHCHECK を焼き込む（認証不要の GET /health を叩く）。
# 監視先のポート/ソケットは healthcheck.mjs が config から導出する。compose 利用時は compose.yml 側が上書きする。
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "/scripts/healthcheck.mjs"]

CMD ["node", "dist/main.mjs", "--config", "/config/config.mjs"]
