#!/usr/bin/env bash
# Cloud Run を作る・更新する（GitHub Actions の .github/workflows/gcp.yml から呼ぶ。設定は infra/env/<env>.env）
#   1. ジョブ ${APP}-tools（tools イメージ。マイグレーション・シード・管理者作成）
#   2. マイグレーションを実行
#   3. サービス ${APP}（アプリ。画面は公開し、ログインはアプリで行う）
#   4. サービス ${APP}-budget-stop（予算超過で停止。非公開）
set -euo pipefail
cd "$(dirname "$0")/.."

: "${APP:?}" "${GCP_PROJECT_ID:?}" "${GCP_PROJECT_NUMBER:?}" "${REGION:?}" "${IMAGE_APP:?}" "${IMAGE_TOOLS:?}"
: "${APP_SA:?}" "${SCHEDULER_SA:?}" "${BUDGET_STOP_SA:?}" "${SQL_CONNECTION:?}" "${UPLOAD_BUCKET:?}"
P=(--project="$GCP_PROJECT_ID" --region="$REGION" --quiet)
SERVICE_URL="https://${APP}-${GCP_PROJECT_NUMBER}.${REGION}.run.app"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 環境変数は YAML のファイルで渡す（値にカンマや記号があっても壊れない）
yaml_env() {
  local k
  for k in "$@"; do
    printf '%s: "%s"\n' "${k%%=*}" "${k#*=}"
  done
}

yaml_env \
  "APP_ENV=${APP_ENV}" "TZ=Asia/Tokyo" "DB_POOL_MAX=2" \
  "SEED_DEMO_USERS=${SEED_DEMO_USERS}" "SEED_SAMPLE_ORDERS=${SEED_SAMPLE_ORDERS}" \
  "SEED_MUST_CHANGE_PASSWORD=${SEED_MUST_CHANGE_PASSWORD}" "AUTH_PASSWORD_LOGIN=${AUTH_PASSWORD_LOGIN}" \
  "MAIL_TRANSPORT=db" "AI_PROVIDER=mock" "APP_BASE_URL=${SERVICE_URL}" \
  "GOOGLE_CLOUD_PROJECT=${GCP_PROJECT_ID}" "GEMINI_MODEL=${GEMINI_MODEL}" "MODEL_LOCATIONS=asia-northeast1,global" >"$TMP/tools.yaml"

yaml_env \
  "APP_ENV=${APP_ENV}" "TZ=Asia/Tokyo" "APP_BASE_URL=${SERVICE_URL}" "AUTH_URL=${SERVICE_URL}" \
  "AUTH_PASSWORD_LOGIN=${AUTH_PASSWORD_LOGIN}" "MAIL_TRANSPORT=${MAIL_TRANSPORT}" "MAIL_FROM=${MAIL_FROM}" \
  "AI_PROVIDER=${AI_PROVIDER}" "GOOGLE_CLOUD_PROJECT=${GCP_PROJECT_ID}" "GEMINI_MODEL=${GEMINI_MODEL}" \
  "VERTEX_LOCATION=${VERTEX_LOCATION}" "UPLOAD_BUCKET=${UPLOAD_BUCKET}" "DB_POOL_MAX=${DB_POOL_MAX}" \
  "CRON_OIDC_AUDIENCE=${SERVICE_URL}" "CRON_SERVICE_ACCOUNT=${SCHEDULER_SA}" >"$TMP/service.yaml"

echo "== ジョブ ${APP}-tools"
# shellcheck disable=SC2054  # --args の値のカンマは gcloud の区切り（配列の区切りではない）
JOB_FLAGS=(--image="$IMAGE_TOOLS" --service-account="$APP_SA" --set-cloudsql-instances="$SQL_CONNECTION"
  --env-vars-file="$TMP/tools.yaml"
  --set-secrets="DATABASE_URL=${APP}-database-url:latest,SEED_DEMO_PASSWORD=${APP}-seed-password:latest"
  --command=bash --args=scripts/tools.sh,migrate
  --tasks=1 --max-retries=0 --task-timeout=900 --cpu=1 --memory=1Gi)
if gcloud run jobs describe "${APP}-tools" "${P[@]}" >/dev/null 2>&1; then
  gcloud run jobs update "${APP}-tools" "${P[@]}" "${JOB_FLAGS[@]}"
else
  gcloud run jobs create "${APP}-tools" "${P[@]}" "${JOB_FLAGS[@]}"
fi

echo "== マイグレーション"
bash infra/run_job.sh migrate

echo "== サービス ${APP}"
# 画面は公開する（ログインはアプリで行う）。allUsers を付けずに、起動元の IAM チェックを無効にする
gcloud run deploy "$APP" "${P[@]}" --image="$IMAGE_APP" --service-account="$APP_SA" \
  --add-cloudsql-instances="$SQL_CONNECTION" --env-vars-file="$TMP/service.yaml" \
  --set-secrets="DATABASE_URL=${APP}-database-url:latest,AUTH_SECRET=${APP}-auth-secret:latest" \
  --no-invoker-iam-check --port=8080 --cpu=1 --memory=1Gi --concurrency=40 --timeout=300 \
  --min-instances="$MIN_INSTANCES" --max-instances="$MAX_INSTANCES" --execution-environment=gen2 --cpu-boost

echo "== サービス ${APP}-budget-stop"
# 非公開（何も付けなければ非公開。Pub/Sub の push は ${APP}-pubsub-invoker の OIDC トークンで呼ぶ）
gcloud run deploy "${APP}-budget-stop" "${P[@]}" --image="$IMAGE_TOOLS" --service-account="$BUDGET_STOP_SA" \
  --command=node --args=scripts/budget-stop.mjs --port=8080 \
  --set-env-vars="GCP_PROJECT_ID=${GCP_PROJECT_ID},AUTO_STOP_ENABLED=${AUTO_STOP_ENABLED}" \
  --min-instances=0 --max-instances=1 --cpu=1 --memory=512Mi

echo "== 起動の確認 ${SERVICE_URL}/api/health"
for i in 1 2 3 4 5 6; do
  if curl -fsS --max-time 30 "${SERVICE_URL}/api/health"; then
    echo
    echo "デプロイしました：${SERVICE_URL}"
    exit 0
  fi
  sleep $((i * 5))
done
echo "::error::ヘルスチェックに失敗しました（${SERVICE_URL}/api/health）" >&2
exit 1
