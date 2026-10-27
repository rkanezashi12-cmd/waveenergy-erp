// オーダーの業務ルール（DBアクセスなし。単体テストの対象）
import type {
  DeliveryType,
  DocRequirement,
  DocState,
  OrderDocType,
  OrderStatus,
  SpecInputType,
  UnresolvedStatus,
  ValueState,
} from "@/generated/prisma/enums";
import { addMonths } from "@/lib/dates";

/** 未確定として数える状態（確定・取下げ以外） */
export const OPEN_UNRESOLVED: UnresolvedStatus[] = ["OPEN", "CHECKING"];
export const isOpenUnresolved = (s: UnresolvedStatus) => OPEN_UNRESOLVED.includes(s);

/** 短納期か：契約納期が「基準日＋標準納期（月）」より前なら短納期 */
export function isShortLeadTime(
  contractDeliveryDate: Date | null | undefined,
  standardLeadTimeMonths: number | null | undefined,
  baseDate: Date,
): boolean {
  if (!contractDeliveryDate || !standardLeadTimeMonths) return false;
  return contractDeliveryDate.getTime() < addMonths(baseDate, standardLeadTimeMonths).getTime();
}

/** 発令チェックの指摘 */
export type IssueProblem = {
  /** 作成手順の何番で直すか（1:基本情報 3:要求仕様書 4:資料 5:未確定項目） */
  step: 1 | 3 | 4 | 5;
  /** 対象（項目名など） */
  target: string;
  message: string;
};

export type IssueCheckInput = {
  order: {
    productCategoryId: string | null;
    customerId: string | null;
    siteName: string | null;
    endUser: string | null;
    title: string | null;
    quantity: string | number | null;
    salesUserId: string | null;
    salesDepartmentId: string | null;
    contractDeliveryDate: Date | null;
    deliveryType: DeliveryType | null;
    deliveryFixDueDate: Date | null;
    shortLeadTime: boolean;
    shortLeadConsulted: boolean | null;
    orderDocType: OrderDocType | null;
  };
  hasOpenDeliveryItem: boolean;
  specFields: {
    templateId: string;
    label: string;
    required: boolean;
    inputType: SpecInputType;
    value: { value: string | null; state: ValueState | null; naReason: string | null } | null;
    hasOpenUnresolved: boolean;
  }[];
  documents: {
    templateId: string;
    name: string;
    requirement: DocRequirement;
    state: DocState | null;
    naReason: string | null;
    hasLatestVersion: boolean;
    hasOpenUnresolved: boolean;
  }[];
};

export type IssueCheckResult = {
  problems: IssueProblem[];
  warnings: string[];
};

const blank = (v: string | null | undefined) => !v || !v.trim();

/** 発令できるかを判定する（SPEC §4.2・§4.3・§11-2） */
export function checkIssuable(input: IssueCheckInput): IssueCheckResult {
  const problems: IssueProblem[] = [];
  const warnings: string[] = [];
  const o = input.order;
  const basic = (target: string, message = `${target}を入力してください。`) =>
    problems.push({ step: 1, target, message });

  if (!o.productCategoryId) basic("製品区分", "製品区分を選択してください。");
  if (!o.customerId) basic("顧客名");
  if (blank(o.siteName) && blank(o.endUser)) basic("現場名・エンドユーザー", "現場名またはエンドユーザーを入力してください。");
  if (blank(o.title)) basic("件名");
  if (o.quantity === null || o.quantity === "" || Number(o.quantity) <= 0)
    basic("数量", "数量（面数・台数）を1以上で入力してください。");
  if (!o.salesUserId) basic("営業担当", "営業担当を選択してください。");
  if (!o.salesDepartmentId) basic("営業部署", "営業部署を選択してください。");
  if (!o.contractDeliveryDate) basic("契約納期");
  if (!o.deliveryType) basic("納期区分", "納期区分（確定／仮）を選択してください。");
  if (o.deliveryType === "TENTATIVE") {
    if (!o.deliveryFixDueDate) basic("確定予定日", "納期区分が「仮」のときは確定予定日を入力してください。");
    else if (!input.hasOpenDeliveryItem)
      problems.push({ step: 5, target: "納期", message: "納期の未確定項目がありません。基本情報を保存し直してください。" });
  }
  if (o.shortLeadTime && o.shortLeadConsulted === null)
    basic("事前協議", "短納期のため、関係部門と事前協議済みかを選択してください。");
  if (o.shortLeadTime && o.shortLeadConsulted === false)
    warnings.push("短納期ですが、関係部門との事前協議が「未協議」です。");
  if (!o.orderDocType) basic("注文書／内示書", "注文書で発令するか内示書で発令するかを選択してください。");
  if (o.orderDocType === "LETTER_OF_INTENT")
    warnings.push("内示書で発令します。キャンセル時に在庫が残るおそれがあります。注文書の入手予定を確認してください。");

  for (const f of input.specFields) {
    const v = f.value;
    const state = v?.state ?? null;
    if (!state) {
      if (f.required)
        problems.push({ step: 3, target: f.label, message: `「${f.label}」が空欄です。入力するか、未確定または該当なしにしてください。` });
      continue;
    }
    if (state === "FILLED" && blank(v?.value)) {
      problems.push({ step: 3, target: f.label, message: `「${f.label}」の値が空です。` });
    }
    if (state === "NOT_APPLICABLE" && blank(v?.naReason)) {
      problems.push({ step: 3, target: f.label, message: `「${f.label}」を該当なしにする理由を入力してください。` });
    }
    if (state === "UNRESOLVED" && !f.hasOpenUnresolved) {
      problems.push({ step: 3, target: f.label, message: `「${f.label}」は未確定ですが、未確定項目（担当者・期限）が登録されていません。` });
    }
  }

  for (const d of input.documents) {
    if (!d.state) {
      if (d.requirement !== "OPTIONAL")
        problems.push({
          step: 4,
          target: d.name,
          message: `資料「${d.name}」（${d.requirement === "REQUIRED" ? "必須" : "条件付き"}）の状態を選んでください（添付済み／未入手／該当なし）。`,
        });
      continue;
    }
    if (d.state === "ATTACHED" && !d.hasLatestVersion)
      problems.push({ step: 4, target: d.name, message: `資料「${d.name}」のURL・版数・日付を入力してください。` });
    if (d.state === "NOT_APPLICABLE" && blank(d.naReason))
      problems.push({ step: 4, target: d.name, message: `資料「${d.name}」を該当なしにする理由を入力してください。` });
    if (d.state === "NOT_APPLICABLE" && d.requirement === "REQUIRED")
      warnings.push(`必須資料「${d.name}」が該当なしになっています。`);
    if (d.state === "NOT_OBTAINED" && !d.hasOpenUnresolved)
      problems.push({ step: 4, target: d.name, message: `資料「${d.name}」は未入手ですが、未確定項目（担当者・期限）が登録されていません。` });
  }

  return { problems, warnings };
}

/** URL またはファイルサーバーのパスとして受け付けるか（SPEC §4.3） */
export function isValidDocumentLocation(s: string): boolean {
  const v = s.trim();
  if (/^https:\/\/[^\s]+$/i.test(v)) return true;
  if (/^\\\\[^\\\s][^\\]*\\.+/.test(v)) return true;
  return false;
}

/** 版数の比較。数値として比べられれば数値で、そうでなければ文字列で比べる */
export function compareVersion(a: string, b: string): number {
  const na = a.trim().replace(/^(rev\.?|ver\.?|v|第)/i, "").replace(/版$/, "");
  const nb = b.trim().replace(/^(rev\.?|ver\.?|v|第)/i, "").replace(/版$/, "");
  const pa = na.split(/[.\-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : NaN));
  const pb = nb.split(/[.\-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : NaN));
  if (pa.every((x) => !Number.isNaN(x)) && pb.every((x) => !Number.isNaN(x))) {
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  }
  return na.localeCompare(nb, "ja", { numeric: true });
}

/** 新しい版の登録時の警告（版数・日付が前の版と同じ、または古い） */
export function versionWarnings(
  prev: { version: string; docDate: Date } | null,
  next: { version: string; docDate: Date },
): string[] {
  if (!prev) return [];
  const w: string[] = [];
  const vc = compareVersion(next.version, prev.version);
  if (vc === 0) w.push(`版数が前の版（${prev.version}）と同じです。`);
  else if (vc < 0) w.push(`版数が前の版（${prev.version}）より古くなっています。`);
  const dc = next.docDate.getTime() - prev.docDate.getTime();
  if (dc === 0) w.push("日付が前の版と同じです。");
  else if (dc < 0) w.push("日付が前の版より古くなっています。");
  return w;
}

/** ステータスの遷移が仕様上許されるか（SPEC §3.1） */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ["ACCEPT_PENDING", "CANCELLED"],
  ACCEPT_PENDING: ["SPEC_PENDING", "SPEC_FIXED", "RETURNED"],
  RETURNED: ["ACCEPT_PENDING", "CANCELLED"],
  SPEC_PENDING: ["SPEC_FIXED"],
  SPEC_FIXED: ["SPEC_PENDING", "COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus) {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** メンション（@名前）の抽出。名前の空白は無視して照合する */
export function extractMentions<T extends { id: string; name: string }>(body: string, users: T[]): T[] {
  const compact = (s: string) => s.replace(/[\s　]+/g, "");
  const tokens = [...body.matchAll(/[@＠]([^\s　@＠、。,.:：;；!?！？()（）「」]+)/g)].map((m) => compact(m[1]));
  if (!tokens.length) return [];
  // 長い名前から照合する（「山田太郎」と「山田」がいる場合など）
  const sorted = [...users].sort((a, b) => compact(b.name).length - compact(a.name).length);
  const found = new Map<string, T>();
  for (const t of tokens) {
    const u = sorted.find((u) => t.startsWith(compact(u.name)));
    if (u) found.set(u.id, u);
  }
  return [...found.values()];
}
