# デプロイ手順書（GCP）

オーダー発令・仕様確定管理アプリを Google Cloud に構築・デプロイする手順。
SPEC §8（非機能要件）・§9（システム構成）・§10（環境）に対応する。
この手順書とリポジトリの `infra/` だけで、別の GCP プロジェクトに同じ環境を作れることを目標にしている（SPEC §11-9）。

- デモ環境：金指の GCP プロジェクト（例：`we-order-demo`）。架空データのみ
- 本番環境：Wave Energy様の GCP プロジェクト。**同じスクリプトを、設定ファイルを差し替えて実行する**（[7. 本番環境への載せ替え](#7-本番環境への載せ替え)）

---

## 目次

1. [全体構成](#1-全体構成)
2. [前提](#2-前提)
3. [デモ環境の構築（§10.1 手順1〜9）](#3-デモ環境の構築101-手順19)
4. [GitHub Actions の設定](#4-github-actions-の設定)
5. [構築後のログイン](#5-構築後のログイン)
6. [日常の運用（再デプロイ・設定変更）](#6-日常の運用再デプロイ設定変更)
7. [本番環境への載せ替え](#7-本番環境への載せ替え)
8. [バックアップとリストア](#8-バックアップとリストア)
9. [Vertex AI のリージョンとモデル](#9-vertex-ai-のリージョンとモデル)
10. [費用を抑えるために](#10-費用を抑えるために)
11. [トラブルシューティング](#11-トラブルシューティング)
12. [デモ環境の削除](#12-デモ環境の削除)
13. [参考：環境変数とシークレットの一覧](#13-参考環境変数とシークレットの一覧)

---

## 1. 全体構成

```
ブラウザ ──HTTPS──▶ Cloud Run サービス（we-order、asia-northeast1）
                       │  実行SA：we-order-runtime
                       ├─ Cloud SQL for PostgreSQL 16（Unix ソケット /cloudsql/…）
                       ├─ Secret Manager（DATABASE_URL、AUTH_SECRET など）
                       ├─ Vertex AI（Gemini、asia-northeast1）
                       └─ Cloud Storage（AI入力ファイル、30日で自動削除）

Cloud Scheduler ──OIDC──▶ /api/internal/cron/daily-digest、/api/internal/cron/accept-reminder
  （スケジューラSA：we-order-scheduler）

GitHub Actions ──Workload Identity Federation──▶ デプロイSA：we-order-deployer
  └─ イメージをビルド → Artifact Registry → Cloud Run ジョブでマイグレーション → Cloud Run を更新
```

| 要素 | 内容 |
|---|---|
| コンテナイメージ | `Dockerfile` に2つのターゲット。**runner**（Cloud Run サービス用。Next.js の standalone 出力のみ、非root）と **tools**（マイグレーション・シード・管理者作成用の Cloud Run ジョブで使う） |
| Cloud Run ジョブ | `we-order-migrate`（`prisma migrate deploy`）、`we-order-seed`（`prisma db seed`）、`we-order-create-admin`（最初の管理者作成） |
| DB 接続 | Cloud Run の組み込みの Cloud SQL 接続（Unix ソケット）。`DATABASE_URL` は `postgresql://<ユーザー>:<パスワード>@localhost/<DB名>?host=/cloudsql/<プロジェクト>:<リージョン>:<インスタンス>` の形で Secret Manager に保存 |
| 公開設定 | ブラウザからはアプリのログイン画面で認証するため、Cloud Run は認証なしで呼び出せる設定にする（既定は「呼び出し元の IAM チェックを無効化」。`allUsers` を使わない方式）。`*.run.app` は HTTPS のみ |
| 定期処理の認証 | Cloud Scheduler がスケジューラSAの OIDC トークンを付けて呼ぶ。アプリはトークンの audience（`CRON_OIDC_AUDIENCE`）とメールアドレス（`CRON_SERVICE_ACCOUNT`）を検証する |
| 秘密情報 | すべて Secret Manager（東京リージョンにだけ複製）。ランタイムSAには必要なシークレットだけ参照権限を付ける |
| ログ | アプリの標準出力 → Cloud Logging |

### サービスアカウントと権限

| サービスアカウント | 用途 | 権限 |
|---|---|---|
| `we-order-runtime` | Cloud Run サービスとジョブの実行 | `roles/cloudsql.client`、`roles/aiplatform.user`、`roles/logging.logWriter`（プロジェクト）／`roles/storage.objectUser`（AI入力ファイル用バケットのみ）／`roles/secretmanager.secretAccessor`（必要なシークレットのみ） |
| `we-order-deployer` | GitHub Actions・Cloud Build | `roles/run.admin`（※）、`roles/logging.logWriter`（プロジェクト）／`roles/artifactregistry.writer`（このリポジトリのみ）／`roles/iam.serviceAccountUser`（ランタイムSAのみ）／`roles/storage.objectViewer`（ビルド用バケットのみ） |
| `we-order-scheduler` | Cloud Scheduler の OIDC トークン | `roles/run.invoker`（このサービスのみ） |

※ `roles/run.developer` でもイメージの更新はできる見込みだが、「呼び出し元の IAM チェック無効」のサービスの更新で追加の権限を求められる可能性があるため、既定は `roles/run.admin` にしている【要確認】。初回のデプロイ後に `DEPLOYER_RUN_ROLE=roles/run.developer` に下げられるか確認する（`infra/04-service-accounts.sh` の注を参照）。

スケジューラSAの `roles/run.invoker` は、サービスが公開設定のため現状は不要だが、将来 IAM で非公開にしても定期処理が止まらないよう付けている。

サービスアカウントの鍵ファイルは作らない（SPEC §9）。

---

## 2. 前提

### 2.1 手元に必要なもの

| ツール | 用途 |
|---|---|
| Google Cloud CLI（`gcloud`） | すべてのスクリプト。最新版に更新しておく（`gcloud components update`） |
| bash、openssl、curl、git | スクリプト内で使用（macOS 標準の bash 3.2 でも動く） |
| Docker | `BUILD_MODE=docker` のときだけ。既定の `cloudbuild` では不要 |
| GitHub CLI（`gh`） | 任意。`05-github-wif.sh --set-github-vars` で GitHub の変数を自動登録するとき |

```bash
gcloud auth login
```

### 2.2 実行する人の権限

対象プロジェクトの **オーナー（`roles/owner`）** で実行するのが簡単。オーナーを付けられない場合は、少なくとも次のロールが必要。

- `roles/serviceusage.serviceUsageAdmin`（API の有効化）
- `roles/cloudsql.admin`
- `roles/storage.admin`
- `roles/iam.serviceAccountAdmin`、`roles/iam.serviceAccountUser`
- `roles/resourcemanager.projectIamAdmin`
- `roles/iam.workloadIdentityPoolAdmin`
- `roles/secretmanager.admin`
- `roles/artifactregistry.admin`
- `roles/run.admin`
- `roles/cloudbuild.builds.editor`
- `roles/cloudscheduler.admin`
- （任意）`roles/billing.viewer`（請求先の確認）

GitHub 側は、対象リポジトリの管理者（Environment と変数の設定のため）。

### 2.3 請求先アカウント

§10.1 手順1（プロジェクト作成と請求先アカウントの紐づけ）は**金指が実施**する。`01-enable-apis.sh` は請求先が紐づいていることを確認してから進む。

---

## 3. デモ環境の構築（§10.1 手順1〜9）

以下は `infra/all.sh demo --seed` で手順2〜9をまとめて実行することもできる。初回は手順ごとに実行して結果を確かめることを勧める。
どのスクリプトも**何度実行しても同じ結果**になる。途中で失敗したら原因を直してそのまま再実行すればよい。

### 準備：設定ファイル

```bash
cp infra/config/demo.env.example infra/config/demo.env
```

`infra/config/demo.env` を開いて、少なくとも次を書き換える（`*.env` は Git に含めない）。

| 項目 | 内容 |
|---|---|
| `PROJECT_ID` | 手順1で作ったプロジェクトID |
| `GITHUB_REPOSITORY` | `オーナー/リポジトリ名` |
| `MAIL_FROM` | 通知メールの送信元（デモは DB 保存のみなので仮でよい） |

その他の項目（リージョン、Cloud SQL のマシンタイプ、Cloud Run の台数など）は既定値のままでよい。

### 手順1：GCP プロジェクトの作成と請求先の紐づけ（金指）

```bash
gcloud projects create we-order-demo --name="we-order demo"
gcloud billing accounts list
gcloud billing projects link we-order-demo --billing-account=XXXXXX-XXXXXX-XXXXXX
```

（Cloud Console の「プロジェクトを作成」「お支払い」からでもよい。）

### 手順2：API の有効化

```bash
infra/01-enable-apis.sh demo
```

Cloud Run、Cloud SQL Admin、Artifact Registry、Secret Manager、Vertex AI、Cloud Storage、Cloud Scheduler、IAM Credentials に加え、IAM、Security Token Service（Workload Identity Federation 用）、Cloud Build、Cloud Resource Manager、Cloud Logging を有効にする。

### 手順3：Cloud SQL（PostgreSQL）

```bash
infra/02-cloudsql.sh demo
```

- PostgreSQL 16、東京リージョン、Enterprise エディション、デモは最小の `db-f1-micro`
- 自動バックアップ（7世代保持、毎日 3:00 日本時間に開始）とポイントインタイムリカバリ（ログ7日保持）を有効化（SPEC §8）
- 削除保護を有効化
- データベース `we_order` とユーザー `we_app` を作成。パスワードはランダムに生成して Secret Manager（`we-order-db-password`）に直接登録し、画面には出さない
- アプリ用の接続文字列を Secret Manager（`we-order-database-url`）に登録
- インスタンスの作成には10分ほどかかる

公開IPは付くが、承認済みネットワークを登録しないため、Cloud SQL コネクタ（Cloud Run の組み込み接続など）以外からは接続できない。

DB ユーザーのパスワードを変えたいときは `--rotate-db-password` を付けて実行し、続けて `07-deploy.sh` で新しいリビジョンを作る。

### 手順4：Cloud Storage バケット

```bash
infra/03-storage.sh demo
```

- `<PROJECT_ID>-uploads`：AI下書きの入力ファイルの一時保存先。**作成から30日で自動削除**、均一なバケットレベルのアクセス、公開アクセス防止、論理削除なし（30日で確実に消えるように）
- `<PROJECT_ID>-build-src`：Cloud Build に送るソースの置き場（7日で自動削除）

### 手順5：サービスアカウントと権限

```bash
infra/04-service-accounts.sh demo
```

[1. 全体構成](#サービスアカウントと権限) の表のとおりに作成・付与する。Artifact Registry のリポジトリ（`we-order`）もここで作り、古いイメージを自動で消す設定（各イメージの新しい10個は残す）を入れる。

### 手順6：GitHub リポジトリと Workload Identity Federation

1. GitHub でプライベートリポジトリを作成し、このコードを push する（GitHub の画面で作成）
2. GitHub リポジトリの Settings → Environments で `demo` を作る（次のスクリプトの `--set-github-vars` でも作られる）
3. 次を実行する

```bash
infra/05-github-wif.sh demo
# gh コマンドで GitHub の変数まで登録する場合
infra/05-github-wif.sh demo --set-github-vars
```

- Workload Identity プール `github` と OIDC プロバイダ `github-actions` を作る
- 信頼する条件：**リポジトリが `GITHUB_REPOSITORY` と一致し、かつ GitHub の Environment が `GITHUB_ENVIRONMENT`（demo）のジョブ**。`GITHUB_BRANCH` を設定すると、さらにそのブランチに限る
- デプロイSAに `roles/iam.workloadIdentityUser` を付け、上の条件を満たすジョブだけがデプロイSAとして動けるようにする
- 最後に GitHub Actions に設定する変数の一覧を表示する（[4. GitHub Actions の設定](#4-github-actions-の設定)）

### 手順7：Secret Manager

```bash
infra/06-secrets.sh demo
```

- `we-order-auth-secret`（`AUTH_SECRET`）：ランダムに生成
- `we-order-seed-demo-password`（`SEED_DEMO_PASSWORD`）：デモユーザーの初期パスワード。入力を求められる（空のまま Enter でランダム生成）。環境変数で渡すこともできる：`SEED_DEMO_PASSWORD='...' infra/06-secrets.sh demo`
- SMTP を使う場合：`SMTP_PASSWORD='...' infra/06-secrets.sh demo`（`SMTP_HOST` などは設定ファイルに書く）
- ランタイムSAに、必要なシークレットだけ参照権限を付ける

登録済みのシークレットは作り直さない。`AUTH_SECRET` を作り直すときは `--rotate-auth-secret`（全員がログアウトされる）、デモの初期パスワードを登録し直すときは `--reset-seed-password`。

### 手順8：初回デプロイ、DBマイグレーション、シード投入

```bash
infra/07-deploy.sh demo --seed
```

1. Cloud Build で runner と tools の2つのイメージを作り、Artifact Registry に登録（10分ほど。手元の Docker を使う場合は `--build-mode docker`）
2. Cloud Run ジョブ `we-order-migrate` を作成して実行（`prisma migrate deploy`）
3. Cloud Run サービス `we-order` をデプロイ（最小0台・最大3台、環境変数、Secret Manager、Cloud SQL 接続、公開設定）
4. 初回は URL が決まってから `APP_BASE_URL`・`AUTH_URL`・`CRON_OIDC_AUDIENCE` に URL を設定し直す（新しいリビジョンが1つ増える）
5. Cloud Run ジョブ `we-order-seed` を作成し、`--seed` のときだけ実行（マスタ、デモユーザー、サンプルオーダー。すべて架空データ）
6. `/api/health` で起動を確認

最後に URL と、デモユーザーの初期パスワードの確認方法が表示される。

シードは**デモの初回だけ**実行する。2回目以降に `--seed` を付けても、既にあるマスタ・ユーザーはそのまま、オーダーがあればサンプルオーダーは作られない（シードの作り）。

### 手順9：Cloud Scheduler

```bash
infra/08-scheduler.sh demo --run-now
```

| ジョブ | 呼び出し先 | スケジュール（Asia/Tokyo） |
|---|---|---|
| `we-order-daily-digest` | `POST /api/internal/cron/daily-digest` | 平日 8:00（`0 8 * * 1-5`） |
| `we-order-accept-reminder` | `POST /api/internal/cron/accept-reminder` | 平日 8:00〜18:00 の毎正時（`0 8-18 * * 1-5`） |

- スケジューラSAの OIDC トークン（audience = Cloud Run の URL）を付けて呼ぶ
- 失敗したときは60秒後に1回だけ再試行する
- `--run-now` を付けると、登録後に1回ずつ実行する。結果は Cloud Console の Cloud Scheduler（「最終実行の結果」）と Cloud Run のログで確認する

---

## 4. GitHub Actions の設定

### 4.1 ワークフロー

| ファイル | いつ動くか | 内容 |
|---|---|---|
| `.github/workflows/ci.yml` | プルリクエスト、main への push | npm ci（prisma generate）→ マイグレーションの適用確認（PostgreSQL 16 のサービスコンテナ）→ スキーマとマイグレーションの食い違いの確認 → シードの動作確認 → Lint → 型チェック → 単体テスト → ビルド。別ジョブでコンテナイメージ（runner / tools）のビルド確認 |
| `.github/workflows/deploy.yml` | 手動実行（デモ／本番を選ぶ）。main への push（`AUTO_DEPLOY_DEMO=true` のときだけデモへ） | Workload Identity Federation で認証 → イメージ2つをビルドして Artifact Registry に登録 → マイグレーション用ジョブのイメージを更新して実行 → シード用ジョブのイメージを更新（実行しない）→ Cloud Run サービスのイメージを更新 → `/api/health` を確認 |

デプロイのワークフローは**イメージの差し替えだけ**を行う。環境変数・シークレット・Cloud SQL 接続・公開設定は前のリビジョンを引き継ぐ。
設定の正は `infra/07-deploy.sh` と設定ファイルなので、**初回は必ず `07-deploy.sh` でデプロイ**し、設定を変えたときも `07-deploy.sh` を使う。

マイグレーションはサービスの更新より前に実行する。そのため、マイグレーションは「1つ前のバージョンのアプリでも動く」形（列の追加など）にする。列の削除・名前変更は2回のリリースに分ける。

### 4.2 GitHub に登録する値

GitHub リポジトリの Settings → Environments → `demo`（本番は `production`）→ **Environment variables** に登録する。秘密情報ではないので Secrets ではなく Variables に入れる。値は `infra/05-github-wif.sh` が表示する（`--set-github-vars` を付ければ自動で登録される）。

| 変数 | 例 |
|---|---|
| `GCP_PROJECT_ID` | `we-order-demo` |
| `GCP_REGION` | `asia-northeast1` |
| `GCP_WIF_PROVIDER` | `projects/123456789012/locations/global/workloadIdentityPools/github/providers/github-actions` |
| `GCP_DEPLOYER_SA` | `we-order-deployer@we-order-demo.iam.gserviceaccount.com` |
| `GCP_AR_REPOSITORY` | `we-order` |
| `CLOUD_RUN_SERVICE` | `we-order` |
| `APP_IMAGE_NAME` | `we-order-app` |
| `TOOLS_IMAGE_NAME` | `we-order-tools` |
| `MIGRATE_JOB` | `we-order-migrate` |
| `SEED_JOB` | `we-order-seed` |

リポジトリ変数（Settings → Secrets and variables → Actions → Variables）：

| 変数 | 内容 |
|---|---|
| `AUTO_DEPLOY_DEMO` | `true` にすると main への push でデモへ自動デプロイする（未設定なら手動実行のみ） |

### 4.3 本番の承認

本番の Environment（`production`）に **Required reviewers（承認者）** を設定すると、承認されるまで本番へのデプロイは始まらない。さらに本番の Workload Identity Federation は「Environment が production のジョブ」かつ「main ブランチ」（`GITHUB_BRANCH=main`）からのトークンしか受け付けないため、承認を経ないと本番の GCP に触れない。

【要確認】GitHub の料金プランによっては、プライベートリポジトリで Environment や承認者の機能が使えない。使えない場合は、本番へのデプロイは GitHub Actions を使わず、本番プロジェクトの担当者が `infra/07-deploy.sh production` を実行する運用にする（`05-github-wif.sh` は本番では実行しない）。

---

## 5. 構築後のログイン

1. `07-deploy.sh` の最後に表示された URL（`https://we-order-<数字>.asia-northeast1.run.app` など）を開く
2. 初期パスワードを確認する

   ```bash
   gcloud secrets versions access latest --secret=we-order-seed-demo-password --project=<PROJECT_ID>
   ```

3. 下のデモユーザーのメールアドレスと初期パスワードでログインする
4. **初回ログイン時にパスワードの変更を求められる**（SPEC §6。`SEED_MUST_CHANGE_PASSWORD=true`）

デモユーザー（`prisma/seed.ts` の内容。すべて架空）：

| メールアドレス | 氏名 | 部署 | ロール |
|---|---|---|---|
| `sales1@example.com` | 青木 健太 | 営業一部 | 営業 |
| `sales2@example.com` | 井上 美咲 | 営業二部 | 営業 |
| `manager@example.com` | 上田 誠 | 営業本部 | 営業・営業管理職 |
| `reception@example.com` | 江藤 修 | 技術部 技術課 | 技術受付 |
| `tech1@example.com` | 大野 翔 | 技術部 技術課 | 技術担当 |
| `tech2@example.com` | 加藤 由美 | 技術部 技術課 | 技術担当 |
| `design@example.com` | 木村 拓也 | 技術部 設計課 | 閲覧 |
| `factory@example.com` | 工藤 大輔 | 製造部 工作一課 | 閲覧 |
| `purchase@example.com` | 小林 恵 | 製造部 購買課 | 閲覧 |
| `admin@example.com` | 佐々木 理沙 | システム管理 | 管理者 |

デモの通知メールは送信されず、アプリの「送信メール履歴」に保存される（`MAIL_TRANSPORT=db`）。

最小0台の設定のため、しばらく使っていないと最初のアクセスに数秒〜十数秒かかる。

---

## 6. 日常の運用（再デプロイ・設定変更）

| やりたいこと | 方法 |
|---|---|
| コードの変更を反映する | GitHub Actions の Deploy を実行（または `AUTO_DEPLOY_DEMO=true` で main に push）。手元からなら `infra/07-deploy.sh demo` |
| 環境変数を変える | `infra/config/demo.env` を直して `infra/07-deploy.sh demo`（GitHub Actions でビルド済みのイメージを使うなら `--skip-build --tag <コミットID>`） |
| シークレットを変える | `infra/06-secrets.sh demo`（オプションは手順7）→ `infra/07-deploy.sh demo` で新しいリビジョンを作る（Cloud Run は起動時に `latest` を読む） |
| マイグレーションだけ実行する | `gcloud run jobs execute we-order-migrate --region=asia-northeast1 --wait --project=<PROJECT_ID>` |
| 以前のバージョンに戻す | Cloud Console の Cloud Run → リビジョン → 以前のリビジョンにトラフィックを100%。または `gcloud run services update-traffic we-order --to-revisions=<リビジョン名>=100 --region=asia-northeast1`（DB のマイグレーションは戻らないので注意） |
| ログを見る | Cloud Console の Cloud Run → we-order → ログ。ジョブは Cloud Run → ジョブ → 各ジョブ → 実行履歴 |

---

## 7. 本番環境への載せ替え

本番は Wave Energy様の GCP プロジェクトに、**同じスクリプトを本番用の設定ファイルで実行**して作る（SPEC §0-6、§10.1）。コードの変更は不要。

### 7.1 設定ファイル

```bash
cp infra/config/production.env.example infra/config/production.env
```

デモとの主な違い（雛形の【本番】の項目）：

| 項目 | 本番の値 | 備考 |
|---|---|---|
| `PROJECT_ID` | Wave Energy様のプロジェクトID | 【要確認】 |
| `APP_ENV` | `production` | 送信メール履歴画面を出さない |
| `SQL_TIER` | `db-custom-1-3840` | 1 vCPU・3.75GB。50名・同時10名程度を想定 |
| `SQL_AVAILABILITY_TYPE` | `zonal`（高可用性が必要なら `regional`） | 【要確認】`regional` は費用が約2倍 |
| `GITHUB_ENVIRONMENT` / `GITHUB_BRANCH` | `production` / `main` | 承認者を設定する |
| `AUTH_PASSWORD_LOGIN` | M9 で Entra ID を設定するまでは `true`、設定後は `false` | SPEC §6 |
| `MAIL_TRANSPORT` | M9 で Graph を設定するまでは `db`、設定後は `graph` | |
| `MAIL_FROM` | 送信元アドレス | 【要確認】SPEC §14-8 |
| `SEED_SAMPLE_ORDERS` | `false` | サンプルオーダーを作らない |
| `SEED_DEMO_USERS` | `false` | デモユーザーを作らない |

### 7.2 手順

```bash
infra/01-enable-apis.sh production
infra/02-cloudsql.sh production
infra/03-storage.sh production
infra/04-service-accounts.sh production
infra/05-github-wif.sh production      # GitHub Actions で本番へデプロイする場合のみ
infra/06-secrets.sh production
infra/07-deploy.sh production --seed   # マスタ（部署・製品区分・テンプレートなど）だけを投入
infra/08-scheduler.sh production
infra/create-admin.sh production --email <管理者のメールアドレス> --name "<氏名>"
```

- 本番の `--seed` は `SEED_DEMO_USERS=false`・`SEED_SAMPLE_ORDERS=false` で実行され、**マスタだけ**が入る（`07-deploy.sh` は本番で `SEED_DEMO_USERS=false` でないとシードを止める）
- デモユーザー（`@example.com`）は本番には作らない。最初の管理者を `create-admin.sh` で作り、以降のユーザーはアプリの管理画面から登録する（招待制。SPEC §6）
- `create-admin.sh` は、パスワードログインが有効なら初期パスワードをランダムに生成して Secret Manager（`we-order-initial-admin-password`）に登録する。確認は `gcloud secrets versions access latest --secret=we-order-initial-admin-password --project=<PROJECT_ID>`。初回ログイン時にパスワード変更を求める
- データはデモから移さない（デモは架空データのみのため。SPEC §0-5）

### 7.3 M9（Entra ID・Graph）の設定後

1. Entra ID のアプリ登録で、リダイレクトURIに `<APP_BASE_URL>/api/auth/callback/microsoft-entra-id` を登録する
2. 秘密情報を登録する

   ```bash
   AUTH_MICROSOFT_ENTRA_ID_SECRET='...' GRAPH_CLIENT_SECRET='...' infra/06-secrets.sh production
   ```

3. 設定ファイルに `AUTH_MICROSOFT_ENTRA_ID_ID`、`AUTH_MICROSOFT_ENTRA_ID_ISSUER`、`GRAPH_TENANT_ID`、`GRAPH_CLIENT_ID`、`GRAPH_SENDER` を書き、`MAIL_TRANSPORT="graph"` にする
4. Entra ID でログインできることを確認してから `AUTH_PASSWORD_LOGIN="false"` にする
5. `infra/07-deploy.sh production` で反映する

### 7.4 独自ドメインを使う場合

Cloud Run のドメインマッピングまたはロードバランサで独自ドメインを設定し、設定ファイルの `APP_BASE_URL` にそのURLを書いて `07-deploy.sh` を再実行する（通知メールのリンクと Auth.js のURLに使われる）。定期処理の audience は Cloud Run の URL のままでよい。

---

## 8. バックアップとリストア

- 自動バックアップ：毎日（3:00 日本時間に開始）、7世代保持
- ポイントインタイムリカバリ：過去7日の任意の時点に戻せる
- 削除保護：インスタンスを誤って削除できない

### 自動バックアップから戻す

```bash
gcloud sql backups list --instance=we-order-db --project=<PROJECT_ID>
# 同じインスタンスに上書きで戻す（現在のデータは失われる）
gcloud sql backups restore <BACKUP_ID> --restore-instance=we-order-db --project=<PROJECT_ID>
```

### 特定の時点に戻す（ポイントインタイムリカバリ）

元のインスタンスはそのままに、指定時点の状態の**新しいインスタンス**を作る。

```bash
gcloud sql instances clone we-order-db we-order-db-restore \
  --point-in-time='2026-10-27T01:00:00Z' --project=<PROJECT_ID>   # 時刻は UTC
```

新しいインスタンスに切り替える場合は、設定ファイルの `SQL_INSTANCE` を新しい名前にして `02-cloudsql.sh`（`DATABASE_URL` の登録し直し）→ `07-deploy.sh` を実行する。ユーザーとパスワードは複製元と同じ。

リストアの前に Cloud Run の最大台数を0にするなど、利用者に止めてもらう連絡をしておく。

---

## 9. Vertex AI のリージョンとモデル

- AI の呼び出しはアプリから `@google/genai` で Vertex AI に行い、認証はランタイムSAの権限（ADC）を使う。API キーは使わない
- リージョンは `VERTEX_LOCATION=asia-northeast1`（東京）。Google のデータ所在地（data residency）のドキュメントで、`gemini-2.5-flash` は asia-northeast1 で提供されている（SPEC §14-9。お客様との合意が必要）
- モデルは `GEMINI_MODEL`（既定 `gemini-2.5-flash`）で切り替える。設定ファイルを変えて `07-deploy.sh` を実行すれば、コードの変更なしで切り替わる
- 【要確認】より新しい Flash 系モデルが asia-northeast1 で提供されているか、使う前に Vertex AI のドキュメント（ロケーション・データ所在地）で確認する。`global` エンドポイントや他リージョンを使うと、処理が東京以外で行われる可能性がある
- AI入力ファイルは `UPLOAD_BUCKET`（東京リージョン）に一時保存され、30日で自動削除される

---

## 10. 費用を抑えるために

| 項目 | 設定 |
|---|---|
| Cloud Run | 最小0台（使わないときは課金されない）。最大3台 |
| Cloud SQL | デモは最小の `db-f1-micro`（共有コア）・ストレージ10GB。費用の大半はここ |
| Cloud SQL を止める | デモを使わない期間は止められる（ストレージ・バックアップの費用は残る）。`gcloud sql instances patch we-order-db --activation-policy=NEVER`、再開は `--activation-policy=ALWAYS` |
| Artifact Registry | 各イメージの新しい10個だけを残し、古いものは自動削除 |
| Cloud Storage | AI入力ファイルは30日、ビルド用ソースは7日で自動削除 |
| Cloud Build | 1回のデプロイで10分程度。GitHub Actions でビルドすれば Cloud Build は使わない |
| Cloud Scheduler | ジョブ2つ |

費用の目安は Google Cloud の料金計算ツールで確認する。予算アラート（お支払い → 予算とアラート）を設定しておくと安心。

---

## 11. トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| `01-enable-apis.sh` で「請求先アカウントが紐づいていません」 | §10.1 手順1を行う。`gcloud billing projects link` |
| Cloud SQL の作成で tier と edition の組み合わせのエラー | `db-f1-micro` などの共有コアは `SQL_EDITION="enterprise"` のみ。PostgreSQL 16 の既定は Enterprise Plus のため、設定ファイルで明示している |
| デプロイで「allUsers を付けられない」「invoker IAM check を無効にできない」（組織のポリシー） | 組織ポリシー（ドメイン制限共有 `iam.allowedPolicyMemberDomains`、`run.managed.requireInvokerIam` など）で禁止されている。`PUBLIC_ACCESS_MODE` を切り替えるか、組織の管理者に例外を依頼する |
| GitHub Actions の認証で `Permission 'iam.serviceAccounts.getAccessToken' denied` や `unauthorized_client` | Workload Identity の条件に合っていない。リポジトリ名（`GITHUB_REPOSITORY`）、Environment 名（`GITHUB_ENVIRONMENT`）、ブランチ（`GITHUB_BRANCH`）を確認して `05-github-wif.sh` を再実行。ワークフローの job に `environment:` が付いていること、`permissions: id-token: write` があることも確認 |
| GitHub Actions で「ジョブ／サービスがありません」 | 初回は `infra/07-deploy.sh` でデプロイする |
| GitHub Actions の `gcloud run deploy` で権限エラー | デプロイSAの `DEPLOYER_RUN_ROLE` を `roles/run.admin` にして `04-service-accounts.sh` を再実行 |
| Cloud Build で権限エラー | デプロイSAに `roles/artifactregistry.writer`、`roles/logging.logWriter`、ビルド用バケットの `roles/storage.objectViewer` があるか確認（`04-service-accounts.sh` を再実行）。実行者にデプロイSAの `iam.serviceAccounts.actAs` が必要 |
| イメージのビルドで Docker Hub の回数制限（429） | ベースイメージは `mirror.gcr.io` から取得する設定にしている。手元の Docker でも `--build-arg NODE_IMAGE=mirror.gcr.io/library/node:22-bookworm-slim` を付ける |
| マイグレーション（ジョブ）が失敗 | Cloud Run → ジョブ → `we-order-migrate` → 実行履歴 → ログ。または `gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="we-order-migrate"' --limit=50 --project=<PROJECT_ID>`。DB に接続できない場合は `DATABASE_URL` のシークレットと Cloud SQL 接続名を確認 |
| ログイン後に `http://0.0.0.0:8080/` などへ飛ばされる | `AUTH_URL` が未設定。`07-deploy.sh` を再実行する（URL を自動で設定する） |
| 定期処理が 401／403 になる | Cloud Scheduler の audience とアプリの `CRON_OIDC_AUDIENCE` が一致しているか、`CRON_SERVICE_ACCOUNT` がスケジューラSAか確認。URL が変わった場合は `07-deploy.sh` → `08-scheduler.sh` を再実行 |
| AI下書きが 403／404 | Vertex AI API の有効化、ランタイムSAの `roles/aiplatform.user`、`GEMINI_MODEL` が `VERTEX_LOCATION` で提供されているかを確認 |
| `too many connections` / `remaining connection slots are reserved` | `db-f1-micro` の同時接続は25まで。`DB_POOL_MAX`（1台あたりの接続数）× `RUN_MAX_INSTANCES` ＋ ジョブの分が収まるように調整するか、マシンタイプを上げる |
| `/api/health` が応答しない | Cloud Run → we-order → ログで起動エラーを確認。よくある原因はシークレットの参照権限（`06-secrets.sh` を再実行）と Cloud SQL 接続 |
| シークレットを変えたのに反映されない | Cloud Run は起動時に読む。`07-deploy.sh` で新しいリビジョンを作る |

---

## 12. デモ環境の削除

### プロジェクトごと削除する（推奨）

デモ専用プロジェクトなら、これが最も確実に費用を止められる。30日間は復元できる。

```bash
gcloud projects delete we-order-demo
```

### リソースを個別に削除する

プロジェクトを残す場合は次の順に削除する（`<…>` は設定ファイルの値）。

```bash
P=<PROJECT_ID>; R=asia-northeast1
gcloud scheduler jobs delete we-order-daily-digest --location=$R --project=$P
gcloud scheduler jobs delete we-order-accept-reminder --location=$R --project=$P
gcloud run services delete we-order --region=$R --project=$P
gcloud run jobs delete we-order-migrate --region=$R --project=$P
gcloud run jobs delete we-order-seed --region=$R --project=$P
gcloud run jobs delete we-order-create-admin --region=$R --project=$P   # 作った場合
gcloud sql instances patch we-order-db --no-deletion-protection --project=$P
gcloud sql instances delete we-order-db --project=$P
gcloud storage rm --recursive gs://$P-uploads gs://$P-build-src
gcloud artifacts repositories delete we-order --location=$R --project=$P
for s in database-url db-password auth-secret seed-demo-password initial-admin-password smtp-password graph-client-secret entra-client-secret; do
  gcloud secrets delete we-order-$s --project=$P 2>/dev/null || true
done
gcloud iam workload-identity-pools delete github --location=global --project=$P
for sa in we-order-runtime we-order-deployer we-order-scheduler; do
  gcloud iam service-accounts delete $sa@$P.iam.gserviceaccount.com --project=$P
done
```

Cloud SQL を削除すると、自動バックアップも削除される。

---

## 13. 参考：環境変数とシークレットの一覧

### Cloud Run サービスの環境変数（`07-deploy.sh` が設定）

| 環境変数 | 値の出どころ |
|---|---|
| `APP_ENV` | 設定ファイル |
| `APP_BASE_URL`、`AUTH_URL` | 設定ファイルの `APP_BASE_URL`。空なら Cloud Run の URL |
| `AUTH_PASSWORD_LOGIN` | 設定ファイル |
| `AUTH_MICROSOFT_ENTRA_ID_ID`、`AUTH_MICROSOFT_ENTRA_ID_ISSUER` | 設定ファイル（M9。空なら設定しない） |
| `MAIL_TRANSPORT`、`MAIL_FROM` | 設定ファイル |
| `SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`、`SMTP_USER` | 設定ファイル（空なら設定しない） |
| `GRAPH_TENANT_ID`、`GRAPH_CLIENT_ID`、`GRAPH_SENDER` | 設定ファイル（M9。空なら設定しない） |
| `AI_PROVIDER`、`GEMINI_MODEL`、`VERTEX_LOCATION` | 設定ファイル |
| `GOOGLE_CLOUD_PROJECT` | 設定ファイルの `PROJECT_ID` |
| `UPLOAD_BUCKET` | 設定ファイル |
| `CRON_OIDC_AUDIENCE` | Cloud Run の URL |
| `CRON_SERVICE_ACCOUNT` | スケジューラSAのメールアドレス |
| `DB_POOL_MAX` | 設定ファイル（1台あたりの DB 接続数の上限） |
| `TZ` | `Asia/Tokyo` |

`CRON_SECRET` はローカル開発専用で、GCP では設定しない。

### Secret Manager

| シークレット名 | 環境変数 | 使う場所 | 登録するスクリプト |
|---|---|---|---|
| `we-order-database-url` | `DATABASE_URL` | サービス、全ジョブ | `02-cloudsql.sh` |
| `we-order-db-password` | （なし） | 保管用（`DATABASE_URL` の作り直しに使う） | `02-cloudsql.sh` |
| `we-order-auth-secret` | `AUTH_SECRET` | サービス | `06-secrets.sh` |
| `we-order-seed-demo-password` | `SEED_DEMO_PASSWORD` | シード用ジョブ | `06-secrets.sh` |
| `we-order-initial-admin-password` | `ADMIN_INITIAL_PASSWORD` | 管理者作成ジョブ | `create-admin.sh` |
| `we-order-smtp-password` | `SMTP_PASSWORD` | サービス（任意） | `06-secrets.sh` |
| `we-order-graph-client-secret` | `GRAPH_CLIENT_SECRET` | サービス（M9） | `06-secrets.sh` |
| `we-order-entra-client-secret` | `AUTH_MICROSOFT_ENTRA_ID_SECRET` | サービス（M9） | `06-secrets.sh` |

シークレット名の先頭（`we-order-`）は設定ファイルの `SECRET_PREFIX` で変えられる。

### アプリ側の前提（実装との約束）

| 項目 | 内容 |
|---|---|
| `GET /api/health` | 認証なしで 200 と JSON を返す（起動確認に使う） |
| `POST /api/internal/cron/daily-digest`、`POST /api/internal/cron/accept-reminder` | `Authorization: Bearer <OIDCトークン>` を検証（audience = `CRON_OIDC_AUDIENCE`、email = `CRON_SERVICE_ACCOUNT`）。再試行で2回呼ばれても二重に通知しない |
| `DB_POOL_MAX` | DB 接続プールの上限として使う |
| シードの `SEED_DEMO_USERS` | `false` のときデモユーザーを作らない（マスタは作る） |
| `prisma/create-admin.ts` | 環境変数 `ADMIN_EMAIL`・`ADMIN_NAME`・`ADMIN_DEPARTMENT`・`ADMIN_INITIAL_PASSWORD`（任意）で管理者を作成・更新する。同じメールアドレスで何度実行しても重複しない |
