# データ項目の対応表（日本語名 ⇔ テーブル名・カラム名）

- 正は `prisma/schema.prisma`。スキーマを変えたらこの表も直す（SPEC §0-4）。
- テーブル名は Prisma のモデル名（PostgreSQL のテーブル名も同じ）。主キー `id`、作成日時 `createdAt`、更新日時 `updatedAt` は共通のため省略する。
- 日付だけの項目（`@db.Date`）は日本時間の日付を UTC 0時として保存する。日時の項目は UTC で保存し、画面では日本時間で表示する。

## テーブル一覧

| 日本語名（SPEC §7） | テーブル | 備考 |
|---|---|---|
| ユーザー | `User` | |
| 部署 | `Department` | |
| 顧客 | `Customer` | |
| 製品区分 | `ProductCategory` | |
| 通知グループ | `NotificationGroup` | 製品区分の「通知グループ」の中身 |
| 仕様項目テンプレート | `SpecFieldTemplate` | |
| 資料テンプレート | `DocumentTemplate` | |
| タスク種別 | `TaskType` | §4.6・§4.10 |
| 採番ルール | `NumberingRule`（1行のみ） | |
| 採番の現在値 | `NumberingCounter` | 採番ルールの「現在値」をリセット単位ごとに持つ |
| システム設定 | `SystemSetting`（1行のみ） | AI機能のオン／オフ、受入催促の日数 |
| オーダー | `Order` | |
| 仕様項目の値 | `SpecValue` | |
| 資料 | `OrderDocument`（資料の枠）＋ `DocumentVersion`（版） | §7 の「資料」を、オーダーごとの資料と、その版の履歴の2つに分けている |
| 未確定項目 | `UnresolvedItem` | |
| タスク | `Task` | |
| やり取り | `Message` | メンションは `_MessageMentions`（中間テーブル） |
| ステータス履歴 | `StatusHistory` | |
| 通知 | `Notification` | |
| 送信メール | `OutboundEmail` | |
| AI実行記録 | `AiRun` | |
| 監査ログ | `AuditLog` | |

多対多の中間テーブル（Prisma が自動で作る）：`_CategoryReception`（製品区分⇔技術受付の通知先）、`_CategoryNotificationGroups`（製品区分⇔通知グループ）、`_NotificationGroupUsers`、`_NotificationGroupDepartments`、`_MessageMentions`。

## 列挙型

| 日本語名 | 型 | 値 |
|---|---|---|
| ロール | `Role` | `SALES` 営業／`SALES_MANAGER` 営業管理職／`TECH_RECEPTION` 技術受付／`TECH` 技術担当／`VIEWER` 閲覧（関係部門）／`ADMIN` 管理者 |
| メール通知設定 | `EmailPreference` | `ALL` すべて受け取る／`DIGEST_ONLY` 毎朝のまとめのみ／`NONE` 受け取らない |
| 確認担当区分 | `ResponsibleType` | `SALES` 営業／`TECH` 技術 |
| タスク種別の既定担当 | `TaskDefaultAssignee` | `SALES` オーダーの営業担当／`TECH` オーダーの技術担当／`NONE` 既定なし |
| オーダーのステータス | `OrderStatus` | `DRAFT` 下書き／`ACCEPT_PENDING` 受入待ち／`RETURNED` 差戻し／`SPEC_PENDING` 仕様確定待ち／`SPEC_FIXED` 仕様確定／`COMPLETED` 完了／`CANCELLED` 取消 |
| 番号の採番方法 | `NumberSource` | `AUTO` 自動採番／`MANUAL` 既存番号の手入力 |
| 納期区分 | `DeliveryType` | `FIXED` 確定／`TENTATIVE` 仮 |
| 注文書／内示書 | `OrderDocType` | `PURCHASE_ORDER` 注文書／`LETTER_OF_INTENT` 内示書 |
| 入力形式 | `SpecInputType` | `TEXT` 1行／`TEXTAREA` 複数行／`TEXTAREA_NONE` 複数行（「なし」選択可）／`NUMBER` 数値／`DATE` 日付／`SELECT` 選択（1つ）／`MULTISELECT` 選択（複数。値は JSON 配列） |
| 仕様項目の状態 | `ValueState` | `FILLED` 入力済み／`UNRESOLVED` 未確定／`NOT_APPLICABLE` 該当なし（NULL は空欄） |
| 資料の必須区分 | `DocRequirement` | `REQUIRED` 必須／`CONDITIONAL` 条件付き／`OPTIONAL` 任意 |
| 資料の状態 | `DocState` | `ATTACHED` 添付済み／`NOT_OBTAINED` 未入手／`NOT_APPLICABLE` 該当なし（NULL は未選択） |
| 未確定項目の対象 | `UnresolvedTarget` | `SPEC_FIELD` 要求仕様書の項目／`DOCUMENT` 資料／`DELIVERY` 納期（納期区分「仮」）／`OTHER` その他 |
| 確認先 | `ConfirmTarget` | `CUSTOMER` 顧客／`INTERNAL` 社内 |
| 設計への影響 | `DesignImpact` | `CAN_START` 着手可／`PARTIAL_START` 一部着手可／`CANNOT_START` 着手不可 |
| 未確定項目のステータス | `UnresolvedStatus` | `OPEN` 未確定／`CHECKING` 確認中／`RESOLVED` 確定／`WITHDRAWN` 取下げ |
| タスクのステータス | `TaskStatus` | `TODO` 未着手／`IN_PROGRESS` 対応中／`DONE` 完了 |
| やり取りの種別 | `MessageKind` | `INTERNAL` 社内連絡／`CUSTOMER_RECORD` 顧客とのやり取り記録 |
| やり取りの手段 | `ContactChannel` | `PHONE` 電話／`EMAIL` メール／`MEETING` 打合せ／`OTHER` その他 |
| 通知の種類 | `NotificationType` | `ORDER_ISSUED` 発令／`ORDER_ACCEPTED` 受入／`ORDER_RETURNED` 差戻し／`TECH_ASSIGNED` 技術担当の割当／`UNRESOLVED_ASSIGNED` 未確定項目の割当／`TASK_ASSIGNED` タスクの割当／`UNRESOLVED_RESOLVED` 未確定項目の確定／`DOCUMENT_VERSION` 資料の新しい版／`SPEC_FIXED` 仕様確定／`MENTION` メンション／`ACCEPT_REMINDER` 受入催促／`DAILY_DIGEST` 毎朝のまとめ |
| メール送信結果 | `EmailResult` | `NOT_REQUIRED` メールなし／`SAVED` DB保存／`SENT` 送信済み／`FAILED` 送信失敗 |
| 送信方式 | `MailTransportType` | `DB` DB保存（デモ）／`SMTP`／`GRAPH` Microsoft Graph |
| 年の表記 | `YearFormat` | `YYYY` 西暦4桁／`YY` 西暦下2桁／`NONE` 年を含めない |
| リセット単位 | `ResetUnit` | `NONE` リセットしない／`YEAR` 暦年／`FISCAL_YEAR` 年度 |
| AI実行の結果 | `AiRunStatus` | `SUCCEEDED` 成功／`FAILED` 失敗 |

## カラム

### ユーザー `User`

| 日本語名 | カラム | 備考 |
|---|---|---|
| 氏名 | `name` | |
| メールアドレス | `email` | 一意。小文字で保存。Entra ID ログイン時の照合キー |
| パスワード（ハッシュ） | `passwordHash` | bcrypt。パスワードログインのみ |
| 初回パスワード変更が必要 | `mustChangePassword` | |
| 部署 | `departmentId` | → `Department` |
| ロール（複数） | `roles` | `Role[]` |
| 有効／無効 | `active` | |
| メール通知設定 | `emailPreference` | |
| 最終ログイン日時 | `lastLoginAt` | |

### 部署 `Department`

| 日本語名 | カラム | 備考 |
|---|---|---|
| 部署名 | `name` | 一意 |
| 上位部署 | `parentId` | 営業管理職の閲覧範囲（自部署と配下部署）に使う |
| 並び順 | `sortOrder` | |
| 有効 | `active` | |

### 顧客 `Customer`

| 日本語名 | カラム |
|---|---|
| 顧客名 | `name`（一意） |
| 備考 | `note` |
| 有効 | `active` |

### 製品区分 `ProductCategory`

| 日本語名 | カラム | 備考 |
|---|---|---|
| コード | `code` | 一意。SOLAR／SWITCHGEAR／RETROFIT／OTHER（作成後は変更不可） |
| 名称 | `name` | |
| 標準納期（月数） | `standardLeadTimeMonths` | NULL なら短納期の判定をしない |
| 技術受付の通知先 | `receptionUsers` | → `User`（多対多）。未設定なら技術受付ロールの全員 |
| 通知グループ | `notificationGroups` | → `NotificationGroup`（多対多） |
| 並び順・有効 | `sortOrder`・`active` | |

### 通知グループ `NotificationGroup`

| 日本語名 | カラム |
|---|---|
| グループ名 | `name`（一意） |
| 説明 | `description` |
| メンバー（ユーザー） | `users`（多対多） |
| メンバー（部署。部署の有効なユーザー全員） | `departments`（多対多） |
| 有効 | `active` |

### 仕様項目テンプレート `SpecFieldTemplate`

| 日本語名 | カラム | 備考 |
|---|---|---|
| 製品区分 | `productCategoryId` | NULL なら共通項目 |
| 項目名 | `label` | |
| 入力形式 | `inputType` | |
| 必須 | `required` | |
| 選択肢 | `options` | `String[]` |
| 説明 | `description` | |
| 確認担当区分の既定値 | `defaultResponsibleType` | 未確定にしたときの初期表示（SPEC §2.3） |
| 並び順・有効 | `sortOrder`・`active` | |

基本情報（顧客名〜注文書／内示書）は `Order` の固定カラムで持ち、テンプレートでは管理しない。

### 資料テンプレート `DocumentTemplate`

| 日本語名 | カラム |
|---|---|
| 製品区分 | `productCategoryId` |
| 資料名 | `name` |
| 必須区分 | `requirement` |
| 説明 | `description` |
| 確認担当区分の既定値（未入手のとき） | `defaultResponsibleType` |
| 並び順・有効 | `sortOrder`・`active` |

### タスク種別 `TaskType`

| 日本語名 | カラム |
|---|---|
| 種別名 | `name`（一意） |
| 既定担当 | `defaultAssignee` |
| 説明 | `description` |
| 並び順・有効 | `sortOrder`・`active` |

### 採番ルール `NumberingRule` ／ 採番の現在値 `NumberingCounter`

| 日本語名 | カラム | 備考 |
|---|---|---|
| 接頭辞 | `prefix` | 初期値 `WE-` |
| 年の表記（書式） | `yearFormat` | |
| 年と連番の区切り | `separator` | 初期値 `-` |
| 連番の桁数 | `digits` | 初期値 4 |
| リセット単位 | `resetUnit` | |
| 年度の開始月 | `fiscalYearStartMonth` | 年度リセットのとき使用 |
| 現在値 | `NumberingCounter.value` | `periodKey`（例：`2026`、`FY2026`、`ALL`）ごと |

### システム設定 `SystemSetting`

| 日本語名 | カラム |
|---|---|
| AI機能のオン／オフ | `aiEnabled` |
| 受入催促までの営業日数 | `acceptReminderBusinessDays` |
| 毎朝のまとめで「期限が近い」とみなす日数 | `digestDueSoonDays` |

### オーダー `Order`

| 日本語名 | カラム | 備考 |
|---|---|---|
| オーダー番号 | `orderNumber` | 一意。取消しても再利用しない |
| 採番方法 | `numberSource` | |
| ステータス | `status` | |
| 製品区分 | `productCategoryId` | |
| 顧客 | `customerId` | |
| 現場名 | `siteName` | |
| エンドユーザー | `endUser` | |
| 件名 | `title` | |
| 数量 | `quantity` | Decimal(12,2) |
| 数量の単位 | `quantityUnit` | 面・台・式など |
| 営業担当 | `salesUserId` | |
| 営業部署 | `salesDepartmentId` | |
| 技術担当 | `techUserId` | |
| 契約納期 | `contractDeliveryDate` | |
| 納期区分 | `deliveryType` | |
| 確定予定日 | `deliveryFixDueDate` | 納期区分「仮」のとき |
| 短納期フラグ | `shortLeadTime` | 保存時・発令時に自動判定 |
| 関係部門と事前協議済みか | `shortLeadConsulted` | 短納期のとき必須（協議済み／未協議） |
| 事前協議の内容 | `shortLeadNote` | |
| 注文書／内示書の別 | `orderDocType` | |
| 見積番号 | `quoteNumber` | |
| 引合番号 | `inquiryNumber` | |
| 発令日時 | `issuedAt` | 再発令で更新 |
| 初回発令日時 | `firstIssuedAt` | 発令品質レポートの月 |
| 発令回数 | `issueCount` | |
| 発令時点の未確定項目数 | `unresolvedCountAtIssue` | 初回発令時に記録 |
| 受入日時 | `acceptedAt` | |
| 仕様確定日時 | `specFixedAt` | |
| 完了日時 | `completedAt` | |
| 取消日時 | `cancelledAt` | |
| 最後に受入催促した日時 | `lastAcceptReminderAt` | 1日1回まで |
| 出図予定日 | `plannedDrawingDate` | §12 の拡張用。画面には出さない |
| 出図実績日 | `actualDrawingDate` | §12 の拡張用。画面には出さない |
| 作成者 | `createdById` | |

### 仕様項目の値 `SpecValue`

| 日本語名 | カラム | 備考 |
|---|---|---|
| オーダー | `orderId` | |
| テンプレート項目 | `templateId` | |
| 値 | `value` | 複数選択は JSON 配列の文字列 |
| 状態 | `state` | |
| 該当なしの理由 | `naReason` | |
| AI由来か | `aiDerived` | AI下書きの候補をそのまま採用したとき true |

### 資料 `OrderDocument` ／ 資料の版 `DocumentVersion`

| 日本語名 | カラム | 備考 |
|---|---|---|
| オーダー | `OrderDocument.orderId` | |
| 資料テンプレート | `OrderDocument.templateId` | NULL ならチェックリスト以外の追加資料 |
| 資料名（追加資料） | `OrderDocument.name` | |
| 状態 | `OrderDocument.state` | |
| 該当なしの理由 | `OrderDocument.naReason` | |
| URL（またはパス） | `DocumentVersion.url` | `https://` または `\\` で始まる |
| 版数 | `DocumentVersion.version` | |
| 日付 | `DocumentVersion.docDate` | |
| 最新フラグ | `DocumentVersion.isLatest` | 新しい版を登録すると旧版は false |
| メモ | `DocumentVersion.note` | |
| 登録者 | `DocumentVersion.registeredById` | |
| 登録日時 | `DocumentVersion.registeredAt` | |

### 未確定項目 `UnresolvedItem`

| 日本語名 | カラム | 備考 |
|---|---|---|
| オーダー | `orderId` | |
| 対象 | `targetType` | |
| 関連する仕様項目 | `specTemplateId` | 対象が仕様項目のとき |
| 関連する資料 | `documentId` | 対象が資料のとき |
| 対象の名称 | `title` | その他のときは自由記述 |
| 現状わかっていること | `knownInfo` | |
| 確認先 | `confirmTarget` | |
| 確認担当区分 | `responsibleType` | |
| 担当者 | `assigneeId` | |
| 回答期限 | `dueDate` | |
| 設計への影響 | `designImpact` | |
| ステータス | `status` | |
| 確定内容（取下げのときは理由） | `resolution` | |
| 確定日 | `resolvedDate` | |
| 確定・取下げの記録日時 | `resolvedAt` | 確定までの日数の計算に使う |
| 記録者 | `resolvedById` | |
| 登録者 | `createdById` | |

### タスク `Task`

| 日本語名 | カラム |
|---|---|
| オーダー | `orderId` |
| 種別 | `taskTypeId` |
| 内容 | `content` |
| 担当者 | `assigneeId` |
| 期限 | `dueDate` |
| ステータス | `status` |
| 完了日時 | `completedAt` |
| 依頼者（起票者） | `createdById` |

### やり取り `Message`

| 日本語名 | カラム | 備考 |
|---|---|---|
| オーダー | `orderId` | |
| 種別 | `kind` | |
| 本文 | `body` | 削除不可 |
| 相手先 | `counterpart` | 顧客とのやり取り記録のとき必須 |
| 手段 | `channel` | 同上 |
| 日時 | `occurredAt` | 同上 |
| 紐づく未確定項目 | `unresolvedItemId` | |
| 紐づくタスク | `taskId` | |
| 投稿者（記録者） | `authorId` | |
| 投稿日時 | `createdAt` | |
| メンションした人 | `mentions` | → `User`（多対多） |

### ステータス履歴 `StatusHistory`

| 日本語名 | カラム | 備考 |
|---|---|---|
| オーダー | `orderId` | |
| 変更前 | `fromStatus` | 発番時は NULL |
| 変更後 | `toStatus` | |
| 操作者 | `actorId` | 自動の変更（仕様確定など）は NULL |
| コメント | `comment` | 差戻し・取消の理由など |
| 日時 | `createdAt` | |

### 通知 `Notification` ／ 送信メール `OutboundEmail`

| 日本語名 | カラム |
|---|---|
| 宛先 | `Notification.userId` |
| 種類 | `Notification.type` |
| 対象（オーダー） | `Notification.orderId` |
| 件名・本文・リンク | `title`・`body`・`link` |
| 既読 | `readAt` |
| メール送信結果 | `emailResult`（→ `emailId`） |
| 宛先（メール） | `OutboundEmail.to` |
| 件名・本文 | `OutboundEmail.subject`・`body` |
| 送信方式 | `OutboundEmail.transport` |
| 結果 | `OutboundEmail.result`・`error` |
| 日時 | `OutboundEmail.createdAt` |

### AI実行記録 `AiRun`

| 日本語名 | カラム | 備考 |
|---|---|---|
| オーダー | `orderId` | |
| 実行者 | `createdById` | |
| 入力ファイル名 | `inputFiles` | JSON（名前・種類・サイズ・保存先） |
| 貼り付けテキストの文字数 | `inputTextChars` | 本文は保存しない |
| モデル名 | `model` | |
| リージョン | `location` | |
| 入力トークン数 | `promptTokens` | |
| 出力トークン数 | `outputTokens` | 思考トークンを含む |
| 出力JSON | `outputJson` | |
| 採用結果 | `adoption` | 項目ごとの候補・採用／修正／却下・最終値 |
| 採用日時 | `adoptedAt` | |
| 結果・エラー | `status`・`error` | |
| 処理時間（ミリ秒） | `durationMs` | |

### 監査ログ `AuditLog`

| 日本語名 | カラム | 備考 |
|---|---|---|
| 操作者 | `actorId` | |
| 操作 | `action` | 日本語名は `src/lib/audit.ts` の `auditActionLabel` |
| 対象 | `targetType`・`targetId`・`targetLabel` | |
| 変更前・変更後 | `before`・`after` | JSON |
| 日時 | `createdAt` | |
