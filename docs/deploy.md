# GCP へのデプロイ手順

この手順書とリポジトリの `infra/` だけで、別の GCP プロジェクトに同じ環境を作れることを目標にしている（SPEC §11-9）。
形はスキル gcp-bootstrap に合わせている：**Cloud Shell で実行するのは `infra/setup.sh` の1回だけ。あとのデプロイ・実行・確認は GitHub Actions（`.github/workflows/gcp.yml`）で行い、Claude が起動して結果を読む。**

| 環境 | プロジェクト | 設定ファイル |
|---|---|---|
| デモ | `waveenergy-erp`（金指） | `infra/env/demo.env` |
| 本番 | Wave Energy様のプロジェクト | `infra/env/production.env`（`production.env.example` から作る） |

## 全体の流れ

```
[人：最初の1回だけ] 画面で請求先をリンク → Cloud Shell で infra/setup.sh → 最後に出る値を Claude に貼る
[Claude]           infra/env/demo.env に値を入れて push
                   → GitHub Actions「gcp」を起動：deploy（イメージ → マイグレーション → Cloud Run）→ seed（デモデータ）
                   → digest / reminder で定期処理を試し、ログを読んで確かめる
```

## 構成

| もの | 名前（APP=weorder） | 作る所 |
|---|---|---|
| Cloud Run サービス（アプリ） | `weorder`。URL は `https://weorder-<プロジェクト番号>.asia-northeast1.run.app` | Actions |
| Cloud Run ジョブ（マイグレーション・シード・管理者作成） | `weorder-tools`（`scripts/tools.sh`） | Actions |
| Cloud Run サービス（予算超過で停止。非公開） | `weorder-budget-stop`（`scripts/budget-stop.mjs`） | Actions |
| Cloud SQL for PostgreSQL 16 | `weorder-db`（DB `we_order`、ユーザー `we_app`）。自動バックアップ7世代・PITR 7日・削除保護 | setup.sh |
| Cloud Storage | `<プロジェクトID>-weorder-uploads`（AI入力ファイル。30日で自動削除） | setup.sh |
| Secret Manager | `weorder-database-url`・`weorder-auth-secret`・`weorder-seed-password`・`weorder-db-password` | setup.sh |
| Cloud Scheduler | `weorder-daily-digest`（平日8:00）・`weorder-accept-reminder`（平日8〜18時の毎時） | setup.sh |
| Artifact Registry | `weorder`（最新3つだけ残す） | setup.sh |
| サービスアカウント | `weorder-app`（実行）・`weorder-deployer`（Actions）・`weorder-scheduler`・`weorder-budget-stop`・`weorder-pubsub-invoker` | setup.sh |
| Workload Identity 連携 | プール `github`・プロバイダ `github`（このリポジトリだけ） | setup.sh |
| 予算 | 「waveenergy-erp 自動停止（請求先全体）」：**請求先アカウントの全プロジェクトの合計**で月5,000円。50%・90%・100%でメール、デモは100%でこのプロジェクトの請求先を外して止める | setup.sh |

## 1. 画面で行うこと（人）

1. プロジェクトを作る（済み：`waveenergy-erp`）。
2. 請求先アカウントをリンクする（コンソールの「お支払い」）。プロジェクトごとにリンクが必要。
3. GitHub のリポジトリを**非公開**にする（Settings → General → Danger Zone → Change visibility）。Actions のログや設定ファイルが見えるため。
4. GitHub の既定のブランチを `main` にする（Settings → General → Default branch）。Actions を手動で起動するにはワークフローのファイルが既定のブランチに必要。

※ AI は Gemini（Vertex AI）を使う。Claude と違い、新しいプロジェクトでも割り当ての申請は要らない見込み（429 が出たら「IAM と管理」→「割り当てとシステム上限」で確認する）。

## 2. Cloud Shell で setup.sh を実行する（人・1回だけ）

1. GitHub のリポジトリの「Code」→「Download ZIP」で ZIP を落とす。
2. コンソール右上の Cloud Shell を開き、「︙」→「アップロード」で ZIP を上げる。
3. 次を貼って実行する（確認で `y`）。Cloud SQL を初めて作るときは 10〜15 分かかる。

```bash
cd ~ && mkdir -p waveenergy-erp-setup && cd waveenergy-erp-setup && unzip -qo ~/waveenergy-erp-main.zip && cd waveenergy-erp-main && PROJECT_ID=waveenergy-erp GITHUB_REPO=rkanezashi12-cmd/waveenergy-erp bash infra/setup.sh
```

4. 最後に「次の内容をそのまま Claude に貼ってください」の下に出る値を Claude に貼る（その下の「Claude に貼らないでください」の部分は貼らない）。

- `gcloud config set project` は使わない（Cloud Shell のホームはほかの案件と共通のため。すべて `--project` で指定している）。
- 何度実行してもよい（あるものは作り直さない）。IAM の反映待ちで失敗したら、もう一度実行する。
- 本番：本番のプロジェクトで `AUTO_STOP=false BUDGET_SCOPE=project SQL_TIER=db-custom-1-3840 SQL_AVAILABILITY=regional ENV_NAME=production` を付けて実行する（マシンタイプ・高可用性・予算額は【要確認】）。

### 予算を「請求先全体で5,000円」にする考え方

- 予算は請求先アカウントに作られる。Pub/Sub でつなげる通知先は1つの予算に1つだけなので、**案件ごとに予算を1つずつ作り、どれも対象を「すべてのプロジェクト」にする**（`BUDGET_SCOPE=all`。既定）。
- どの予算も請求先全体の合計で判定するため、合計が5,000円に達すると、各案件の停止サービスがそれぞれ自分のプロジェクトの請求先を外す。結果として全体で5,000円が上限になる。
- 同じ請求先のほかのデモ案件の予算も、対象を「すべてのプロジェクト」・金額5,000円にそろえる（コンソールの「予算とアラート」→ 予算を編集 →「スコープ」→ プロジェクトを「すべてのプロジェクト」）。そろえていない案件は、自分のプロジェクトの費用だけで判定するので、全体の上限では止まらない。
- メールは予算ごとに届くので、同じ内容のメールが案件の数だけ届く。
- 同じ請求先に止めてはいけないプロジェクトがあるなら、そのプロジェクトの費用も合計に入る点に注意する（本番は請求先を分け、`BUDGET_SCOPE=project`・`AUTO_STOP=false` にする）。

## 3. デプロイ（Claude が GitHub Actions で行う）

Actions のワークフロー「gcp」を手動で起動する（Actions → gcp → Run workflow）。入力の `command`：

| command | 内容 |
|---|---|
| `deploy` | イメージ（runner・tools）を作って Artifact Registry に載せる → ジョブ `weorder-tools` を作る・更新する → マイグレーション → サービス `weorder` と `weorder-budget-stop` をデプロイ → `/api/health` で起動を確認 |
| `seed` | マスタ・デモユーザー・サンプルオーダーを登録（`infra/env/<env>.env` の `SEED_*` に従う。何度実行してもよい。オーダーが1件でもあればサンプルオーダーは作らない） |
| `migrate`・`status` | マイグレーションの適用・状態の表示 |
| `create-admin` | 管理者ユーザーを作る（入力の `admin_email`・`admin_name`）。パスワードは設定しない（Entra ID でログインするか、管理画面でパスワードを再設定する） |
| `models` | Vertex AI で使える Gemini のモデル名（asia-northeast1・global）と、`GEMINI_MODEL` の呼び出し確認 |
| `digest`・`reminder` | Cloud Scheduler のジョブを今すぐ実行し、アプリのログ（HTTPステータス・件数）を表示する。定期処理の認証（OIDC）の確認に使う |

初回は `deploy` → `seed` → `models`（AI のモデル名の確認）→ `digest`（定期処理の認証の確認）の順に実行する。

### アプリの設定（環境変数）

`infra/deploy.sh` が `infra/env/<env>.env` から Cloud Run に設定する。秘密情報は Secret Manager から渡す。

| 環境変数 | 値 |
|---|---|
| `APP_BASE_URL`・`AUTH_URL`・`CRON_OIDC_AUDIENCE` | サービスの URL（`https://weorder-<プロジェクト番号>.asia-northeast1.run.app`） |
| `CRON_SERVICE_ACCOUNT` | `weorder-scheduler@…` |
| `DATABASE_URL`・`AUTH_SECRET` | Secret Manager（`weorder-database-url`・`weorder-auth-secret`） |
| `APP_ENV`・`AUTH_PASSWORD_LOGIN`・`MAIL_TRANSPORT`・`MAIL_FROM`・`AI_PROVIDER`・`GEMINI_MODEL`・`VERTEX_LOCATION`・`DB_POOL_MAX` | `infra/env/<env>.env` |
| `UPLOAD_BUCKET`・`GOOGLE_CLOUD_PROJECT` | 同上 |

- 画面は公開する（ログインはアプリで行う）。Cloud Run は「起動元の IAM チェックを無効」でデプロイする（allUsers は付けない）。そのためデプロイ用のサービスアカウントは `roles/run.admin`。
- **ログインには必ず上の URL（`https://weorder-<プロジェクト番号>.asia-northeast1.run.app`）を使う。** Cloud Run にはもう1つ別の形の URL もあるが、そちらから入るとログイン後の移動先が合わない（`AUTH_URL` を上の URL にしているため）。

## 4. ログイン（デモ）

- URL：`https://weorder-<プロジェクト番号>.asia-northeast1.run.app`
- デモユーザー：README の表（sales1@example.com など10名。すべて架空）
- 初期パスワード：Cloud Shell で `gcloud secrets versions access latest --secret=weorder-seed-password --project=waveenergy-erp`
- 初回ログイン時にパスワードの変更を求める（SPEC §6）。

## 5. 本番への載せ替え

1. Wave Energy様のプロジェクトで 1・2 を行う（`AUTO_STOP=false`・`BUDGET_SCOPE=project` など。2 の本番の注を参照）。
2. `infra/env/production.env.example` を `production.env` にコピーして値を入れ、`.github/workflows/gcp.yml` の `env` の選択肢に `production` を足す。
3. `deploy` → `seed`（`SEED_DEMO_USERS=false`・`SEED_SAMPLE_ORDERS=false`。マスタだけを登録）→ `create-admin` で最初の管理者を作る。
4. M9 の準備ができたら：Entra ID のアプリ登録の値（`AUTH_MICROSOFT_ENTRA_ID_*`）と Graph の値（`GRAPH_*`）を Secret Manager と env に入れ、`AUTH_PASSWORD_LOGIN=false`・`MAIL_TRANSPORT=graph` にする（`infra/deploy.sh` に渡す変数を足す）。

## 6. 運用

- **バックアップ**：Cloud SQL の自動バックアップ（毎日 日本時間3時、7世代）とポイントインタイムリカバリ（7日）。復元はコンソールの Cloud SQL →「バックアップ」から別インスタンスに行う。
- **AI のモデル**：`GEMINI_MODEL`（既定 `gemini-3.8-flash`）・`VERTEX_LOCATION`（既定 `global`）。モデル名は推測しない。Actions の `models` で、そのプロジェクトで使える名前と東京リージョン（asia-northeast1）での可否を確かめて決める（新しいプロジェクトでは古いモデルが 404 になる）。global は処理場所が日本とは限らない【要確認：SPEC §4.4】。
- **費用**：デモは Cloud SQL の最小構成（db-f1-micro）・Cloud Run の最小インスタンス0。請求先全体で月5,000円の予算で、100%に達したら請求先を外して止める（止まったらコンソールの「お支払い」で請求先をつなぎ直す。費用の集計は数時間〜1日遅れるので、少し超えてから止まる）。
- **ログ**：Cloud Logging。アプリは個人情報や資料の本文をログに出さない（SPEC §8）。

## 7. デモ環境を消す

お客様のデータを残さないため、デモが終わったらプロジェクトごと削除する（コンソールの「IAM と管理」→「設定」→「シャットダウン」）。Cloud SQL は削除保護が付いているので、プロジェクトを残してインスタンスだけ消す場合は先に削除保護を外す。

## 8. うまくいかないとき

| 症状 | 確認すること |
|---|---|
| Actions の認証で失敗する | `infra/env/demo.env` の `WIF_PROVIDER`・`DEPLOYER_SA`。リポジトリ名が setup.sh の `GITHUB_REPO` と同じか |
| `deploy` のマイグレーションで失敗する | Cloud SQL のインスタンスが起動しているか。`weorder-app` に `roles/cloudsql.client` があるか |
| ログイン後に別の URL に飛ぶ | 上の「ログインには必ず…」の URL を使っているか |
| 定期処理が 401 | `digest` を実行してログを見る。`CRON_OIDC_AUDIENCE`（サービスの URL）と `CRON_SERVICE_ACCOUNT` が Cloud Scheduler の設定と合っているか |
| AI下書きが失敗する | `weorder-app` に `roles/aiplatform.user` があるか。モデル名・リージョンが使えるか（429 は割り当て） |
