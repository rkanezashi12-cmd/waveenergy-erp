#!/usr/bin/env bash
# §10.1 の手順2〜9をまとめて実行する（手順1：プロジェクト作成と請求先の紐づけは事前に手作業で行う）
#   使い方：infra/all.sh <demo|production> [--seed] [--skip-github]
#
#   --seed         初回デプロイ時にシードを投入する（デモの初回のみ）
#   --skip-github  05-github-wif.sh を飛ばす（GitHub リポジトリの準備前に試す場合）
# 各スクリプトは何度実行しても同じ結果になるため、途中で失敗したら原因を直してそのまま再実行すればよい。
set -euo pipefail
INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ENV_ARG="${1:-}"
[[ -n "$ENV_ARG" ]] || {
  echo "使い方：$(basename "$0") <demo|production> [--seed] [--skip-github]" >&2
  exit 2
}
shift

DEPLOY_OPTS=()
SKIP_GITHUB=0
while (($#)); do
  case "$1" in
    --seed) DEPLOY_OPTS+=(--seed) ;;
    --skip-github) SKIP_GITHUB=1 ;;
    *)
      echo "不明なオプション：$1" >&2
      exit 2
      ;;
  esac
  shift
done

step() { printf '\n\033[1;35m━━━ %s ━━━\033[0m\n' "$*" >&2; }

step "手順2：API の有効化"
"${INFRA_DIR}/01-enable-apis.sh" "$ENV_ARG"
step "手順3：Cloud SQL"
"${INFRA_DIR}/02-cloudsql.sh" "$ENV_ARG"
step "手順4：Cloud Storage"
"${INFRA_DIR}/03-storage.sh" "$ENV_ARG"
step "手順5：サービスアカウント"
"${INFRA_DIR}/04-service-accounts.sh" "$ENV_ARG"
if ((SKIP_GITHUB)); then
  step "手順6：GitHub Actions 用の設定（省略）"
else
  step "手順6：GitHub Actions 用の Workload Identity Federation"
  "${INFRA_DIR}/05-github-wif.sh" "$ENV_ARG"
fi
step "手順7：Secret Manager"
"${INFRA_DIR}/06-secrets.sh" "$ENV_ARG"
step "手順8：デプロイ・マイグレーション・シード"
"${INFRA_DIR}/07-deploy.sh" "$ENV_ARG" ${DEPLOY_OPTS[@]+"${DEPLOY_OPTS[@]}"}
step "手順9：Cloud Scheduler"
"${INFRA_DIR}/08-scheduler.sh" "$ENV_ARG"

printf '\n\033[1;32mすべての手順が完了しました。\033[0m\n' >&2
