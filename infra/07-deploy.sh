#!/usr/bin/env bash
# §10.1 手順8：初回デプロイ、DBマイグレーション、シードデータ投入
#   使い方：infra/07-deploy.sh <demo|production> [オプション]
#
# オプション
#   --seed                   シードを投入する（デモの初回のみ。マスタ・デモユーザー・サンプルオーダー）
#   --tag <タグ>             イメージのタグ（既定：Git のコミットID。未コミットの変更があれば日時を付ける）
#   --skip-build             ビルドしない（--tag で指定した登録済みイメージを使う。GitHub Actions でビルドしたものなど）
#   --skip-migrate           マイグレーションを実行しない
#   --build-mode <方式>      cloudbuild / docker（既定は設定ファイルの BUILD_MODE）
#
# 処理の流れ
#   1. イメージ（runner と tools）をビルドして Artifact Registry に登録
#   2. Cloud Run ジョブ「マイグレーション」を作成・更新して実行（prisma migrate deploy）
#   3. Cloud Run サービスをデプロイ（環境変数・Secret Manager・Cloud SQL 接続・公開設定）
#   4. 初回は URL が決まってから APP_BASE_URL・AUTH_URL・CRON_OIDC_AUDIENCE を設定し直す
#   5. Cloud Run ジョブ「シード」を作成・更新（--seed のときだけ実行）
#   6. /api/health で起動を確認
# 何度実行しても同じ結果になる（設定ファイルの内容でサービス・ジョブを上書きする）。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
load_env "${1:-}"
shift || true

RUN_SEED=0
SKIP_BUILD=0
SKIP_MIGRATE=0
TAG=""
while (($#)); do
  case "$1" in
    --seed) RUN_SEED=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --skip-migrate) SKIP_MIGRATE=1 ;;
    --tag)
      TAG="${2:-}"
      shift
      ;;
    --build-mode)
      BUILD_MODE="${2:-}"
      shift
      ;;
    *) die "不明なオプション：$1" ;;
  esac
  shift
done

require_gcloud_login
require_cmd curl
[[ "$BUILD_MODE" == "cloudbuild" || "$BUILD_MODE" == "docker" ]] || die "BUILD_MODE は cloudbuild か docker にしてください。"
((SKIP_BUILD == 0)) || [[ -n "$TAG" ]] || die "--skip-build のときは --tag でイメージのタグを指定してください。"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

# ───────────── 前提の確認 ─────────────
log "前提の確認"
gcloud sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1 || die "Cloud SQL インスタンスがありません（02-cloudsql.sh）。"
gcloud iam service-accounts describe "$RUNTIME_SA" >/dev/null 2>&1 || die "ランタイムSAがありません（04-service-accounts.sh）。"
for s in "$SECRET_DATABASE_URL" "$SECRET_AUTH_SECRET" "$SECRET_SEED_DEMO_PASSWORD"; do
  secret_has_version "$s" || die "シークレット ${s} が未登録です（02-cloudsql.sh / 06-secrets.sh）。"
done
SQL_CONNECTION_NAME="$(gcloud sql instances describe "$SQL_INSTANCE" --format='value(connectionName)')"
ok "Cloud SQL 接続名：${SQL_CONNECTION_NAME}"

# ───────────── 1. ビルド ─────────────
if [[ -z "$TAG" ]]; then
  if git -C "$REPO_ROOT" rev-parse --short=12 HEAD >/dev/null 2>&1; then
    TAG="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)"
    if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
      TAG="${TAG}-dirty-$(date +%Y%m%d%H%M%S)"
      warn "未コミットの変更を含むイメージを作ります（タグ：${TAG}）"
    fi
  else
    TAG="manual-$(date +%Y%m%d%H%M%S)"
  fi
fi
APP_REF="${APP_IMAGE}:${TAG}"
TOOLS_REF="${TOOLS_IMAGE}:${TAG}"

if ((SKIP_BUILD)); then
  log "ビルドを省略（${TAG}）"
  gcloud artifacts docker images describe "$APP_REF" >/dev/null 2>&1 || die "イメージがありません：${APP_REF}"
  gcloud artifacts docker images describe "$TOOLS_REF" >/dev/null 2>&1 || die "イメージがありません：${TOOLS_REF}"
  ok "登録済みのイメージを使います"
elif [[ "$BUILD_MODE" == "cloudbuild" ]]; then
  log "Cloud Build でイメージを作ります（10分ほどかかります。タグ：${TAG}）"
  # --ignore-file はソースのディレクトリからの相対パスで指定するため、リポジトリ直下に移動して実行する
  (
    cd "$REPO_ROOT"
    gcloud builds submit . \
      --region="$REGION" \
      --config=infra/cloudbuild.yaml \
      --ignore-file=infra/cloudbuild.gcloudignore \
      --substitutions="_APP_IMAGE=${APP_REF},_TOOLS_IMAGE=${TOOLS_REF}" \
      --service-account="projects/${PROJECT_ID}/serviceAccounts/${DEPLOYER_SA}" \
      --gcs-source-staging-dir="gs://${BUILD_STAGING_BUCKET}/source"
  )
  ok "イメージを登録しました"
else
  require_cmd docker
  log "手元の Docker でイメージを作ります（タグ：${TAG}）"
  gcloud auth configure-docker "$AR_HOST" --quiet >/dev/null
  docker build --platform=linux/amd64 --target=runner --tag="$APP_REF" "$REPO_ROOT"
  docker build --platform=linux/amd64 --target=tools --tag="$TOOLS_REF" "$REPO_ROOT"
  docker push "$APP_REF"
  docker push "$TOOLS_REF"
  ok "イメージを登録しました"
fi

# ───────────── 環境変数ファイル（YAML）を作る ─────────────
# 値に記号が入っても壊れないよう、--set-env-vars ではなく --env-vars-file を使う
yaml_quote() { printf "'%s'" "${1//\'/\'\'}"; }

# 引数：出力ファイル、続けて「名前=値」。値が空の項目は書かない
write_env_file() {
  local file="$1" kv
  shift
  : >"$file"
  for kv in "$@"; do
    [[ -n "${kv#*=}" ]] || continue
    printf '%s: %s\n' "${kv%%=*}" "$(yaml_quote "${kv#*=}")" >>"$file"
  done
}

CURRENT_URL="$(service_url)"
PUBLIC_URL="${APP_BASE_URL:-$CURRENT_URL}"
PUBLIC_URL="${PUBLIC_URL%/}"

# サービスの環境変数（秘密情報は下の --set-secrets で渡す）
service_env() {
  local public_url="$1" cron_audience="$2"
  write_env_file "${tmpdir}/service-env.yaml" \
    "APP_ENV=${APP_ENV}" \
    "APP_BASE_URL=${public_url}" \
    "AUTH_URL=${public_url}" \
    "AUTH_PASSWORD_LOGIN=${AUTH_PASSWORD_LOGIN}" \
    "AUTH_MICROSOFT_ENTRA_ID_ID=${AUTH_MICROSOFT_ENTRA_ID_ID:-}" \
    "AUTH_MICROSOFT_ENTRA_ID_ISSUER=${AUTH_MICROSOFT_ENTRA_ID_ISSUER:-}" \
    "MAIL_TRANSPORT=${MAIL_TRANSPORT}" \
    "MAIL_FROM=${MAIL_FROM}" \
    "SMTP_HOST=${SMTP_HOST:-}" \
    "SMTP_PORT=${SMTP_PORT:-}" \
    "SMTP_SECURE=${SMTP_SECURE:-}" \
    "SMTP_USER=${SMTP_USER:-}" \
    "GRAPH_TENANT_ID=${GRAPH_TENANT_ID:-}" \
    "GRAPH_CLIENT_ID=${GRAPH_CLIENT_ID:-}" \
    "GRAPH_SENDER=${GRAPH_SENDER:-}" \
    "AI_PROVIDER=${AI_PROVIDER}" \
    "GOOGLE_CLOUD_PROJECT=${PROJECT_ID}" \
    "GEMINI_MODEL=${GEMINI_MODEL}" \
    "VERTEX_LOCATION=${VERTEX_LOCATION}" \
    "UPLOAD_BUCKET=${UPLOAD_BUCKET}" \
    "CRON_OIDC_AUDIENCE=${cron_audience}" \
    "CRON_SERVICE_ACCOUNT=${SCHEDULER_SA}" \
    "DB_POOL_MAX=${DB_POOL_MAX}" \
    "TZ=Asia/Tokyo"
}

# サービスに渡すシークレット（任意のものは登録済みのときだけ）
SERVICE_SECRETS="DATABASE_URL=${SECRET_DATABASE_URL}:latest,AUTH_SECRET=${SECRET_AUTH_SECRET}:latest"
if secret_has_version "$SECRET_SMTP_PASSWORD"; then
  SERVICE_SECRETS+=",SMTP_PASSWORD=${SECRET_SMTP_PASSWORD}:latest"
fi
if secret_has_version "$SECRET_GRAPH_CLIENT_SECRET"; then
  SERVICE_SECRETS+=",GRAPH_CLIENT_SECRET=${SECRET_GRAPH_CLIENT_SECRET}:latest"
fi
if secret_has_version "$SECRET_ENTRA_CLIENT_SECRET"; then
  SERVICE_SECRETS+=",AUTH_MICROSOFT_ENTRA_ID_SECRET=${SECRET_ENTRA_CLIENT_SECRET}:latest"
fi

# ───────────── 2. マイグレーション ─────────────
log "Cloud Run ジョブ ${MIGRATE_JOB}（prisma migrate deploy）"
write_env_file "${tmpdir}/migrate-env.yaml" "TZ=Asia/Tokyo"
gcloud run jobs deploy "$MIGRATE_JOB" \
  --region="$REGION" \
  --image="$TOOLS_REF" \
  --service-account="$RUNTIME_SA" \
  --set-cloudsql-instances="$SQL_CONNECTION_NAME" \
  --set-secrets="DATABASE_URL=${SECRET_DATABASE_URL}:latest" \
  --env-vars-file="${tmpdir}/migrate-env.yaml" \
  --command=prisma \
  --args=migrate,deploy \
  --tasks=1 \
  --max-retries=0 \
  --task-timeout=900s \
  --cpu=1 \
  --memory=1Gi \
  --labels="$LABELS" >/dev/null
ok "ジョブを作成・更新しました"

if ((SKIP_MIGRATE)); then
  warn "マイグレーションの実行を省略しました（--skip-migrate）"
else
  log "マイグレーションを実行します"
  gcloud run jobs execute "$MIGRATE_JOB" --region="$REGION" --wait ||
    die "マイグレーションに失敗しました。Cloud Run → ジョブ → ${MIGRATE_JOB} のログを確認してください。"
  ok "マイグレーションが完了しました"
fi

# ───────────── 3. サービスのデプロイ ─────────────
log "Cloud Run サービス ${SERVICE_NAME}"
case "$PUBLIC_ACCESS_MODE" in
  no-invoker-iam-check) PUBLIC_FLAG="--no-invoker-iam-check" ;;
  allUsers) PUBLIC_FLAG="--allow-unauthenticated" ;;
  *) die "PUBLIC_ACCESS_MODE は no-invoker-iam-check か allUsers にしてください。" ;;
esac

service_env "$PUBLIC_URL" "$CURRENT_URL"
gcloud run deploy "$SERVICE_NAME" \
  --region="$REGION" \
  --image="$APP_REF" \
  --service-account="$RUNTIME_SA" \
  --set-cloudsql-instances="$SQL_CONNECTION_NAME" \
  --env-vars-file="${tmpdir}/service-env.yaml" \
  --set-secrets="$SERVICE_SECRETS" \
  --port=8080 \
  --cpu="$RUN_CPU" \
  --memory="$RUN_MEMORY" \
  --concurrency="$RUN_CONCURRENCY" \
  --timeout="$RUN_TIMEOUT" \
  --min-instances="$RUN_MIN_INSTANCES" \
  --max-instances="$RUN_MAX_INSTANCES" \
  --ingress=all \
  --execution-environment=gen2 \
  --cpu-boost \
  --labels="$LABELS" \
  "$PUBLIC_FLAG"
ok "サービスをデプロイしました"

# ───────────── 4. URL が決まったら設定し直す ─────────────
NEW_URL="$(service_url)"
[[ -n "$NEW_URL" ]] || die "サービスのURLを取得できませんでした。"
NEW_PUBLIC_URL="${APP_BASE_URL:-$NEW_URL}"
NEW_PUBLIC_URL="${NEW_PUBLIC_URL%/}"
if [[ "$NEW_URL" != "$CURRENT_URL" || "$NEW_PUBLIC_URL" != "$PUBLIC_URL" ]]; then
  log "URL（${NEW_URL}）を APP_BASE_URL・AUTH_URL・CRON_OIDC_AUDIENCE に設定します"
  gcloud run services update "$SERVICE_NAME" \
    --region="$REGION" \
    --update-env-vars="APP_BASE_URL=${NEW_PUBLIC_URL},AUTH_URL=${NEW_PUBLIC_URL},CRON_OIDC_AUDIENCE=${NEW_URL}" >/dev/null
  ok "設定しました"
fi
PUBLIC_URL="$NEW_PUBLIC_URL"

# ───────────── 5. シード ─────────────
log "Cloud Run ジョブ ${SEED_JOB}（prisma db seed）"
# シード中の通知はメール送信せず DB に保存するだけにする
write_env_file "${tmpdir}/seed-env.yaml" \
  "APP_ENV=${APP_ENV}" \
  "APP_BASE_URL=${PUBLIC_URL}" \
  "MAIL_TRANSPORT=db" \
  "AI_PROVIDER=mock" \
  "SEED_MUST_CHANGE_PASSWORD=${SEED_MUST_CHANGE_PASSWORD}" \
  "SEED_SAMPLE_ORDERS=${SEED_SAMPLE_ORDERS}" \
  "SEED_DEMO_USERS=${SEED_DEMO_USERS}" \
  "TZ=Asia/Tokyo"
gcloud run jobs deploy "$SEED_JOB" \
  --region="$REGION" \
  --image="$TOOLS_REF" \
  --service-account="$RUNTIME_SA" \
  --set-cloudsql-instances="$SQL_CONNECTION_NAME" \
  --set-secrets="DATABASE_URL=${SECRET_DATABASE_URL}:latest,SEED_DEMO_PASSWORD=${SECRET_SEED_DEMO_PASSWORD}:latest" \
  --env-vars-file="${tmpdir}/seed-env.yaml" \
  --command=prisma \
  --args=db,seed \
  --tasks=1 \
  --max-retries=0 \
  --task-timeout=900s \
  --cpu=1 \
  --memory=1Gi \
  --labels="$LABELS" >/dev/null
ok "ジョブを作成・更新しました"

if ((RUN_SEED)); then
  if [[ "$APP_ENV" == "production" && "$SEED_DEMO_USERS" != "false" ]]; then
    die "本番では SEED_DEMO_USERS=false にしてください（デモユーザーを作らないため）。"
  fi
  log "シードを投入します"
  gcloud run jobs execute "$SEED_JOB" --region="$REGION" --wait ||
    die "シードに失敗しました。Cloud Run → ジョブ → ${SEED_JOB} のログを確認してください。"
  ok "シードを投入しました"
fi

# ───────────── 6. 起動確認 ─────────────
log "起動確認（${NEW_URL}/api/health）"
healthy=0
for i in 1 2 3 4 5 6; do
  if curl -fsS --max-time 30 "${NEW_URL}/api/health" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep $((i * 5))
done
if ((healthy)); then
  ok "応答を確認しました"
else
  warn "/api/health から応答がありません。Cloud Run → ${SERVICE_NAME} → ログ を確認してください。"
fi

cat >&2 <<EOF

────────────────────────────────────────────────────────────
デプロイが完了しました（イメージのタグ：${TAG}）
  URL：${PUBLIC_URL}
EOF
if [[ "$APP_ENV" == "demo" ]]; then
  cat >&2 <<EOF
  デモユーザーの初期パスワード：
    gcloud secrets versions access latest --secret=${SECRET_SEED_DEMO_PASSWORD} --project=${PROJECT_ID}
  （初回ログイン時にパスワードの変更を求められます。ユーザー一覧は docs/deploy.md）
EOF
fi
cat >&2 <<EOF
次の手順：infra/08-scheduler.sh ${ENV_FILE}
────────────────────────────────────────────────────────────
EOF
