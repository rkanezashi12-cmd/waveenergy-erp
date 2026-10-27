#!/usr/bin/env bash
# 管理用のコマンドを Cloud Run ジョブ ${APP}-tools で実行し、出力（Cloud Logging）を表示する。
# 定期処理（毎朝のまとめ・受入催促）は Cloud Scheduler のジョブを今すぐ実行し、サービスのログを表示する。
#   bash infra/run_job.sh <migrate | status | seed | create-admin | models | digest | reminder>
#   create-admin は ADMIN_EMAIL・ADMIN_NAME（任意で ADMIN_DEPARTMENT）を環境変数で渡す。
set -euo pipefail

: "${APP:?}" "${GCP_PROJECT_ID:?}" "${REGION:?}"
COMMAND="${1:?command を指定してください}"
P=(--project="$GCP_PROJECT_ID" --region="$REGION" --quiet)

# 定期処理：Cloud Scheduler のジョブを今すぐ実行して、アプリのログを見る
if [ "$COMMAND" = "digest" ] || [ "$COMMAND" = "reminder" ]; then
  if [ "$COMMAND" = "digest" ]; then JOB="${APP}-daily-digest"; MSG="毎朝のまとめ通知"; else JOB="${APP}-accept-reminder"; MSG="受入催促"; fi
  SINCE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  gcloud scheduler jobs run "$JOB" --location="$REGION" --project="$GCP_PROJECT_ID" --quiet
  FILTER="resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${APP}\" AND timestamp>=\"${SINCE}\" AND (httpRequest.requestUrl:\"/api/internal/cron/\" OR jsonPayload.message:\"${MSG}\")"
  for i in 1 2 3 4 5 6 7 8 9; do
    sleep 10
    LOGS="$(gcloud logging read "$FILTER" --project="$GCP_PROJECT_ID" --order=asc --limit=50 \
      --format='value(httpRequest.status,httpRequest.requestUrl,jsonPayload.message,jsonPayload.sent,jsonPayload.reminded,jsonPayload.skipped)')"
    if [ -n "$LOGS" ] && grep -q "$MSG\|401\|500" <<<"$LOGS"; then break; fi
  done
  echo "== 出力（HTTPステータス・URL・メッセージ・件数）"
  echo "${LOGS:-（ログがまだありません）}"
  if grep -q "^401" <<<"${LOGS:-}"; then echo "::error::定期処理の認証に失敗しました（401）" >&2; exit 1; fi
  exit 0
fi

case "$COMMAND" in
  migrate | status | seed | models) EXTRA=() ;;
  create-admin)
    : "${ADMIN_EMAIL:?ADMIN_EMAIL を指定してください}" "${ADMIN_NAME:?ADMIN_NAME を指定してください}"
    # 値にカンマが入っても壊れないよう、区切り文字を | に変える（gcloud の書き方。@ はメールアドレスに含まれるので使わない）
    EXTRA=(--update-env-vars="^|^ADMIN_EMAIL=${ADMIN_EMAIL}|ADMIN_NAME=${ADMIN_NAME}|ADMIN_DEPARTMENT=${ADMIN_DEPARTMENT:-}")
    ;;
  *) echo "知らない command です：$COMMAND" >&2; exit 2 ;;
esac

echo "== 実行：scripts/tools.sh ${COMMAND}"
status=0
gcloud run jobs execute "${APP}-tools" "${P[@]}" --args="scripts/tools.sh,${COMMAND}" "${EXTRA[@]}" --wait || status=$?
EXEC="$(gcloud run jobs executions list --job="${APP}-tools" "${P[@]}" --limit=1 --sort-by=~metadata.creationTimestamp --format='value(metadata.name)')"
echo "== 実行の名前：${EXEC}（終了コード ${status}）"

FILTER="resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"${APP}-tools\" AND labels.\"run.googleapis.com/execution_name\"=\"${EXEC}\""
# ログは数十秒遅れて届くことがあるので、出るまで待つ
LOGS=""
for i in 1 2 3 4 5 6 7 8 9; do
  LOGS="$(gcloud logging read "$FILTER" --project="$GCP_PROJECT_ID" --order=asc --limit=2000 --freshness=2h \
    --format='value(textPayload)')"
  if [ -n "$LOGS" ] && { [ "$status" -ne 0 ] || grep -q "Container called exit" <<<"$LOGS" || [ "$i" -ge 3 ]; }; then
    break
  fi
  sleep 10
done
echo "== 出力"
grep -v -e "^Container called exit" <<<"$LOGS" || true
exit "$status"
