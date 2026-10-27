#!/usr/bin/env bash
# §10.1 手順6：GitHub Actions 用の Workload Identity Federation を設定する
#   使い方：infra/05-github-wif.sh <demo|production> [--set-github-vars]
#
# - GitHub の OIDC トークンを信頼する Workload Identity プールとプロバイダを作る
# - 信頼する条件：リポジトリが GITHUB_REPOSITORY と一致し、かつ GitHub の Environment が GITHUB_ENVIRONMENT のジョブ
#   （本番の Environment に承認者を設定すれば、承認なしに本番へデプロイできない）
#   GITHUB_BRANCH を設定した場合は、さらにそのブランチからの実行に限る
# - そのジョブにだけ、デプロイSAとして動くこと（roles/iam.workloadIdentityUser）を許可する
# - サービスアカウントの鍵ファイルは作らない（SPEC §9）
# 最後に GitHub Actions に設定する変数を表示する。
# --set-github-vars を付けると、gh コマンドで GitHub の Environment 変数に直接登録する。
#
# 前提：GitHub リポジトリを作成済みであること（§10.1 手順6の前半。GitHub の画面で作成）
# 何度実行しても同じ結果になる（既存のプロバイダは条件を設定ファイルの内容に揃える）。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
load_env "${1:-}"
shift || true

SET_GITHUB_VARS=0
while (($#)); do
  case "$1" in
    --set-github-vars) SET_GITHUB_VARS=1 ;;
    *) die "不明なオプション：$1" ;;
  esac
  shift
done

require_gcloud_login
[[ "$GITHUB_REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ && "$GITHUB_REPOSITORY" != "OWNER/REPO" ]] ||
  die "設定ファイルの GITHUB_REPOSITORY を「オーナー/リポジトリ名」にしてください（現在：${GITHUB_REPOSITORY:-未設定}）。"
[[ -n "$GITHUB_ENVIRONMENT" ]] || die "設定ファイルの GITHUB_ENVIRONMENT を設定してください。"

PROJECT_NUMBER="$(project_number)"
POOL_NAME="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL_ID}"
PROVIDER_NAME="${POOL_NAME}/providers/${WIF_PROVIDER_ID}"

ATTRIBUTE_MAPPING="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner,attribute.environment=assertion.environment,attribute.ref=assertion.ref"
ATTRIBUTE_CONDITION="assertion.repository == '${GITHUB_REPOSITORY}' && assertion.environment == '${GITHUB_ENVIRONMENT}'"
# GITHUB_BRANCH を指定した場合は、そのブランチからの実行に限る（本番は main を推奨）
if [[ -n "$GITHUB_BRANCH" ]]; then
  [[ "$GITHUB_BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || die "GITHUB_BRANCH に使えない文字が含まれています：${GITHUB_BRANCH}"
  ATTRIBUTE_CONDITION+=" && assertion.ref == 'refs/heads/${GITHUB_BRANCH}'"
fi

# ───────────── プール ─────────────
log "Workload Identity プール ${WIF_POOL_ID}"
pool_state="$(gcloud iam workload-identity-pools describe "$WIF_POOL_ID" --location=global --format='value(state)' 2>/dev/null || true)"
case "$pool_state" in
  ACTIVE) ok "プールは作成済み" ;;
  DELETED)
    gcloud iam workload-identity-pools undelete "$WIF_POOL_ID" --location=global >/dev/null
    ok "削除済みだったプールを復元しました"
    ;;
  "")
    gcloud iam workload-identity-pools create "$WIF_POOL_ID" \
      --location=global \
      --display-name="GitHub Actions" \
      --description="GitHub Actions からのデプロイ用" >/dev/null
    ok "プールを作成しました"
    ;;
  *) die "プールの状態が想定外です：${pool_state}" ;;
esac

# ───────────── プロバイダ ─────────────
log "OIDC プロバイダ ${WIF_PROVIDER_ID}（${GITHUB_REPOSITORY} / Environment：${GITHUB_ENVIRONMENT}${GITHUB_BRANCH:+ / ブランチ：${GITHUB_BRANCH}}）"
provider_state="$(gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER_ID" \
  --location=global --workload-identity-pool="$WIF_POOL_ID" --format='value(state)' 2>/dev/null || true)"
case "$provider_state" in
  ACTIVE | DELETED)
    if [[ "$provider_state" == "DELETED" ]]; then
      gcloud iam workload-identity-pools providers undelete "$WIF_PROVIDER_ID" \
        --location=global --workload-identity-pool="$WIF_POOL_ID" >/dev/null
      ok "削除済みだったプロバイダを復元しました"
    fi
    gcloud iam workload-identity-pools providers update-oidc "$WIF_PROVIDER_ID" \
      --location=global \
      --workload-identity-pool="$WIF_POOL_ID" \
      --issuer-uri="https://token.actions.githubusercontent.com" \
      --attribute-mapping="$ATTRIBUTE_MAPPING" \
      --attribute-condition="$ATTRIBUTE_CONDITION" >/dev/null
    ok "プロバイダは作成済み（条件を設定ファイルの内容に揃えました）"
    ;;
  "")
    gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER_ID" \
      --location=global \
      --workload-identity-pool="$WIF_POOL_ID" \
      --display-name="GitHub Actions OIDC" \
      --issuer-uri="https://token.actions.githubusercontent.com" \
      --attribute-mapping="$ATTRIBUTE_MAPPING" \
      --attribute-condition="$ATTRIBUTE_CONDITION" >/dev/null
    ok "プロバイダを作成しました"
    ;;
  *) die "プロバイダの状態が想定外です：${provider_state}" ;;
esac

# ───────────── デプロイSAへのなりすまし許可 ─────────────
log "デプロイSA（${DEPLOYER_SA}）を GitHub Actions から使えるようにする"
gcloud iam service-accounts describe "$DEPLOYER_SA" >/dev/null 2>&1 ||
  die "デプロイSAがありません。先に 04-service-accounts.sh を実行してください。"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_SA" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/${POOL_NAME}/attribute.repository/${GITHUB_REPOSITORY}" >/dev/null
ok "roles/iam.workloadIdentityUser を ${GITHUB_REPOSITORY} に付与しました（プロバイダの条件で Environment も限定）"

# ───────────── GitHub Actions に設定する値 ─────────────
# macOS 標準の bash 3.2 でも動くよう、連想配列は使わず「名前=値」の配列にする
GH_VARS=(
  "GCP_PROJECT_ID=${PROJECT_ID}"
  "GCP_REGION=${REGION}"
  "GCP_WIF_PROVIDER=${PROVIDER_NAME}"
  "GCP_DEPLOYER_SA=${DEPLOYER_SA}"
  "GCP_AR_REPOSITORY=${AR_REPOSITORY}"
  "CLOUD_RUN_SERVICE=${SERVICE_NAME}"
  "APP_IMAGE_NAME=${APP_IMAGE_NAME}"
  "TOOLS_IMAGE_NAME=${TOOLS_IMAGE_NAME}"
  "MIGRATE_JOB=${MIGRATE_JOB}"
  "SEED_JOB=${SEED_JOB}"
)

if ((SET_GITHUB_VARS)); then
  require_cmd gh
  log "GitHub の Environment「${GITHUB_ENVIRONMENT}」を用意し、変数を登録します"
  # Environment が無ければ作る（あれば何も変わらない。承認者の設定は GitHub の画面で行う）
  gh api --method PUT "repos/${GITHUB_REPOSITORY}/environments/${GITHUB_ENVIRONMENT}" >/dev/null
  for kv in "${GH_VARS[@]}"; do
    gh variable set "${kv%%=*}" --repo "$GITHUB_REPOSITORY" --env "$GITHUB_ENVIRONMENT" --body "${kv#*=}" >/dev/null
    ok "${kv%%=*}"
  done
  ok "GitHub の Environment 変数を登録しました"
fi

cat >&2 <<EOF

────────────────────────────────────────────────────────────
GitHub リポジトリ ${GITHUB_REPOSITORY} の
  Settings → Environments → 「${GITHUB_ENVIRONMENT}」→ Environment variables
に次の値を登録してください（--set-github-vars を付けた場合は登録済み）。
秘密情報ではないため Secrets ではなく Variables に登録します。
────────────────────────────────────────────────────────────
EOF
for kv in "${GH_VARS[@]}"; do
  printf '  %-20s %s\n' "${kv%%=*}" "${kv#*=}" >&2
done
cat >&2 <<EOF
────────────────────────────────────────────────────────────
本番（production）の Environment には「Required reviewers（承認者）」を設定してください。
push 時にデモへ自動デプロイする場合は、リポジトリ変数 AUTO_DEPLOY_DEMO=true を登録します。
EOF
