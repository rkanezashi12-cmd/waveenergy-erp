// 監査ログの変更前／変更後（JSON）の表示
import type { ReactNode } from "react";
import {
  confirmTargetLabel,
  designImpactLabel,
  docRequirementLabel,
  docStateLabel,
  emailPreferenceLabel,
  orderStatusLabel,
  resetUnitLabel,
  responsibleTypeLabel,
  roleLabel,
  specInputTypeLabel,
  taskDefaultAssigneeLabel,
  unresolvedStatusLabel,
  valueStateLabel,
  yearFormatLabel,
} from "@/lib/labels";

/** 監査ログの対象の種類の日本語表示 */
export const targetTypeLabel: Record<string, string> = {
  User: "ユーザー",
  Department: "部署",
  Customer: "顧客",
  ProductCategory: "製品区分",
  SpecFieldTemplate: "要求仕様書テンプレート",
  DocumentTemplate: "資料テンプレート",
  TaskType: "タスク種別",
  NotificationGroup: "通知グループ",
  NumberingRule: "採番ルール",
  SystemSetting: "システム設定",
  Order: "オーダー",
  UnresolvedItem: "未確定項目",
  Task: "タスク",
};

/** 項目名の日本語表示（無いものは英語のまま出す） */
const fieldLabel: Record<string, string> = {
  name: "名前",
  email: "メールアドレス",
  departmentId: "部署",
  roles: "ロール",
  active: "有効",
  emailPreference: "メール通知",
  mustChangePassword: "パスワード変更が必要",
  parentId: "上位部署",
  sortOrder: "並び順",
  note: "備考",
  code: "コード",
  standardLeadTimeMonths: "標準納期（月数）",
  receptionUsers: "技術受付の通知先",
  notificationGroups: "通知グループ",
  label: "項目名",
  inputType: "入力形式",
  required: "必須",
  options: "選択肢",
  description: "説明",
  defaultResponsibleType: "確認担当区分の既定値",
  productCategoryId: "製品区分",
  requirement: "必須区分",
  defaultAssignee: "既定担当",
  users: "メンバー（個人）",
  departments: "メンバー（部署）",
  prefix: "接頭辞",
  yearFormat: "年の表記",
  separator: "区切り文字",
  digits: "連番の桁数",
  resetUnit: "リセット単位",
  fiscalYearStartMonth: "年度の開始月",
  aiEnabled: "AI下書き",
  acceptReminderBusinessDays: "受入催促までの営業日数",
  digestDueSoonDays: "期限が近いとみなす日数",
  orderNumber: "オーダー番号",
  techUserId: "技術担当",
  salesUserId: "営業担当",
  salesDepartmentId: "営業部署",
  assigneeId: "担当者",
  status: "ステータス",
  state: "状態",
  value: "値",
  naReason: "該当なしの理由",
  url: "URL",
  version: "版数",
  docDate: "日付",
  dueDate: "期限",
  title: "件名",
};

/** 値を日本語の表示名に置き換える項目 */
const enumLabels: Record<string, Record<string, string>> = {
  roles: roleLabel,
  emailPreference: emailPreferenceLabel,
  inputType: specInputTypeLabel,
  requirement: docRequirementLabel,
  defaultResponsibleType: responsibleTypeLabel,
  responsibleType: responsibleTypeLabel,
  defaultAssignee: taskDefaultAssigneeLabel,
  yearFormat: yearFormatLabel,
  resetUnit: resetUnitLabel,
  confirmTarget: confirmTargetLabel,
  designImpact: designImpactLabel,
};
const statusLabels: Record<string, string> = { ...orderStatusLabel };

/** ID を名前に置き換える項目 */
const idKind: Record<string, "user" | "department" | "category"> = {
  departmentId: "department",
  parentId: "department",
  salesDepartmentId: "department",
  techUserId: "user",
  salesUserId: "user",
  assigneeId: "user",
  productCategoryId: "category",
};

export type NameMaps = { user: Map<string, string>; department: Map<string, string>; category: Map<string, string> };

/** 表示に必要な ID（ユーザー・部署・製品区分）を集める */
export function collectIds(values: unknown[]) {
  const ids = { user: new Set<string>(), department: new Set<string>(), category: new Set<string>() };
  for (const v of values) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    for (const [k, val] of Object.entries(v)) {
      const kind = idKind[k];
      if (kind && typeof val === "string") ids[kind].add(val);
    }
  }
  return ids;
}

function formatValue(key: string, v: unknown, names: NameMaps): string {
  if (v === null || v === undefined || v === "") return "（なし）";
  if (typeof v === "boolean") return v ? "はい" : "いいえ";
  const kind = idKind[key];
  if (kind && typeof v === "string") return names[kind].get(v) ?? v;
  const map = enumLabels[key] ?? (key === "status" || key === "fromStatus" || key === "toStatus" ? statusLabels : undefined);
  if (key === "state" && typeof v === "string")
    return (
      valueStateLabel[v as keyof typeof valueStateLabel] ??
      docStateLabel[v as keyof typeof docStateLabel] ??
      unresolvedStatusLabel[v as keyof typeof unresolvedStatusLabel] ??
      v
    );
  if (Array.isArray(v))
    return v.length ? v.map((x) => (typeof x === "string" && map ? (map[x] ?? x) : typeof x === "string" ? x : JSON.stringify(x))).join("、") : "（なし）";
  if (typeof v === "string") return map ? (map[v] ?? v) : v;
  if (typeof v === "number") return String(v);
  return JSON.stringify(v);
}

/** 変更前／変更後の JSON を「項目：値」の行で表示する。長いものは折りたたむ */
export function JsonView({ value, names }: { value: unknown; names: NameMaps }): ReactNode {
  if (value === null || value === undefined) return <span className="text-slate-400">―</span>;
  if (typeof value !== "object" || Array.isArray(value)) return <span className="break-all">{formatValue("", value, names)}</span>;
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return <span className="text-slate-400">―</span>;
  const rows = entries.map(([k, v]) => ({ k, label: fieldLabel[k] ?? k, text: formatValue(k, v, names) }));
  const list = (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-xs">
      {rows.map((r) => (
        <div key={r.k} className="contents">
          <dt className="whitespace-nowrap text-slate-500">{r.label}：</dt>
          <dd className="max-w-[22rem] break-all whitespace-pre-wrap">{r.text}</dd>
        </div>
      ))}
    </dl>
  );
  const long = rows.length > 4 || rows.reduce((n, r) => n + r.text.length, 0) > 160;
  if (!long) return list;
  return (
    <details>
      <summary className="cursor-pointer text-xs text-brand-700">
        {rows
          .slice(0, 2)
          .map((r) => r.label)
          .join("・")}
        {rows.length > 2 ? ` ほか（${rows.length}項目）` : ""}
      </summary>
      <div className="mt-1">{list}</div>
    </details>
  );
}
