#!/usr/bin/env bash
# GCP を用意する（スキル gcp-bootstrap の形）。Cloud Shell で1回だけ実行する。何度実行しても同じ状態になる。
#
#   PROJECT_ID=waveenergy-erp GITHUB_REPO=rkanezashi12-cmd/waveenergy-erp bash infra/setup.sh
#
# 作るもの（すべて PROJECT_ID のプロジェクトの中だけ。gcloud の既定のプロジェクトは変えない）
#   - API の有効化
#   - サービスアカウント：${APP}-app（アプリの実行）、${APP}-deployer（GitHub Actions）、${APP}-scheduler（定期処理の呼び出し）、
#     ${APP}-budget-stop（予算超過で停止）、${APP}-pubsub-invoker（予算の通知を停止のサービスに届ける）
#   - GitHub Actions からの鍵なし認証（Workload Identity 連携。GITHUB_REPO のリポジトリだけ）
#   - Artifact Registry（コンテナイメージ。最新3つだけ残す）
#   - Cloud Storage（AI下書きの入力ファイルの一時保存。30日で自動削除。非公開）
#   - Cloud SQL for PostgreSQL（インスタンス・データベース・ユーザー。自動バックアップ7日・ポイントインタイムリカバリ）
#   - Secret Manager：DB の接続文字列、Auth.js の鍵、デモユーザーの初期パスワード
#   - Cloud Scheduler：毎朝のまとめ通知・受入催促（OIDC トークンでアプリを呼ぶ）
#   - Pub/Sub と予算（AUTO_STOP=true なら予算の 100% で請求先を外して止める。デモ用。本番は AUTO_STOP=false）
#
# Cloud Run のサービス・ジョブは GitHub Actions（.github/workflows/gcp.yml → infra/deploy.sh）が作る。
# Cloud SQL のインスタンスを初めて作るときは 10〜15 分かかる。
set -euo pipefail

: "${PROJECT_ID:?PROJECT_ID を指定してください}"
: "${GITHUB_REPO:?GITHUB_REPO（owner/repo）を指定してください}"
APP="${APP:-weorder}"
REGION="${REGION:-asia-northeast1}"
ENV_NAME="${ENV_NAME:-demo}"
AUTO_STOP="${AUTO_STOP:-true}"
BUDGET_AMOUNT="${BUDGET_AMOUNT:-}"           # 請求先アカウントの通貨で。空なら JPY は 5000、それ以外は 35
SQL_TIER="${SQL_TIER:-db-f1-micro}"          # デモは最小構成。本番は db-custom-1-3840 など【要確認】
SQL_AVAILABILITY="${SQL_AVAILABILITY:-zonal}" # 本番で高可用性にするなら regional（費用は約2倍）
SQL_INSTANCE="${APP}-db"
DB_NAME="we_order"
DB_USER="we_app"
UPLOAD_BUCKET="${PROJECT_ID}-${APP}-uploads"
AR_REPO="${APP}"
SERVICE="${APP}"
POOL="github"
P=(--project="$PROJECT_ID" --quiet)

say() { printf '\n== %s\n' "$*"; }
sa_email() { echo "$1@${PROJECT_ID}.iam.gserviceaccount.com"; }
random_alnum() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1" || true; }

# IAM は作った直後に反映が遅れることがあるので、数回やり直す
retry() {
  local n=0
  until "$@" >/dev/null; do
    n=$((n + 1))
    if [ "$n" -ge 5 ]; then
      echo "失敗しました：$*" >&2
      return 1
    fi
    sleep $((n * 5))
  done
}

project_role() { retry gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$1" --role="$2" --condition=None --quiet; }

ensure_sa() {
  local email
  email="$(sa_email "$1")"
  if ! gcloud iam service-accounts describe "$email" "${P[@]}" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$1" --display-name="$2" "${P[@]}"
  fi
}

# シークレットが無ければ作る（値は標準入力から）。既にあれば変えない
ensure_secret_value() {
  local name="$1" value="$2"
  if ! gcloud secrets describe "$name" "${P[@]}" >/dev/null 2>&1; then
    gcloud secrets create "$name" --replication-policy=user-managed --locations="$REGION" "${P[@]}" >/dev/null
  fi
  if [ -z "$(gcloud secrets versions list "$name" --filter='state=ENABLED' --limit=1 --format='value(name)' "${P[@]}")" ]; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- "${P[@]}" >/dev/null
  fi
}
secret_value() { gcloud secrets versions access latest --secret="$1" "${P[@]}"; }

# ---------------------------------------------------------------
say "対象：プロジェクト ${PROJECT_ID}（リージョン ${REGION}、リポジトリ ${GITHUB_REPO}、環境 ${ENV_NAME}）"
if [ "${YES:-}" != "1" ]; then
  read -r -p "このプロジェクトに作ります。よければ y： " ans
  case "$ans" in
    y | Y | yes | YES | Yes) ;;
    *) echo "やめました"; exit 1 ;;
  esac
fi

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
# Cloud Run の URL は「サービス名-プロジェクト番号.リージョン.run.app」で決まるので、サービスより先に使える
SERVICE_URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
STOP_URL="https://${APP}-budget-stop-${PROJECT_NUMBER}.${REGION}.run.app"

say "請求先の確認"
BILLING_ENABLED="$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)')"
BILLING_ACCOUNT="$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingAccountName)')"
BILLING_ACCOUNT="${BILLING_ACCOUNT#billingAccounts/}"
if [ "$BILLING_ENABLED" != "True" ] || [ -z "$BILLING_ACCOUNT" ]; then
  echo "請求先アカウントがつながっていません。コンソールの「お支払い」→「請求先アカウントをリンク」でつないでから、もう一度実行してください" >&2
  exit 1
fi

say "API を有効にする（数分かかることがあります）"
gcloud services enable \
  run.googleapis.com artifactregistry.googleapis.com iam.googleapis.com iamcredentials.googleapis.com \
  sts.googleapis.com cloudresourcemanager.googleapis.com storage.googleapis.com aiplatform.googleapis.com \
  secretmanager.googleapis.com logging.googleapis.com pubsub.googleapis.com cloudbilling.googleapis.com \
  billingbudgets.googleapis.com sqladmin.googleapis.com cloudscheduler.googleapis.com "${P[@]}"

say "サービスアカウント"
ensure_sa "${APP}-app" "${APP} アプリ（実行）"
ensure_sa "${APP}-deployer" "${APP} GitHub Actions（デプロイ）"
ensure_sa "${APP}-scheduler" "${APP} 定期処理の呼び出し"
ensure_sa "${APP}-budget-stop" "${APP} 予算超過で停止"
ensure_sa "${APP}-pubsub-invoker" "${APP} 予算の通知を届ける"
APP_SA="$(sa_email "${APP}-app")"
DEPLOYER_SA="$(sa_email "${APP}-deployer")"
SCHEDULER_SA="$(sa_email "${APP}-scheduler")"
STOP_SA="$(sa_email "${APP}-budget-stop")"
INVOKER_SA="$(sa_email "${APP}-pubsub-invoker")"

project_role "$APP_SA" roles/aiplatform.user
project_role "$APP_SA" roles/logging.logWriter
project_role "$APP_SA" roles/cloudsql.client
# アプリは画面を公開する（ログインはアプリで行う）ため、起動元の IAM チェックを無効にしてデプロイする。
# その設定に run.admin が要る（run.developer では足りない）
project_role "$DEPLOYER_SA" roles/run.admin
project_role "$DEPLOYER_SA" roles/logging.viewer
project_role "$DEPLOYER_SA" roles/cloudscheduler.jobRunner
project_role "$SCHEDULER_SA" roles/run.invoker
project_role "$STOP_SA" roles/billing.projectManager
project_role "$STOP_SA" roles/logging.logWriter
project_role "$INVOKER_SA" roles/run.invoker
for sa in "$APP_SA" "$STOP_SA"; do
  retry gcloud iam service-accounts add-iam-policy-binding "$sa" \
    --member="serviceAccount:$DEPLOYER_SA" --role=roles/iam.serviceAccountUser "${P[@]}"
done

say "GitHub Actions からの鍵なし認証（Workload Identity 連携）"
if ! gcloud iam workload-identity-pools describe "$POOL" --location=global "${P[@]}" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub Actions" "${P[@]}"
fi
if ! gcloud iam workload-identity-pools providers describe github --workload-identity-pool="$POOL" --location=global "${P[@]}" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc github \
    --workload-identity-pool="$POOL" --location=global --display-name="GitHub" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository=='${GITHUB_REPO}'" "${P[@]}"
fi
retry gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${GITHUB_REPO}" \
  "${P[@]}"
WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/github"

say "Artifact Registry"
if ! gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" "${P[@]}" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$AR_REPO" --repository-format=docker --location="$REGION" \
    --description="${APP} のイメージ" "${P[@]}"
fi
POLICY="$(mktemp)"
cat >"$POLICY" <<'JSON'
[
  {"name": "keep-latest-3", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 3}},
  {"name": "delete-older", "action": {"type": "Delete"}, "condition": {"tagState": "ANY", "olderThan": "1d"}}
]
JSON
gcloud artifacts repositories set-cleanup-policies "$AR_REPO" --location="$REGION" --policy="$POLICY" "${P[@]}" >/dev/null
rm -f "$POLICY"
retry gcloud artifacts repositories add-iam-policy-binding "$AR_REPO" --location="$REGION" \
  --member="serviceAccount:$DEPLOYER_SA" --role=roles/artifactregistry.writer "${P[@]}"

say "Cloud Storage（AI下書きの入力ファイル。30日で自動削除。非公開）"
if ! gcloud storage buckets describe "gs://$UPLOAD_BUCKET" "${P[@]}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://$UPLOAD_BUCKET" --location="$REGION" --uniform-bucket-level-access \
    --public-access-prevention --soft-delete-duration=0 "${P[@]}"
fi
LIFECYCLE="$(mktemp)"
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}' >"$LIFECYCLE"
gcloud storage buckets update "gs://$UPLOAD_BUCKET" --lifecycle-file="$LIFECYCLE" "${P[@]}" >/dev/null
rm -f "$LIFECYCLE"
retry gcloud storage buckets add-iam-policy-binding "gs://$UPLOAD_BUCKET" \
  --member="serviceAccount:$APP_SA" --role=roles/storage.objectAdmin "${P[@]}"

say "Cloud SQL（PostgreSQL 16）"
if ! gcloud sql instances describe "$SQL_INSTANCE" "${P[@]}" >/dev/null 2>&1; then
  echo "インスタンスを作ります（10〜15分かかります。そのままお待ちください）"
  gcloud sql instances create "$SQL_INSTANCE" --database-version=POSTGRES_16 --edition=enterprise \
    --tier="$SQL_TIER" --region="$REGION" --availability-type="$SQL_AVAILABILITY" \
    --storage-type=SSD --storage-size=10 --storage-auto-increase \
    --backup-start-time=18:00 --retained-backups-count=7 \
    --enable-point-in-time-recovery --retained-transaction-log-days=7 \
    --maintenance-window-day=SUN --maintenance-window-hour=18 --deletion-protection "${P[@]}"
fi
if ! gcloud sql databases describe "$DB_NAME" --instance="$SQL_INSTANCE" "${P[@]}" >/dev/null 2>&1; then
  gcloud sql databases create "$DB_NAME" --instance="$SQL_INSTANCE" --charset=UTF8 "${P[@]}" >/dev/null
fi
SQL_CONNECTION="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"
ensure_secret_value "${APP}-db-password" "$(random_alnum 32)"
DB_PASSWORD="$(secret_value "${APP}-db-password")"
if ! gcloud sql users list --instance="$SQL_INSTANCE" --format='value(name)' "${P[@]}" | grep -qx "$DB_USER"; then
  gcloud sql users create "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASSWORD" "${P[@]}" >/dev/null
fi

say "Secret Manager"
ensure_secret_value "${APP}-database-url" "postgresql://${DB_USER}:${DB_PASSWORD}@localhost/${DB_NAME}?host=/cloudsql/${SQL_CONNECTION}"
unset DB_PASSWORD
ensure_secret_value "${APP}-auth-secret" "$(random_alnum 48)"
ensure_secret_value "${APP}-seed-password" "Demo$(random_alnum 10)7"
for s in database-url auth-secret seed-password; do
  retry gcloud secrets add-iam-policy-binding "${APP}-${s}" \
    --member="serviceAccount:$APP_SA" --role=roles/secretmanager.secretAccessor "${P[@]}"
done

say "Cloud Scheduler（毎朝のまとめ通知・受入催促。OIDC トークンでアプリを呼ぶ）"
scheduler_job() {
  local name="$1" schedule="$2" path="$3" desc="$4" verb=create
  if gcloud scheduler jobs describe "$name" --location="$REGION" "${P[@]}" >/dev/null 2>&1; then verb=update; fi
  gcloud scheduler jobs "$verb" http "$name" --location="$REGION" --schedule="$schedule" --time-zone=Asia/Tokyo \
    --uri="${SERVICE_URL}${path}" --http-method=POST \
    --oidc-service-account-email="$SCHEDULER_SA" --oidc-token-audience="$SERVICE_URL" \
    --attempt-deadline=300s --max-retry-attempts=1 --description="$desc" "${P[@]}" >/dev/null
}
scheduler_job "${APP}-daily-digest" "0 8 * * 1-5" /api/internal/cron/daily-digest "平日 8:00 毎朝のまとめ通知"
scheduler_job "${APP}-accept-reminder" "0 8-18 * * 1-5" /api/internal/cron/accept-reminder "平日 8〜18時 受入催促"

say "Pub/Sub（予算の通知）"
if ! gcloud pubsub topics describe budget-alerts "${P[@]}" >/dev/null 2>&1; then
  gcloud pubsub topics create budget-alerts "${P[@]}"
fi
if ! gcloud pubsub subscriptions describe budget-stop-push "${P[@]}" >/dev/null 2>&1; then
  gcloud pubsub subscriptions create budget-stop-push --topic=budget-alerts \
    --push-endpoint="${STOP_URL}/pubsub/budget" --push-auth-service-account="$INVOKER_SA" \
    --push-auth-token-audience="$STOP_URL" --ack-deadline=60 "${P[@]}"
fi

say "予算（月の上限と通知）"
CURRENCY="$(gcloud billing accounts describe "$BILLING_ACCOUNT" --format='value(currencyCode)')"
if [ -z "$BUDGET_AMOUNT" ]; then
  if [ "$CURRENCY" = "JPY" ]; then BUDGET_AMOUNT=5000; else BUDGET_AMOUNT=35; fi
fi
BUDGET_NAME="${PROJECT_ID} 自動停止"
if [ -z "$(gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" \
  --filter="displayName=\"${BUDGET_NAME}\"" --format='value(name)' 2>/dev/null)" ]; then
  if ! gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" --display-name="$BUDGET_NAME" \
    --budget-amount="${BUDGET_AMOUNT}${CURRENCY}" --filter-projects="projects/${PROJECT_ID}" \
    --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 \
    --notifications-rule-pubsub-topic="projects/${PROJECT_ID}/topics/budget-alerts" --quiet; then
    echo "予算を作れませんでした（請求先アカウントの権限が必要）。コンソールの「予算とアラート」で作り、Pub/Sub のトピック budget-alerts をつないでください" >&2
  fi
fi

say "できました。次の内容をそのまま Claude に貼ってください"
cat <<EOF
APP=${APP}
GCP_PROJECT_ID=${PROJECT_ID}
GCP_PROJECT_NUMBER=${PROJECT_NUMBER}
REGION=${REGION}
WIF_PROVIDER=${WIF_PROVIDER}
DEPLOYER_SA=${DEPLOYER_SA}
SERVICE_URL=${SERVICE_URL}
SQL_CONNECTION=${SQL_CONNECTION}
BUDGET=${BUDGET_AMOUNT}${CURRENCY} AUTO_STOP=${AUTO_STOP}
EOF

cat <<EOF

（ここから下は Claude に貼らないでください）
デモユーザーの初期パスワードは次のコマンドで表示できます。ログインに使います。
  gcloud secrets versions access latest --secret=${APP}-seed-password --project=${PROJECT_ID}
EOF
