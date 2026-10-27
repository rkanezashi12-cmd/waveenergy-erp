#!/usr/bin/env bash
# §10.1 手順5：サービスアカウントを作り、最小権限を付ける（Artifact Registry のリポジトリもここで作る）
#   使い方：infra/04-service-accounts.sh <demo|production>
#
# ┌──────────────────┬─────────────────────────────────────────────────────────────┐
# │ サービスアカウント │ 権限                                                          │
# ├──────────────────┼─────────────────────────────────────────────────────────────┤
# │ ランタイム         │ Cloud Run サービスと Cloud Run ジョブ（マイグレーション・シード）の実行用   │
# │ (RUNTIME_SA)     │  - roles/cloudsql.client（プロジェクト）                                │
# │                  │  - roles/aiplatform.user（プロジェクト。Vertex AI の呼び出し）           │
# │                  │  - roles/logging.logWriter（プロジェクト）                              │
# │                  │  - roles/storage.objectUser（UPLOAD_BUCKET のみ。作成・読取・削除）       │
# │                  │  - roles/secretmanager.secretAccessor（必要なシークレットのみ。06で付与） │
# ├──────────────────┼─────────────────────────────────────────────────────────────┤
# │ デプロイ           │ GitHub Actions（Workload Identity Federation）と Cloud Build 用       │
# │ (DEPLOYER_SA)    │  - DEPLOYER_RUN_ROLE（プロジェクト。既定 roles/run.admin。下の注を参照）   │
# │                  │  - roles/artifactregistry.writer（このリポジトリのみ）                   │
# │                  │  - roles/iam.serviceAccountUser（ランタイムSAのみ）                     │
# │                  │  - roles/logging.logWriter（プロジェクト。Cloud Build のログ出力）         │
# │                  │  - roles/storage.objectViewer（BUILD_STAGING_BUCKET のみ）            │
# ├──────────────────┼─────────────────────────────────────────────────────────────┤
# │ スケジューラ       │ Cloud Scheduler が OIDC トークンを発行するためのID                     │
# │ (SCHEDULER_SA)   │  - roles/run.invoker（このサービスのみ。08-scheduler.sh で付与）         │
# │                  │    サービスは公開中のため現状は不要だが、将来 IAM で非公開にしても動くよう付与 │
# └──────────────────┴─────────────────────────────────────────────────────────────┘
# サービスアカウントの鍵ファイルは作らない（SPEC §9）。
# 何度実行しても同じ結果になる。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
load_env "${1:-}"
require_gcloud_login

# ───────────── Artifact Registry ─────────────
log "Artifact Registry リポジトリ ${AR_REPOSITORY}"
if gcloud artifacts repositories describe "$AR_REPOSITORY" --location="$REGION" >/dev/null 2>&1; then
  ok "リポジトリは作成済み"
else
  gcloud artifacts repositories create "$AR_REPOSITORY" \
    --repository-format=docker \
    --location="$REGION" \
    --description="オーダー発令・仕様確定管理アプリのコンテナイメージ" \
    --labels="$LABELS" >/dev/null
  ok "リポジトリを作成しました"
fi

# 古いイメージを自動で消す（各イメージの新しい10個を残す。費用節約）
cleanup_policy="$(mktemp)"
trap 'rm -f "$cleanup_policy"' EXIT
cat >"$cleanup_policy" <<'EOF'
[
  {"name": "keep-recent", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 10}},
  {"name": "delete-old", "action": {"type": "Delete"}, "condition": {"tagState": "ANY", "olderThan": "30d"}}
]
EOF
gcloud artifacts repositories set-cleanup-policies "$AR_REPOSITORY" \
  --location="$REGION" \
  --policy="$cleanup_policy" >/dev/null
ok "古いイメージの自動削除ポリシーを設定しました（新しい10個は残す）"

# ───────────── サービスアカウント ─────────────
log "サービスアカウント"
ensure_service_account "$RUNTIME_SA_NAME" "we-order Cloud Run 実行用"
ensure_service_account "$DEPLOYER_SA_NAME" "we-order デプロイ用（GitHub Actions）"
ensure_service_account "$SCHEDULER_SA_NAME" "we-order Cloud Scheduler 用"

# ───────────── ランタイムSA ─────────────
log "ランタイムSA（${RUNTIME_SA}）の権限"
RUNTIME_MEMBER="serviceAccount:${RUNTIME_SA}"
grant_project_role "$RUNTIME_MEMBER" roles/cloudsql.client
grant_project_role "$RUNTIME_MEMBER" roles/aiplatform.user
grant_project_role "$RUNTIME_MEMBER" roles/logging.logWriter

gcloud storage buckets describe "gs://${UPLOAD_BUCKET}" >/dev/null 2>&1 ||
  die "バケット gs://${UPLOAD_BUCKET} がありません。先に 03-storage.sh を実行してください。"
gcloud storage buckets add-iam-policy-binding "gs://${UPLOAD_BUCKET}" \
  --member="$RUNTIME_MEMBER" \
  --role=roles/storage.objectUser >/dev/null
ok "バケット gs://${UPLOAD_BUCKET}：roles/storage.objectUser → ${RUNTIME_SA}"

# ───────────── デプロイSA ─────────────
log "デプロイSA（${DEPLOYER_SA}）の権限"
DEPLOYER_MEMBER="serviceAccount:${DEPLOYER_SA}"
# サービス・ジョブの更新と実行。roles/run.developer でもイメージの更新はできるが、
# 「呼び出し元の IAM チェック無効（--no-invoker-iam-check）」のサービスを更新するときに
# run.services.setIamPolicy を求められる可能性があるため、既定は roles/run.admin にしている【要確認】。
# 初回のデプロイで run.developer で動くことを確認できたら、設定ファイルで DEPLOYER_RUN_ROLE=roles/run.developer にして
# このスクリプトを再実行し、不要になった run.admin を外す：
#   gcloud projects remove-iam-policy-binding <PROJECT_ID> --member=serviceAccount:<DEPLOYER_SA> --role=roles/run.admin
grant_project_role "$DEPLOYER_MEMBER" "$DEPLOYER_RUN_ROLE"
grant_project_role "$DEPLOYER_MEMBER" roles/logging.logWriter

gcloud artifacts repositories add-iam-policy-binding "$AR_REPOSITORY" \
  --location="$REGION" \
  --member="$DEPLOYER_MEMBER" \
  --role=roles/artifactregistry.writer >/dev/null
ok "リポジトリ ${AR_REPOSITORY}：roles/artifactregistry.writer → ${DEPLOYER_SA}"

gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="$DEPLOYER_MEMBER" \
  --role=roles/iam.serviceAccountUser >/dev/null
ok "ランタイムSA：roles/iam.serviceAccountUser → ${DEPLOYER_SA}"

if [[ "$BUILD_MODE" == "cloudbuild" ]]; then
  gcloud storage buckets describe "gs://${BUILD_STAGING_BUCKET}" >/dev/null 2>&1 ||
    die "バケット gs://${BUILD_STAGING_BUCKET} がありません。先に 03-storage.sh を実行してください。"
  gcloud storage buckets add-iam-policy-binding "gs://${BUILD_STAGING_BUCKET}" \
    --member="$DEPLOYER_MEMBER" \
    --role=roles/storage.objectViewer >/dev/null
  ok "バケット gs://${BUILD_STAGING_BUCKET}：roles/storage.objectViewer → ${DEPLOYER_SA}"
fi

# スケジューラSA の run.invoker は、サービス作成後に 08-scheduler.sh で付ける
ok "サービスアカウントの準備ができました"
