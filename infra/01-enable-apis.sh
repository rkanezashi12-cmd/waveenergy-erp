#!/usr/bin/env bash
# §10.1 手順2：必要な API を有効化する
#   使い方：infra/01-enable-apis.sh <demo|production>
# 何度実行しても同じ結果になる（有効化済みの API はそのまま）。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
load_env "${1:-}"
require_gcloud_login

# 請求先アカウントの確認（§10.1 手順1。金指が実施）
billing="$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null || true)"
if [[ "$billing" == "True" || "$billing" == "true" ]]; then
  ok "請求先アカウントが紐づいています"
elif [[ -z "$billing" ]]; then
  warn "請求先アカウントの状態を確認できませんでした（権限が無い可能性があります）。紐づけ済みであることを確認してください。"
else
  die "プロジェクト ${PROJECT_ID} に請求先アカウントが紐づいていません。§10.1 手順1を先に行ってください。"
fi

APIS=(
  run.googleapis.com                  # Cloud Run
  sqladmin.googleapis.com             # Cloud SQL Admin
  artifactregistry.googleapis.com     # Artifact Registry
  secretmanager.googleapis.com        # Secret Manager
  aiplatform.googleapis.com           # Vertex AI
  storage.googleapis.com              # Cloud Storage
  cloudscheduler.googleapis.com       # Cloud Scheduler
  iamcredentials.googleapis.com       # IAM Credentials（Workload Identity Federation でのトークン発行）
  iam.googleapis.com                  # IAM（サービスアカウント・Workload Identity プール）
  sts.googleapis.com                  # Security Token Service（Workload Identity Federation）
  cloudbuild.googleapis.com           # Cloud Build（07-deploy.sh の BUILD_MODE=cloudbuild で使う）
  cloudresourcemanager.googleapis.com # プロジェクトの IAM 設定
  logging.googleapis.com              # Cloud Logging
)

log "API を有効化します（数分かかることがあります）"
gcloud services enable "${APIS[@]}"
ok "API を有効化しました：${#APIS[@]} 件"
