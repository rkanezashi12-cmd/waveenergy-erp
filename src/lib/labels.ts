// 列挙型の日本語表示名（画面・CSV・通知で共通に使う）
import type {
  ConfirmTarget,
  ContactChannel,
  DeliveryType,
  DesignImpact,
  DocRequirement,
  DocState,
  EmailPreference,
  EmailResult,
  MailTransportType,
  MessageKind,
  NotificationType,
  OrderDocType,
  OrderStatus,
  ResetUnit,
  ResponsibleType,
  Role,
  SpecInputType,
  TaskDefaultAssignee,
  TaskStatus,
  UnresolvedStatus,
  UnresolvedTarget,
  ValueState,
  YearFormat,
} from "@/generated/prisma/enums";

export const roleLabel: Record<Role, string> = {
  SALES: "営業",
  SALES_MANAGER: "営業管理職",
  TECH_RECEPTION: "技術受付",
  TECH: "技術担当",
  VIEWER: "閲覧（関係部門）",
  ADMIN: "管理者",
};

export const orderStatusLabel: Record<OrderStatus, string> = {
  DRAFT: "下書き",
  ACCEPT_PENDING: "受入待ち",
  RETURNED: "差戻し",
  SPEC_PENDING: "仕様確定待ち",
  SPEC_FIXED: "仕様確定",
  COMPLETED: "完了",
  CANCELLED: "取消",
};

export const deliveryTypeLabel: Record<DeliveryType, string> = {
  FIXED: "確定",
  TENTATIVE: "仮",
};

export const orderDocTypeLabel: Record<OrderDocType, string> = {
  PURCHASE_ORDER: "注文書",
  LETTER_OF_INTENT: "内示書",
};

export const specInputTypeLabel: Record<SpecInputType, string> = {
  TEXT: "1行テキスト",
  TEXTAREA: "複数行テキスト",
  TEXTAREA_NONE: "複数行テキスト（「なし」選択可）",
  NUMBER: "数値",
  DATE: "日付",
  SELECT: "選択（1つ）",
  MULTISELECT: "選択（複数）",
};

export const valueStateLabel: Record<ValueState, string> = {
  FILLED: "入力済み",
  UNRESOLVED: "未確定",
  NOT_APPLICABLE: "該当なし",
};

export const docRequirementLabel: Record<DocRequirement, string> = {
  REQUIRED: "必須",
  CONDITIONAL: "条件付き",
  OPTIONAL: "任意",
};

export const docStateLabel: Record<DocState, string> = {
  ATTACHED: "添付済み",
  NOT_OBTAINED: "未入手",
  NOT_APPLICABLE: "該当なし",
};

export const unresolvedTargetLabel: Record<UnresolvedTarget, string> = {
  SPEC_FIELD: "要求仕様書の項目",
  DOCUMENT: "資料",
  DELIVERY: "納期",
  OTHER: "その他",
};

export const confirmTargetLabel: Record<ConfirmTarget, string> = {
  CUSTOMER: "顧客",
  INTERNAL: "社内",
};

export const responsibleTypeLabel: Record<ResponsibleType, string> = {
  SALES: "営業",
  TECH: "技術",
};

export const designImpactLabel: Record<DesignImpact, string> = {
  CAN_START: "着手可",
  PARTIAL_START: "一部着手可",
  CANNOT_START: "着手不可",
};

export const unresolvedStatusLabel: Record<UnresolvedStatus, string> = {
  OPEN: "未確定",
  CHECKING: "確認中",
  RESOLVED: "確定",
  WITHDRAWN: "取下げ",
};

export const taskStatusLabel: Record<TaskStatus, string> = {
  TODO: "未着手",
  IN_PROGRESS: "対応中",
  DONE: "完了",
};

export const taskDefaultAssigneeLabel: Record<TaskDefaultAssignee, string> = {
  SALES: "営業（オーダーの営業担当）",
  TECH: "技術（オーダーの技術担当）",
  NONE: "既定なし",
};

export const messageKindLabel: Record<MessageKind, string> = {
  INTERNAL: "社内連絡",
  CUSTOMER_RECORD: "顧客とのやり取り記録",
};

export const contactChannelLabel: Record<ContactChannel, string> = {
  PHONE: "電話",
  EMAIL: "メール",
  MEETING: "打合せ",
  OTHER: "その他",
};

export const notificationTypeLabel: Record<NotificationType, string> = {
  ORDER_ISSUED: "発令",
  ORDER_ACCEPTED: "受入",
  ORDER_RETURNED: "差戻し",
  TECH_ASSIGNED: "技術担当の割当",
  UNRESOLVED_ASSIGNED: "未確定項目の割当",
  TASK_ASSIGNED: "タスクの割当",
  UNRESOLVED_RESOLVED: "未確定項目の確定",
  DOCUMENT_VERSION: "資料の新しい版",
  SPEC_FIXED: "仕様確定",
  MENTION: "メンション",
  ACCEPT_REMINDER: "受入催促",
  DAILY_DIGEST: "毎朝のまとめ",
};

export const emailPreferenceLabel: Record<EmailPreference, string> = {
  ALL: "すべて受け取る",
  DIGEST_ONLY: "毎朝のまとめのみ",
  NONE: "受け取らない",
};

export const emailResultLabel: Record<EmailResult, string> = {
  NOT_REQUIRED: "メールなし",
  SAVED: "DB保存",
  SENT: "送信済み",
  FAILED: "送信失敗",
};

export const mailTransportLabel: Record<MailTransportType, string> = {
  DB: "DB保存（デモ）",
  SMTP: "SMTP",
  GRAPH: "Microsoft Graph",
};

export const yearFormatLabel: Record<YearFormat, string> = {
  YYYY: "西暦4桁（2026）",
  YY: "西暦下2桁（26）",
  NONE: "年を含めない",
};

export const resetUnitLabel: Record<ResetUnit, string> = {
  NONE: "リセットしない",
  YEAR: "暦年でリセット",
  FISCAL_YEAR: "年度でリセット",
};
