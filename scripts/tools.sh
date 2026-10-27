#!/usr/bin/env bash
# 管理用のコマンド。Cloud Run ジョブ（tools イメージ）で実行する（deploy/run_job.sh から）。
#   migrate       DBマイグレーション（prisma migrate deploy）
#   status        マイグレーションの状態
#   seed          マスタ・デモユーザー・サンプルオーダーの登録（SEED_* の環境変数に従う。何度実行してもよい）
#   create-admin  管理者ユーザーの作成（ADMIN_EMAIL・ADMIN_NAME など。prisma/create-admin.ts）
#   models        Vertex AI で使える Gemini のモデル名の一覧と、GEMINI_MODEL の呼び出し確認
set -euo pipefail
cd "$(dirname "$0")/.."

case "${1:-}" in
  migrate) exec prisma migrate deploy ;;
  status) exec prisma migrate status ;;
  seed) exec prisma db seed ;;
  create-admin) exec tsx prisma/create-admin.ts ;;
  models) exec node scripts/list-models.mjs ;;
  *)
    echo "知らないコマンドです：${1:-（なし）}（migrate / status / seed / create-admin / models）" >&2
    exit 2
    ;;
esac
