#!/usr/bin/env bash
# §10.1 手順4：Cloud Storage バケットを作る
#   使い方：infra/03-storage.sh <demo|production>
#
# - UPLOAD_BUCKET：AI下書きの入力ファイルの一時保存先。作成から30日で自動削除（SPEC §9）
#     均一なバケットレベルのアクセス、公開アクセス防止、論理削除なし（30日で確実に消えるように）
# - BUILD_STAGING_BUCKET：07-deploy.sh が Cloud Build に送るソースの置き場（7日で自動削除）
# 何度実行しても同じ結果になる（既存バケットは設定を揃える）。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
load_env "${1:-}"
require_gcloud_login

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

# ライフサイクル設定ファイルを作る（日数を引数で受ける）
lifecycle_file() {
  local days="$1" file="${tmpdir}/lifecycle-${1}.json"
  cat >"$file" <<EOF
{"rule": [{"action": {"type": "Delete"}, "condition": {"age": ${days}}}]}
EOF
  printf '%s' "$file"
}

ensure_bucket() {
  local bucket="$1" days="$2" lc
  lc="$(lifecycle_file "$days")"
  if gcloud storage buckets describe "gs://${bucket}" >/dev/null 2>&1; then
    gcloud storage buckets update "gs://${bucket}" \
      --uniform-bucket-level-access \
      --public-access-prevention \
      --lifecycle-file="$lc" \
      --clear-soft-delete >/dev/null
    ok "バケット gs://${bucket} は作成済み（設定を揃えました：${days}日で自動削除）"
  else
    gcloud storage buckets create "gs://${bucket}" \
      --location="$REGION" \
      --default-storage-class=STANDARD \
      --uniform-bucket-level-access \
      --public-access-prevention \
      --soft-delete-duration=0 \
      --lifecycle-file="$lc" >/dev/null
    ok "バケット gs://${bucket} を作成しました（${days}日で自動削除）"
  fi
}

log "AI入力ファイル用バケット"
ensure_bucket "$UPLOAD_BUCKET" "$UPLOAD_RETENTION_DAYS"

if [[ "$BUILD_MODE" == "cloudbuild" ]]; then
  log "Cloud Build のソース置き場"
  ensure_bucket "$BUILD_STAGING_BUCKET" 7
fi

ok "Cloud Storage の準備ができました"
