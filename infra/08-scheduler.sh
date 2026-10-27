#!/usr/bin/env bash
# §10.1 手順9：Cloud Scheduler のジョブを登録する
#   使い方：infra/08-scheduler.sh <demo|production> [--run-now]
#
#   毎朝のまとめ通知  POST /api/internal/cron/daily-digest     平日 8:00（日本時間）
#   受入催促          POST /api/internal/cron/accept-reminder  平日 8:00〜18:00 の毎正時（日本時間）
#
# 認証：Cloud Scheduler がスケジューラSAの OIDC トークン（audience = Cloud Run のURL）を付けて呼ぶ。
#       アプリは audience が CRON_OIDC_AUDIENCE、メールアドレスが CRON_SERVICE_ACCOUNT と一致することを確認する。
# スケジューラSAには、このサービスに限って roles/run.invoker を付ける
#   （サービスは公開中のため現状は不要。将来 IAM で非公開にしてもそのまま動くようにするため）。
# --run-now を付けると、登録後に2つのジョブを1回ずつ実行して動作を確かめる。
# 何度実行しても同じ結果になる（既存のジョブは設定を上書きする）。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
load_env "${1:-}"
shift || true

RUN_NOW=0
while (($#)); do
  case "$1" in
    --run-now) RUN_NOW=1 ;;
    *) die "不明なオプション：$1" ;;
  esac
  shift
done

require_gcloud_login

SERVICE_URL="$(service_url)"
[[ -n "$SERVICE_URL" ]] || die "Cloud Run サービス ${SERVICE_NAME} がありません。先に 07-deploy.sh を実行してください。"
SERVICE_URL="${SERVICE_URL%/}"
# アプリ側の CRON_OIDC_AUDIENCE と同じ値（07-deploy.sh が Cloud Run のURLを設定している）
AUDIENCE="$SERVICE_URL"

gcloud iam service-accounts describe "$SCHEDULER_SA" >/dev/null 2>&1 ||
  die "スケジューラSAがありません。先に 04-service-accounts.sh を実行してください。"

log "スケジューラSA（${SCHEDULER_SA}）に ${SERVICE_NAME} の roles/run.invoker を付与"
gcloud run services add-iam-policy-binding "$SERVICE_NAME" \
  --region="$REGION" \
  --member="serviceAccount:${SCHEDULER_SA}" \
  --role=roles/run.invoker >/dev/null
ok "付与しました"

# 引数：ジョブ名、スケジュール、パス、説明
ensure_http_job() {
  local name="$1" schedule="$2" path="$3" description="$4"
  local common=(
    --location="$SCHEDULER_LOCATION"
    --schedule="$schedule"
    --time-zone="$SCHEDULER_TIME_ZONE"
    --uri="${SERVICE_URL}${path}"
    --http-method=POST
    --message-body='{}'
    --oidc-service-account-email="$SCHEDULER_SA"
    --oidc-token-audience="$AUDIENCE"
    --attempt-deadline=300s
    --max-retry-attempts=1
    --min-backoff=60s
    --description="$description"
  )
  if gcloud scheduler jobs describe "$name" --location="$SCHEDULER_LOCATION" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "$name" "${common[@]}" \
      --update-headers="Content-Type=application/json" >/dev/null
    ok "${name} を更新しました（${schedule} ${SCHEDULER_TIME_ZONE}）"
  else
    gcloud scheduler jobs create http "$name" "${common[@]}" \
      --headers="Content-Type=application/json" >/dev/null
    ok "${name} を作成しました（${schedule} ${SCHEDULER_TIME_ZONE}）"
  fi
}

log "Cloud Scheduler ジョブ（${SCHEDULER_LOCATION}）"
ensure_http_job "$DIGEST_JOB" "$DIGEST_SCHEDULE" "/api/internal/cron/daily-digest" "毎朝のまとめ通知（平日）"
ensure_http_job "$REMINDER_JOB" "$REMINDER_SCHEDULE" "/api/internal/cron/accept-reminder" "受入催促（平日の業務時間）"

if ((RUN_NOW)); then
  log "動作確認のため1回ずつ実行します"
  gcloud scheduler jobs run "$DIGEST_JOB" --location="$SCHEDULER_LOCATION" >/dev/null
  gcloud scheduler jobs run "$REMINDER_JOB" --location="$SCHEDULER_LOCATION" >/dev/null
  ok "実行を依頼しました。結果は Cloud Scheduler の画面（最終実行の結果）と Cloud Run のログで確認してください。"
fi

ok "Cloud Scheduler の準備ができました"
