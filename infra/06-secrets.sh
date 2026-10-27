#!/usr/bin/env bash
# §10.1 手順7：Secret Manager に秘密情報を登録し、ランタイムSAに参照権限を付ける
#   使い方：infra/06-secrets.sh <demo|production> [--rotate-auth-secret] [--reset-seed-password]
#
# 登録するシークレット（名前の先頭は SECRET_PREFIX。既定 we-order-）
#   database-url        DATABASE_URL           02-cloudsql.sh で登録済み（ここでは参照権限だけ付ける）
#   auth-secret         AUTH_SECRET            ランダムに生成
#   seed-demo-password  SEED_DEMO_PASSWORD     デモユーザーの初期パスワード。
#                                              環境変数 SEED_DEMO_PASSWORD で指定、未指定なら入力（空ならランダム）
#   smtp-password       SMTP_PASSWORD          任意。環境変数 SMTP_PASSWORD を指定したときだけ登録
#   graph-client-secret GRAPH_CLIENT_SECRET    任意（M9）。環境変数 GRAPH_CLIENT_SECRET を指定したときだけ登録
#   entra-client-secret AUTH_MICROSOFT_ENTRA_ID_SECRET  任意（M9）。同名の環境変数を指定したときだけ登録
#
# 登録済みのシークレットは作り直さない（何度実行しても同じ結果）。
#   --rotate-auth-secret   AUTH_SECRET を作り直す（全員のログインが切れる）
#   --reset-seed-password  デモユーザーの初期パスワードを登録し直す（シードを再実行するまで既存ユーザーには影響しない）
# 任意のシークレットは、指定した値が登録済みの値と違うときだけ新しいバージョンを登録する。
#
# 例：SMTP_PASSWORD='xxxx' infra/06-secrets.sh demo
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

# 設定ファイルを読む前に、コマンドラインで渡された値を退避する（設定ファイルに同名の項目は無い想定）
IN_SEED_DEMO_PASSWORD="${SEED_DEMO_PASSWORD:-}"
IN_SMTP_PASSWORD="${SMTP_PASSWORD:-}"
IN_GRAPH_CLIENT_SECRET="${GRAPH_CLIENT_SECRET:-}"
IN_ENTRA_CLIENT_SECRET="${AUTH_MICROSOFT_ENTRA_ID_SECRET:-}"
unset SEED_DEMO_PASSWORD SMTP_PASSWORD GRAPH_CLIENT_SECRET AUTH_MICROSOFT_ENTRA_ID_SECRET

load_env "${1:-}"
shift || true

ROTATE_AUTH_SECRET=0
RESET_SEED_PASSWORD=0
while (($#)); do
  case "$1" in
    --rotate-auth-secret) ROTATE_AUTH_SECRET=1 ;;
    --reset-seed-password) RESET_SEED_PASSWORD=1 ;;
    *) die "不明なオプション：$1" ;;
  esac
  shift
done

require_gcloud_login
require_cmd openssl

gcloud iam service-accounts describe "$RUNTIME_SA" >/dev/null 2>&1 ||
  die "ランタイムSAがありません。先に 04-service-accounts.sh を実行してください。"
RUNTIME_MEMBER="serviceAccount:${RUNTIME_SA}"

# アプリのパスワード条件（8文字以上・英字と数字を含む）
valid_app_password() {
  local p="$1"
  ((${#p} >= 8)) && [[ "$p" =~ [A-Za-z] ]] && [[ "$p" =~ [0-9] ]]
}

# ───────────── DATABASE_URL ─────────────
log "DATABASE_URL（${SECRET_DATABASE_URL}）"
secret_has_version "$SECRET_DATABASE_URL" ||
  die "${SECRET_DATABASE_URL} が未登録です。先に 02-cloudsql.sh を実行してください。"
ok "登録済み"
grant_secret_access "$SECRET_DATABASE_URL" "$RUNTIME_MEMBER"

# ───────────── AUTH_SECRET ─────────────
log "AUTH_SECRET（${SECRET_AUTH_SECRET}）"
ensure_secret "$SECRET_AUTH_SECRET"
if ! secret_has_version "$SECRET_AUTH_SECRET"; then
  new_secret="$(random_base64_secret)"
  secret_put "$SECRET_AUTH_SECRET" "$new_secret"
  ok "ランダムな値を登録しました"
elif ((ROTATE_AUTH_SECRET)); then
  confirm "AUTH_SECRET を作り直すと、ログイン中の全員がログアウトされます。続けますか？" || die "中止しました。"
  new_secret="$(random_base64_secret)"
  secret_put "$SECRET_AUTH_SECRET" "$new_secret"
  ok "新しい値を登録しました（07-deploy.sh で新しいリビジョンを作ると反映されます）"
else
  ok "登録済み（変更しません。作り直す場合は --rotate-auth-secret）"
fi
unset new_secret
grant_secret_access "$SECRET_AUTH_SECRET" "$RUNTIME_MEMBER"

# ───────────── SEED_DEMO_PASSWORD ─────────────
log "デモユーザーの初期パスワード（${SECRET_SEED_DEMO_PASSWORD}）"
ensure_secret "$SECRET_SEED_DEMO_PASSWORD"
if ! secret_has_version "$SECRET_SEED_DEMO_PASSWORD" || ((RESET_SEED_PASSWORD)); then
  pw="$IN_SEED_DEMO_PASSWORD"
  if [[ -z "$pw" && -t 0 ]]; then
    read -r -s -p "デモユーザーの初期パスワードを入力してください（8文字以上・英字と数字を含む。空ならランダム生成）：" pw
    echo >&2
  fi
  if [[ -z "$pw" ]]; then
    pw="$(random_app_password)"
    ok "ランダムに生成しました"
  fi
  valid_app_password "$pw" || die "パスワードは8文字以上で、英字と数字を含めてください。"
  secret_put "$SECRET_SEED_DEMO_PASSWORD" "$pw"
  unset pw
  ok "登録しました（確認：gcloud secrets versions access latest --secret=${SECRET_SEED_DEMO_PASSWORD} --project=${PROJECT_ID}）"
else
  ok "登録済み（変更しません。登録し直す場合は --reset-seed-password）"
fi
grant_secret_access "$SECRET_SEED_DEMO_PASSWORD" "$RUNTIME_MEMBER"

# ───────────── 任意のシークレット ─────────────
optional_secret() {
  local name="$1" value="$2" label="$3"
  log "${label}（${name}）"
  if [[ -n "$value" ]]; then
    ensure_secret "$name"
    secret_put_if_changed "$name" "$value"
  elif secret_exists "$name" && secret_has_version "$name"; then
    ok "登録済み（今回は値の指定なし）"
  else
    ok "未使用（値の指定なし）"
    return 0
  fi
  grant_secret_access "$name" "$RUNTIME_MEMBER"
}

optional_secret "$SECRET_SMTP_PASSWORD" "$IN_SMTP_PASSWORD" "SMTP_PASSWORD"
optional_secret "$SECRET_GRAPH_CLIENT_SECRET" "$IN_GRAPH_CLIENT_SECRET" "GRAPH_CLIENT_SECRET（M9）"
optional_secret "$SECRET_ENTRA_CLIENT_SECRET" "$IN_ENTRA_CLIENT_SECRET" "AUTH_MICROSOFT_ENTRA_ID_SECRET（M9）"
unset IN_SEED_DEMO_PASSWORD IN_SMTP_PASSWORD IN_GRAPH_CLIENT_SECRET IN_ENTRA_CLIENT_SECRET

ok "Secret Manager の準備ができました"
