#!/usr/bin/env bash
# §10.1 手順3：Cloud SQL（PostgreSQL）のインスタンス・データベース・ユーザーを作る
#   使い方：infra/02-cloudsql.sh <demo|production> [--rotate-db-password]
#
# - インスタンス：PostgreSQL 16、東京リージョン、自動バックアップ（7世代）、ポイントインタイムリカバリ、削除保護
# - DBユーザーのパスワードはランダムに生成して Secret Manager に直接登録する（画面には出さない）
# - アプリ用の接続文字列（DATABASE_URL）も Secret Manager に登録する
#   Cloud Run からは Unix ソケット（/cloudsql/<接続名>）で接続する
# 何度実行しても同じ結果になる。既存インスタンスはバックアップ設定だけを揃える（マシンタイプは変えない）。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
load_env "${1:-}"
shift || true

ROTATE_DB_PASSWORD=0
while (($#)); do
  case "$1" in
    --rotate-db-password) ROTATE_DB_PASSWORD=1 ;;
    *) die "不明なオプション：$1" ;;
  esac
  shift
done

require_gcloud_login
require_cmd openssl

if [[ "$SQL_DELETION_PROTECTION" == "true" ]]; then
  DELETION_FLAG="--deletion-protection"
else
  DELETION_FLAG="--no-deletion-protection"
fi

# ───────────── インスタンス ─────────────
log "Cloud SQL インスタンス ${SQL_INSTANCE}"
if gcloud sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1; then
  ok "インスタンスは作成済み。バックアップ・PITR・削除保護の設定を揃えます"
  gcloud sql instances patch "$SQL_INSTANCE" \
    --backup-start-time="$SQL_BACKUP_START_TIME" \
    --retained-backups-count="$SQL_RETAINED_BACKUPS" \
    --enable-point-in-time-recovery \
    --retained-transaction-log-days="$SQL_PITR_LOG_DAYS" \
    "$DELETION_FLAG" >/dev/null
  current_tier="$(gcloud sql instances describe "$SQL_INSTANCE" --format='value(settings.tier)')"
  if [[ "$current_tier" != "$SQL_TIER" ]]; then
    warn "マシンタイプが設定（${SQL_TIER}）と異なります（現在：${current_tier}）。再起動を伴うため自動では変更しません。"
    warn "変更する場合：gcloud sql instances patch ${SQL_INSTANCE} --tier=${SQL_TIER} --project=${PROJECT_ID}"
  fi
else
  log "インスタンスを作成します（10分ほどかかります）"
  gcloud sql instances create "$SQL_INSTANCE" \
    --database-version="$SQL_DATABASE_VERSION" \
    --edition="$SQL_EDITION" \
    --tier="$SQL_TIER" \
    --region="$REGION" \
    --availability-type="$SQL_AVAILABILITY_TYPE" \
    --storage-type=SSD \
    --storage-size="$SQL_STORAGE_SIZE_GB" \
    --storage-auto-increase \
    --backup-start-time="$SQL_BACKUP_START_TIME" \
    --retained-backups-count="$SQL_RETAINED_BACKUPS" \
    --enable-point-in-time-recovery \
    --retained-transaction-log-days="$SQL_PITR_LOG_DAYS" \
    --maintenance-window-day=SUN \
    --maintenance-window-hour=18 \
    "$DELETION_FLAG"
  # メンテナンス時間帯は UTC 指定（日曜 18時 UTC = 月曜 3時 日本時間）
  # 公開IPは付くが「承認済みネットワーク」を登録しないため、Cloud SQL コネクタ（Cloud Run の組み込み接続）以外からは接続できない
  ok "インスタンスを作成しました"
fi

# ───────────── データベース ─────────────
log "データベース ${DB_NAME}"
if gcloud sql databases describe "$DB_NAME" --instance="$SQL_INSTANCE" >/dev/null 2>&1; then
  ok "データベースは作成済み"
else
  gcloud sql databases create "$DB_NAME" --instance="$SQL_INSTANCE" --charset=UTF8 >/dev/null
  ok "データベースを作成しました"
fi

# ───────────── ユーザーとパスワード ─────────────
log "DBユーザー ${DB_USER}"
ensure_secret "$SECRET_DB_PASSWORD"

user_exists=0
# 「| grep -q」は pipefail と組み合わせると誤判定することがあるため、一度変数に受ける
sql_users="$(gcloud sql users list --instance="$SQL_INSTANCE" --format='value(name)')"
if grep -qx -- "$DB_USER" <<<"$sql_users"; then
  user_exists=1
fi

DB_PASSWORD=""
if ((user_exists)); then
  if ((ROTATE_DB_PASSWORD)); then
    DB_PASSWORD="$(random_alnum 32)"
    secret_put "$SECRET_DB_PASSWORD" "$DB_PASSWORD"
    # 注意：--password の値は実行中だけ手元のプロセス一覧に現れる
    gcloud sql users set-password "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASSWORD" >/dev/null
    ok "DBユーザーのパスワードを変更し、Secret Manager に登録しました"
    warn "Cloud Run の新しいインスタンスから新しいパスワードが使われます。07-deploy.sh を再実行して新しいリビジョンを作ってください。"
  elif secret_has_version "$SECRET_DB_PASSWORD"; then
    DB_PASSWORD="$(secret_value "$SECRET_DB_PASSWORD")"
    ok "DBユーザーは作成済み（パスワードは Secret Manager の値を使用）"
  else
    die "DBユーザー ${DB_USER} はありますが、パスワードが Secret Manager（${SECRET_DB_PASSWORD}）にありません。--rotate-db-password を付けて再実行すると、パスワードを作り直して登録します。"
  fi
else
  # 途中で止まった場合の再実行に備え、登録済みのパスワードがあればそれを使う
  if secret_has_version "$SECRET_DB_PASSWORD"; then
    DB_PASSWORD="$(secret_value "$SECRET_DB_PASSWORD")"
  else
    DB_PASSWORD="$(random_alnum 32)"
    secret_put "$SECRET_DB_PASSWORD" "$DB_PASSWORD"
  fi
  # 注意：--password の値は実行中だけ手元のプロセス一覧に現れる
  gcloud sql users create "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASSWORD" >/dev/null
  ok "DBユーザーを作成しました（パスワードは Secret Manager：${SECRET_DB_PASSWORD}）"
fi

# ───────────── 接続文字列（DATABASE_URL）─────────────
# パスワードは英数字だけで生成しているため、URLエンコードは不要
log "接続文字列 ${SECRET_DATABASE_URL}"
ensure_secret "$SECRET_DATABASE_URL"
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost/${DB_NAME}?host=/cloudsql/${SQL_CONNECTION_NAME}"
secret_put_if_changed "$SECRET_DATABASE_URL" "$DATABASE_URL"
unset DB_PASSWORD DATABASE_URL

ok "Cloud SQL の準備ができました（接続名：${SQL_CONNECTION_NAME}）"
