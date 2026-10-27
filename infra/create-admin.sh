#!/usr/bin/env bash
# 最初の管理者ユーザーを作る（主に本番用。本番ではデモユーザーを作らないため）
#   使い方：infra/create-admin.sh <demo|production> --email <メールアドレス> --name <氏名> [--department <部署名>]
#
# - Cloud Run ジョブ（CREATE_ADMIN_JOB、既定 we-order-create-admin）を tools イメージで作り、
#   「tsx prisma/create-admin.ts」を実行する（アプリ側のスクリプト。仕様は docs/deploy.md）
# - イメージはマイグレーション用ジョブと同じもの（= 最後にデプロイしたもの）を使う
# - メールアドレス・氏名はジョブの定義に残さず、実行時だけ渡す
# - パスワードログインが有効（AUTH_PASSWORD_LOGIN=true）なら、初期パスワードをランダムに生成して
#   Secret Manager（<SECRET_PREFIX>initial-admin-password）に登録し、ジョブに渡す。
#   初回ログイン時にパスワード変更を求める。Entra ID だけで運用する場合はパスワードを設定しない。
# 同じメールアドレスで何度実行しても、ユーザーが重複して作られることはない（スクリプト側で保証）。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
load_env "${1:-}"
shift || true

ADMIN_EMAIL=""
ADMIN_NAME=""
ADMIN_DEPARTMENT="システム管理"
while (($#)); do
  case "$1" in
    --email)
      ADMIN_EMAIL="${2:-}"
      shift
      ;;
    --name)
      ADMIN_NAME="${2:-}"
      shift
      ;;
    --department)
      ADMIN_DEPARTMENT="${2:-}"
      shift
      ;;
    *) die "不明なオプション：$1" ;;
  esac
  shift
done

[[ "$ADMIN_EMAIL" =~ ^[^@[:space:],]+@[^@[:space:],]+\.[^@[:space:],]+$ ]] || die "--email に正しいメールアドレスを指定してください。"
[[ -n "$ADMIN_NAME" ]] || die "--name に氏名を指定してください。"
[[ "$ADMIN_NAME$ADMIN_DEPARTMENT" != *,* ]] || die "氏名・部署名にカンマ（,）は使えません。"

require_gcloud_login
require_cmd openssl

run_job_exists "$MIGRATE_JOB" || die "マイグレーション用ジョブがありません。先に 07-deploy.sh を実行してください。"
# Cloud Run Admin API v1 の形式（取れなければ v2 の形式）でイメージを読む
TOOLS_REF="$(gcloud run jobs describe "$MIGRATE_JOB" --region="$REGION" \
  --format='value(spec.template.spec.template.spec.containers[0].image)' 2>/dev/null || true)"
if [[ -z "$TOOLS_REF" ]]; then
  TOOLS_REF="$(gcloud run jobs describe "$MIGRATE_JOB" --region="$REGION" \
    --format='value(template.template.containers[0].image)' 2>/dev/null || true)"
fi
[[ -n "$TOOLS_REF" ]] || die "マイグレーション用ジョブのイメージを取得できませんでした。"
SQL_CONNECTION_NAME="$(gcloud sql instances describe "$SQL_INSTANCE" --format='value(connectionName)')"

JOB_SECRETS="DATABASE_URL=${SECRET_DATABASE_URL}:latest"
if [[ "$AUTH_PASSWORD_LOGIN" == "true" ]]; then
  log "初期パスワード（${SECRET_INITIAL_ADMIN_PASSWORD}）"
  ensure_secret "$SECRET_INITIAL_ADMIN_PASSWORD"
  if secret_has_version "$SECRET_INITIAL_ADMIN_PASSWORD"; then
    ok "登録済みの値を使います"
  else
    admin_pw="$(random_app_password)"
    secret_put "$SECRET_INITIAL_ADMIN_PASSWORD" "$admin_pw"
    unset admin_pw
    ok "ランダムに生成して登録しました"
  fi
  grant_secret_access "$SECRET_INITIAL_ADMIN_PASSWORD" "serviceAccount:${RUNTIME_SA}"
  JOB_SECRETS+=",ADMIN_INITIAL_PASSWORD=${SECRET_INITIAL_ADMIN_PASSWORD}:latest"
fi

log "Cloud Run ジョブ ${CREATE_ADMIN_JOB}"
gcloud run jobs deploy "$CREATE_ADMIN_JOB" \
  --region="$REGION" \
  --image="$TOOLS_REF" \
  --service-account="$RUNTIME_SA" \
  --set-cloudsql-instances="$SQL_CONNECTION_NAME" \
  --set-secrets="$JOB_SECRETS" \
  --set-env-vars="APP_ENV=${APP_ENV},TZ=Asia/Tokyo" \
  --command=tsx \
  --args=prisma/create-admin.ts \
  --tasks=1 \
  --max-retries=0 \
  --task-timeout=300s \
  --cpu=1 \
  --memory=1Gi \
  --labels="$LABELS" >/dev/null
ok "ジョブを作成・更新しました"

log "管理者ユーザーを作成します（${ADMIN_EMAIL}）"
gcloud run jobs execute "$CREATE_ADMIN_JOB" \
  --region="$REGION" \
  --update-env-vars="ADMIN_EMAIL=${ADMIN_EMAIL},ADMIN_NAME=${ADMIN_NAME},ADMIN_DEPARTMENT=${ADMIN_DEPARTMENT}" \
  --wait ||
  die "管理者ユーザーの作成に失敗しました。Cloud Run → ジョブ → ${CREATE_ADMIN_JOB} のログを確認してください。"
ok "管理者ユーザーを作成しました"

if [[ "$AUTH_PASSWORD_LOGIN" == "true" ]]; then
  cat >&2 <<EOF
初期パスワードの確認（本人にだけ伝え、初回ログイン時に変更してもらう）：
  gcloud secrets versions access latest --secret=${SECRET_INITIAL_ADMIN_PASSWORD} --project=${PROJECT_ID}
EOF
else
  echo "Microsoft アカウント（Entra ID）で ${ADMIN_EMAIL} としてログインしてください。" >&2
fi
