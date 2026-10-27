# shellcheck shell=bash
# shellcheck disable=SC2034 # ここで定義する変数は、読み込み元のスクリプトで使う
# infra/ の各スクリプトが読み込む共通設定・共通関数
#
# 使い方（各スクリプトの先頭で）
#   source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
#   load_env "$1"      # demo / production、または設定ファイルのパス
#
# 設定ファイル：infra/config/<環境名>.env
#   infra/config/demo.env.example をコピーして作る（*.env は Git に含めない）。
#   プロジェクトIDなどの環境固有値は、この設定ファイルだけに書く（SPEC §0-6）。

# コマンド置換の中でも set -e を効かせる（bash 4.4 以降。macOS 標準の bash 3.2 では無視）
shopt -s inherit_errexit 2>/dev/null || true

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${INFRA_DIR}/.." && pwd)"

# ───────────── 表示 ─────────────

log() { printf '\033[1;34m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
ok() { printf '\033[1;32m  ✔\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33m  ⚠ %s\033[0m\n' "$*" >&2; }
die() {
  printf '\033[1;31mエラー：%s\033[0m\n' "$*" >&2
  exit 1
}

# ───────────── 設定ファイルの読み込み ─────────────

usage_env() {
  cat >&2 <<EOF
使い方：$(basename "$0") <環境名 または 設定ファイルのパス> [オプション]
  例：$(basename "$0") demo
      $(basename "$0") production
      $(basename "$0") ./infra/config/demo.env
設定ファイルは infra/config/<環境名>.env（demo.env.example をコピーして作成）。
EOF
}

load_env() {
  local arg="${1:-}"
  [[ -n "$arg" ]] || {
    usage_env
    exit 2
  }
  local file
  if [[ -f "$arg" ]]; then
    file="$arg"
  else
    file="${INFRA_DIR}/config/${arg}.env"
  fi
  [[ -f "$file" ]] || die "設定ファイルが見つかりません：${file}（${INFRA_DIR}/config/${arg}.env.example をコピーして作成してください）"

  set -a
  # shellcheck disable=SC1090
  source "$file"
  set +a
  ENV_FILE="$file"

  # 必須項目
  local v
  for v in PROJECT_ID REGION APP_ENV SERVICE_NAME AR_REPOSITORY SQL_INSTANCE DB_NAME DB_USER UPLOAD_BUCKET; do
    [[ -n "${!v:-}" ]] || die "設定ファイル ${file} に ${v} がありません。"
  done
  [[ "$PROJECT_ID" != "CHANGE-ME" && "$PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] ||
    die "設定ファイル ${file} の PROJECT_ID が正しくありません（現在：${PROJECT_ID}）。"
  [[ "$APP_ENV" == "demo" || "$APP_ENV" == "production" ]] || die "APP_ENV は demo か production にしてください（現在：${APP_ENV}）。"

  # 既定値（設定ファイルで上書きできる）
  : "${APP_IMAGE_NAME:=we-order-app}"
  : "${TOOLS_IMAGE_NAME:=we-order-tools}"
  : "${SECRET_PREFIX:=we-order-}"
  : "${RUNTIME_SA_NAME:=we-order-runtime}"
  : "${DEPLOYER_SA_NAME:=we-order-deployer}"
  : "${SCHEDULER_SA_NAME:=we-order-scheduler}"
  : "${DEPLOYER_RUN_ROLE:=roles/run.admin}"
  : "${MIGRATE_JOB:=we-order-migrate}"
  : "${SEED_JOB:=we-order-seed}"
  : "${CREATE_ADMIN_JOB:=we-order-create-admin}"
  : "${SQL_DATABASE_VERSION:=POSTGRES_16}"
  : "${SQL_EDITION:=enterprise}"
  : "${SQL_TIER:=db-f1-micro}"
  : "${SQL_STORAGE_SIZE_GB:=10}"
  : "${SQL_AVAILABILITY_TYPE:=zonal}"
  : "${SQL_BACKUP_START_TIME:=18:00}"
  : "${SQL_RETAINED_BACKUPS:=7}"
  : "${SQL_PITR_LOG_DAYS:=7}"
  : "${SQL_DELETION_PROTECTION:=true}"
  : "${UPLOAD_RETENTION_DAYS:=30}"
  : "${BUILD_MODE:=cloudbuild}"
  : "${BUILD_STAGING_BUCKET:=${PROJECT_ID}-build-src}"
  : "${WIF_POOL_ID:=github}"
  : "${WIF_PROVIDER_ID:=github-actions}"
  : "${GITHUB_REPOSITORY:=}"
  : "${GITHUB_ENVIRONMENT:=${APP_ENV}}"
  : "${GITHUB_BRANCH:=}"
  : "${RUN_MIN_INSTANCES:=0}"
  : "${RUN_MAX_INSTANCES:=3}"
  : "${RUN_CPU:=1}"
  : "${RUN_MEMORY:=1Gi}"
  : "${RUN_CONCURRENCY:=40}"
  : "${RUN_TIMEOUT:=300}"
  : "${PUBLIC_ACCESS_MODE:=no-invoker-iam-check}"
  : "${APP_BASE_URL:=}"
  : "${DB_POOL_MAX:=5}"
  : "${AUTH_PASSWORD_LOGIN:=true}"
  : "${MAIL_TRANSPORT:=db}"
  : "${MAIL_FROM:=no-reply@example.com}"
  : "${AI_PROVIDER:=vertex}"
  : "${GEMINI_MODEL:=gemini-2.5-flash}"
  : "${VERTEX_LOCATION:=asia-northeast1}"
  : "${SEED_MUST_CHANGE_PASSWORD:=true}"
  : "${SEED_SAMPLE_ORDERS:=true}"
  : "${SEED_DEMO_USERS:=true}"
  : "${SCHEDULER_LOCATION:=${REGION}}"
  : "${SCHEDULER_TIME_ZONE:=Asia/Tokyo}"
  : "${DIGEST_JOB:=we-order-daily-digest}"
  : "${DIGEST_SCHEDULE:=0 8 * * 1-5}"
  : "${REMINDER_JOB:=we-order-accept-reminder}"
  : "${REMINDER_SCHEDULE:=0 8-18 * * 1-5}"
  : "${LABELS:=app=we-order,env=${APP_ENV}}"

  # 派生値
  RUNTIME_SA="${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
  DEPLOYER_SA="${DEPLOYER_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
  SCHEDULER_SA="${SCHEDULER_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
  AR_HOST="${REGION}-docker.pkg.dev"
  APP_IMAGE="${AR_HOST}/${PROJECT_ID}/${AR_REPOSITORY}/${APP_IMAGE_NAME}"
  TOOLS_IMAGE="${AR_HOST}/${PROJECT_ID}/${AR_REPOSITORY}/${TOOLS_IMAGE_NAME}"
  SQL_CONNECTION_NAME="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"

  # Secret Manager のシークレット名（アプリの環境変数名 ← シークレット名）
  SECRET_DATABASE_URL="${SECRET_PREFIX}database-url"
  SECRET_DB_PASSWORD="${SECRET_PREFIX}db-password"
  SECRET_AUTH_SECRET="${SECRET_PREFIX}auth-secret"
  SECRET_SEED_DEMO_PASSWORD="${SECRET_PREFIX}seed-demo-password"
  SECRET_INITIAL_ADMIN_PASSWORD="${SECRET_PREFIX}initial-admin-password"
  SECRET_SMTP_PASSWORD="${SECRET_PREFIX}smtp-password"
  SECRET_GRAPH_CLIENT_SECRET="${SECRET_PREFIX}graph-client-secret"
  SECRET_ENTRA_CLIENT_SECRET="${SECRET_PREFIX}entra-client-secret"

  # 以降の gcloud はすべてこのプロジェクトに対して実行する
  export CLOUDSDK_CORE_PROJECT="$PROJECT_ID"
  export CLOUDSDK_CORE_DISABLE_PROMPTS=1

  log "設定：${file}（プロジェクト：${PROJECT_ID}、リージョン：${REGION}、APP_ENV：${APP_ENV}）"
}

# ───────────── 前提チェック ─────────────

require_cmd() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || die "コマンド ${c} が見つかりません。インストールしてください。"
  done
}

require_gcloud_login() {
  require_cmd gcloud
  local account
  account="$(gcloud config get-value account 2>/dev/null || true)"
  [[ -n "$account" ]] || die "gcloud にログインしていません。gcloud auth login を実行してください。"
  gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1 ||
    die "プロジェクト ${PROJECT_ID} にアクセスできません（プロジェクトIDと権限を確認してください）。"
  log "実行アカウント：${account}"
}

project_number() {
  gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)'
}

# 確認プロンプト（--yes / ASSUME_YES=1 で省略）
confirm() {
  local msg="$1"
  if [[ "${ASSUME_YES:-0}" == "1" ]]; then return 0; fi
  [[ -t 0 ]] || die "${msg}（対話できないため中止しました。続行する場合は ASSUME_YES=1 を付けてください）"
  local ans
  read -r -p "${msg} [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]]
}

# ───────────── 乱数 ─────────────

# URLに埋め込んでも安全な英数字だけのランダム文字列
random_alnum() {
  local len="${1:-32}" s="" chunk
  while ((${#s} < len)); do
    chunk="$(openssl rand -base64 48)" || die "openssl rand に失敗しました。"
    chunk="$(printf '%s' "$chunk" | tr -dc 'A-Za-z0-9')"
    [[ -n "$chunk" ]] || die "乱数を生成できませんでした。"
    s+="$chunk"
  done
  printf '%s' "${s:0:len}"
}

# Auth.js 用の秘密鍵（base64、48バイト）
random_base64_secret() {
  local v
  v="$(openssl rand -base64 48)" || die "openssl rand に失敗しました。"
  v="$(printf '%s' "$v" | tr -d '\n')"
  ((${#v} >= 60)) || die "乱数を生成できませんでした。"
  printf '%s' "$v"
}

# アプリのパスワード条件（8文字以上・英字と数字を含む）を満たす初期パスワード
random_app_password() {
  local s
  s="$(random_alnum 14)" || exit 1
  printf 'We%s7' "$s"
}

# ───────────── Secret Manager ─────────────
# 値は標準入力で渡し、画面やプロセス一覧に出さない。

secret_exists() {
  gcloud secrets describe "$1" >/dev/null 2>&1
}

secret_has_version() {
  [[ -n "$(gcloud secrets versions list "$1" --filter='state:ENABLED' --limit=1 --format='value(name)' 2>/dev/null)" ]]
}

# シークレットの入れ物を作る（東京リージョンにだけ複製を置く）
ensure_secret() {
  local name="$1"
  if secret_exists "$name"; then
    ok "シークレット ${name} は作成済み"
  else
    gcloud secrets create "$name" \
      --replication-policy=user-managed \
      --locations="$REGION" \
      --labels="$LABELS" >/dev/null
    ok "シークレット ${name} を作成しました"
  fi
}

# 標準入力の値を新しいバージョンとして登録する
secret_add_version_stdin() {
  local name="$1"
  gcloud secrets versions add "$name" --data-file=- >/dev/null
}

# 値を新しいバージョンとして登録する（printf はシェル組み込みなのでプロセス一覧に出ない）
secret_put() {
  local name="$1" value="$2"
  printf '%s' "$value" | secret_add_version_stdin "$name"
}

secret_value() {
  gcloud secrets versions access latest --secret="$1"
}

# 最新の値と異なるときだけ新しいバージョンを登録する
secret_put_if_changed() {
  local name="$1" value="$2" current=""
  if secret_has_version "$name"; then
    current="$(secret_value "$name")"
  fi
  if [[ "$current" == "$value" ]]; then
    ok "シークレット ${name} は最新（変更なし）"
  else
    secret_put "$name" "$value"
    ok "シークレット ${name} に新しいバージョンを登録しました"
  fi
}

# ランタイム用サービスアカウントにシークレットの参照権限を付ける（シークレット単位）
grant_secret_access() {
  local name="$1" member="$2"
  gcloud secrets add-iam-policy-binding "$name" \
    --member="$member" \
    --role=roles/secretmanager.secretAccessor \
    --condition=None >/dev/null
  ok "${name} の参照権限を ${member#serviceAccount:} に付与"
}

# ───────────── サービスアカウント・IAM ─────────────

ensure_service_account() {
  local name="$1" display="$2" email="${1}@${PROJECT_ID}.iam.gserviceaccount.com"
  if gcloud iam service-accounts describe "$email" >/dev/null 2>&1; then
    ok "サービスアカウント ${email} は作成済み"
  else
    gcloud iam service-accounts create "$name" --display-name="$display" >/dev/null
    ok "サービスアカウント ${email} を作成しました"
    # 作成直後は IAM に反映されるまで少し時間がかかる
    local _
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      gcloud iam service-accounts describe "$email" >/dev/null 2>&1 && break
      sleep 3
    done
  fi
}

# プロジェクト単位のロール付与（同じ付与は何度実行しても変わらない）
grant_project_role() {
  local member="$1" role="$2"
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="$member" \
    --role="$role" \
    --condition=None >/dev/null
  ok "プロジェクト：${role} → ${member#serviceAccount:}"
}

# ───────────── Cloud Run ─────────────

service_exists() {
  gcloud run services describe "$SERVICE_NAME" --region="$REGION" >/dev/null 2>&1
}

service_url() {
  gcloud run services describe "$SERVICE_NAME" --region="$REGION" --format='value(status.url)' 2>/dev/null || true
}

run_job_exists() {
  gcloud run jobs describe "$1" --region="$REGION" >/dev/null 2>&1
}
