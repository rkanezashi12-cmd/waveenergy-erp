# オーダー発令・仕様確定管理アプリ

株式会社Wave Energy様向けの業務アプリです。受注時のオーダー発令（要求仕様書・資料チェックリスト・未確定項目）と、発令 → 受入 → 仕様確定までの状態・やり取り・役割分担を1か所で管理します。

- 仕様書：[SPEC.md](SPEC.md)（実装の正）
- 引継ぎ：[HANDOVER.md](HANDOVER.md)（現在の状況・確認事項・次にやること）
- データ項目の対応表：[docs/data-dictionary.md](docs/data-dictionary.md)
- GCP へのデプロイ手順：[docs/deploy.md](docs/deploy.md)

## 構成

| 要素 | 採用 |
|---|---|
| アプリ | Next.js 16（App Router）＋ TypeScript ＋ Tailwind CSS |
| データベース | PostgreSQL 16（Prisma 7） |
| 認証 | Auth.js（デモ：メールアドレス＋パスワード、本番：Microsoft Entra ID） |
| AI | Vertex AI（Gemini Flash 系）。ローカルではモックで動かせる |
| 実行環境 | Cloud Run（asia-northeast1）、Cloud SQL、Cloud Storage、Cloud Scheduler |

## ローカル開発

前提：Node.js 22、Docker（PostgreSQL 用）

```bash
cp .env.example .env              # 必要に応じて値を変える
docker compose up -d              # PostgreSQL を起動
npm install                       # Prisma Client も生成される
npm run db:deploy                 # マイグレーションを適用
npm run db:seed                   # デモ用のマスタ・ユーザー・サンプルオーダー（すべて架空）
npm run dev                       # http://localhost:3000
```

デモユーザー（パスワードは `SEED_DEMO_PASSWORD`、既定 `Demo1234!`）

| メールアドレス | 氏名 | ロール |
|---|---|---|
| sales1@example.com | 青木 健太 | 営業（営業一部） |
| sales2@example.com | 井上 美咲 | 営業（営業二部） |
| manager@example.com | 上田 誠 | 営業・営業管理職（営業本部） |
| reception@example.com | 江藤 修 | 技術受付 |
| tech1@example.com | 大野 翔 | 技術担当 |
| tech2@example.com | 加藤 由美 | 技術担当 |
| design@example.com | 木村 拓也 | 閲覧（設計課） |
| factory@example.com | 工藤 大輔 | 閲覧（工作一課） |
| purchase@example.com | 小林 恵 | 閲覧（購買課） |
| admin@example.com | 佐々木 理沙 | 管理者 |

`SEED_MUST_CHANGE_PASSWORD=true`（既定）のときは、初回ログインでパスワード変更を求めます。

### よく使うコマンド

```bash
npm run typecheck     # 型チェック
npm run lint          # ESLint
npm test              # 単体テスト（業務ルール・採番）
npm run test:e2e      # 受け入れ基準（SPEC §11）の通し確認。シード直後のデータベースと起動中のアプリが必要
npm run db:migrate    # スキーマ変更時：マイグレーションを作成して適用
```

`npm run test:e2e` は Playwright を使います（devDependencies には含めていません。未導入なら `npm i -D playwright && npx playwright install chromium`）。`AI_PROVIDER=mock` で起動してください。

### 定期処理をローカルで動かす

```bash
curl -X POST -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/internal/cron/daily-digest
curl -X POST -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/internal/cron/accept-reminder
```

GCP では Cloud Scheduler が OIDC トークン付きで呼び出します（`CRON_OIDC_AUDIENCE`・`CRON_SERVICE_ACCOUNT`）。

## ディレクトリ

```
prisma/              スキーマ・マイグレーション・シード
src/app/(app)/       ログイン後の画面（ホーム・オーダー・レポート・通知・管理など）
src/app/api/         API（認証、AI下書き、定期処理、ヘルスチェック）
src/lib/             業務ロジック
  permissions.ts       権限判定（ロールの判定はここに集約）
  orders/              オーダー（発番・要求仕様書・資料・未確定項目・発令・受入・タスク・やり取り）
  ai/                  AI下書き（プロンプト・Vertex AI／モック・一時保存）
  notify/              通知とメール送信（DB保存／SMTP／Microsoft Graph）
  reports.ts           レポート
  cron.ts              毎朝のまとめ通知・受入催促
e2e/                 受け入れ基準の通し確認
infra/               GCP 構築スクリプト
docs/                ドキュメント
```
