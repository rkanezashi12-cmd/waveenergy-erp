# infra/ — GCP 環境の構築スクリプト

詳しい手順・前提・トラブル対応は [docs/deploy.md](../docs/deploy.md) を参照。

## 使い方

```bash
cp infra/config/demo.env.example infra/config/demo.env   # 値を書き換える（Git には含めない）
infra/all.sh demo --seed                                  # 手順2〜9をまとめて実行
```

各スクリプトは何度実行しても同じ結果になる。途中で失敗したら原因を直して再実行すればよい。
第1引数は環境名（`demo` / `production`）または設定ファイルのパス。

## スクリプト一覧（番号は SPEC §10.1 の手順に対応）

| §10.1 | スクリプト | 内容 |
|---|---|---|
| 1 | （手作業） | GCP プロジェクトの作成と請求先アカウントの紐づけ（金指が実施） |
| 2 | `01-enable-apis.sh` | 必要な API の有効化 |
| 3 | `02-cloudsql.sh` | Cloud SQL（PostgreSQL 16）・データベース・ユーザー。パスワードと `DATABASE_URL` は Secret Manager へ |
| 4 | `03-storage.sh` | AI入力ファイル用バケット（30日で自動削除）、Cloud Build のソース置き場 |
| 5 | `04-service-accounts.sh` | サービスアカウント（実行用・デプロイ用・スケジューラ用）と最小権限、Artifact Registry |
| 6 | `05-github-wif.sh` | GitHub Actions 用の Workload Identity Federation（鍵ファイルなし） |
| 7 | `06-secrets.sh` | Secret Manager への秘密情報の登録と参照権限 |
| 8 | `07-deploy.sh` | ビルド、DBマイグレーション、Cloud Run へのデプロイ、シード（`--seed`） |
| 9 | `08-scheduler.sh` | Cloud Scheduler（毎朝のまとめ通知・受入催促） |
| — | `create-admin.sh` | 最初の管理者ユーザーの作成（主に本番用） |
| — | `all.sh` | 手順2〜9をまとめて実行 |

## ファイル

| ファイル | 内容 |
|---|---|
| `env.sh` | 共通の設定読み込みと関数（各スクリプトが読み込む） |
| `config/demo.env.example` | デモ環境の設定の雛形 |
| `config/production.env.example` | 本番環境の設定の雛形 |
| `cloudbuild.yaml` | Cloud Build で runner / tools の2つのイメージを作る設定 |
| `cloudbuild.gcloudignore` | Cloud Build に送らないファイル |

プロジェクトIDなどの環境固有値は `config/<環境名>.env` にだけ書く（SPEC §0-6）。
