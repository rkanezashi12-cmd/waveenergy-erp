# オーダー発令・仕様確定管理アプリのコンテナイメージ
#
# ターゲットは2つ（docs/deploy.md 参照）
#   runner : Cloud Run サービス用。Next.js の standalone 出力だけを含む小さいイメージ（非root で実行）
#   tools  : Cloud Run ジョブ用。DBマイグレーション（prisma migrate deploy）・シード投入・管理者作成に使う
#            （node_modules 一式とソースを含む）
#
# ビルド例
#   docker build --target runner -t we-order-app .
#   docker build --target tools  -t we-order-tools .
#
# ベースイメージは Docker Hub の回数制限を避けたい場合に差し替えられる
#   例：--build-arg NODE_IMAGE=mirror.gcr.io/library/node:22-bookworm-slim
ARG NODE_IMAGE=node:22-bookworm-slim

# ───────────── 共通の土台（Prisma の CLI・エンジンが使う OpenSSL を入れる） ─────────────
FROM ${NODE_IMAGE} AS base
ENV NEXT_TELEMETRY_DISABLED=1 \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ───────────── 依存パッケージ ─────────────
FROM base AS deps
# postinstall で prisma generate が走るため、スキーマと設定ファイルを先に置く
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# prisma.config.ts は env("DATABASE_URL") を読み、未設定だとエラーになる。
# generate では接続しないため、ビルド中だけダミー値を渡す（イメージには残さない）。
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npm ci --no-audit --no-fund

# ───────────── Next.js のビルド ─────────────
FROM deps AS builder
COPY . .
# public/ は空だと Git に含まれないため、無ければ作る
RUN mkdir -p public
# ビルド時にサーバー側の環境変数を参照してもよいようにダミー値を渡す（実行時の値は Cloud Run で設定する）
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    AUTH_SECRET="build-only-dummy-secret" \
    APP_ENV="demo" \
    AI_PROVIDER="mock" \
    npm run build

# ───────────── Cloud Run ジョブ用（マイグレーション・シード） ─────────────
FROM deps AS tools
COPY . .
ENV NODE_ENV=production \
    PATH=/app/node_modules/.bin:$PATH
USER node
# 既定はマイグレーション。シードは Cloud Run ジョブ側で「prisma db seed」を指定する
CMD ["prisma", "migrate", "deploy"]

# ───────────── Cloud Run サービス用（本番実行） ─────────────
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 8080
CMD ["node", "server.js"]
