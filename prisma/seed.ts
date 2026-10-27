// シードデータ（デモ用。顧客名・案件名はすべて架空。SPEC §10.2）
//   npx prisma db seed
// 環境変数
//   SEED_DEMO_PASSWORD        デモユーザーの初期パスワード（既定：Demo1234!）
//   SEED_MUST_CHANGE_PASSWORD 初回ログイン時のパスワード変更を求めるか（既定：true）
//   SEED_DEMO_USERS           デモユーザー（@example.com）を作るか（既定：true。本番では false）
//   SEED_SAMPLE_ORDERS        サンプルオーダーを作るか（既定：true。デモユーザーが無いときは作らない）
import "dotenv/config";
import bcrypt from "bcryptjs";
import type {
  DocRequirement,
  ResponsibleType,
  Role,
  SpecInputType,
  TaskDefaultAssignee,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { addDays, today } from "@/lib/dates";
import type { Actor } from "@/lib/permissions";
import {
  acceptOrder,
  addDocumentVersion,
  cancelOrder,
  completeOrder,
  createOrder,
  issueOrder,
  returnOrder,
  saveDocuments,
  saveSpecValues,
  type BasicInput,
  type DocumentEntry,
  type SpecEntry,
} from "@/lib/orders/service";
import { createOtherUnresolved, resolveUnresolved } from "@/lib/orders/unresolved";
import { createTask, updateTask } from "@/lib/orders/tasks";
import { postMessage } from "@/lib/orders/messages";
import type { UnresolvedInput } from "@/lib/orders/unresolved";

const bool = (v: string | undefined, d: boolean) => (v === undefined ? d : v === "true" || v === "1");

// ───────────── マスタ ─────────────

const DEPARTMENTS: { name: string; parent?: string }[] = [
  { name: "営業本部" },
  { name: "営業一部", parent: "営業本部" },
  { name: "営業二部", parent: "営業本部" },
  { name: "営業三部", parent: "営業本部" },
  { name: "技術部 技術課" },
  { name: "技術部 設計課" },
  { name: "技術部 大日程管理室" },
  { name: "製造部 工作一課" },
  { name: "製造部 工作二課" },
  { name: "製造部 資材管理課" },
  { name: "製造部 購買課" },
  { name: "品質管理課" },
  { name: "システム管理" },
];

const USERS: { key: string; name: string; email: string; dept: string; roles: Role[] }[] = [
  { key: "sales1", name: "青木 健太", email: "sales1@example.com", dept: "営業一部", roles: ["SALES"] },
  { key: "sales2", name: "井上 美咲", email: "sales2@example.com", dept: "営業二部", roles: ["SALES"] },
  { key: "manager", name: "上田 誠", email: "manager@example.com", dept: "営業本部", roles: ["SALES", "SALES_MANAGER"] },
  { key: "reception", name: "江藤 修", email: "reception@example.com", dept: "技術部 技術課", roles: ["TECH_RECEPTION"] },
  { key: "tech1", name: "大野 翔", email: "tech1@example.com", dept: "技術部 技術課", roles: ["TECH"] },
  { key: "tech2", name: "加藤 由美", email: "tech2@example.com", dept: "技術部 技術課", roles: ["TECH"] },
  { key: "design", name: "木村 拓也", email: "design@example.com", dept: "技術部 設計課", roles: ["VIEWER"] },
  { key: "factory", name: "工藤 大輔", email: "factory@example.com", dept: "製造部 工作一課", roles: ["VIEWER"] },
  { key: "purchase", name: "小林 恵", email: "purchase@example.com", dept: "製造部 購買課", roles: ["VIEWER"] },
  { key: "admin", name: "佐々木 理沙", email: "admin@example.com", dept: "システム管理", roles: ["ADMIN"] },
];

const CATEGORIES = [
  { code: "SOLAR", name: "太陽光（SPEC-M）", months: 4, sort: 1 },
  { code: "SWITCHGEAR", name: "受配電盤", months: 6, sort: 2 },
  { code: "RETROFIT", name: "改造", months: 3, sort: 3 },
  { code: "OTHER", name: "その他", months: null, sort: 4 },
];

type SpecDef = {
  label: string;
  inputType: SpecInputType;
  required: boolean;
  options?: string[];
  description?: string;
  responsible?: ResponsibleType;
};

// 共通項目（基本情報で入力する顧客名〜注文書／内示書を除く）【船井案】
const COMMON_SPECS: SpecDef[] = [
  { label: "標準仕様からの変更点", inputType: "TEXTAREA_NONE", required: true, description: "当社標準仕様から変更する点を具体的に書く。変更が無い場合も「なし」を選ぶ。" },
  { label: "見積の前提", inputType: "TEXTAREA", required: true, description: "主要機器のメーカー・グレード、見積原価の前提。見積書の該当箇所（ページ・行）でも可。" },
  { label: "立会試験の有無・予定", inputType: "TEXTAREA", required: true, description: "有／無と予定時期。未定なら未確定にする。" },
  { label: "出荷先・搬入条件", inputType: "TEXTAREA", required: false },
  { label: "顧客側の窓口（技術・購買）", inputType: "TEXTAREA", required: false, description: "氏名・連絡先" },
  { label: "特記事項", inputType: "TEXTAREA", required: false },
];

// 製品区分別項目【船井案】
const CATEGORY_SPECS: Record<string, SpecDef[]> = {
  SOLAR: [
    {
      label: "SPEC-Mオプション選択内容",
      inputType: "MULTISELECT",
      required: true,
      options: ["オプションA（仮）", "オプションB（仮）", "オプションC（仮）", "オプションD（仮）"],
      description: "【要確認】オプション一覧は仮登録。最新のオプション表に合わせて管理画面で更新する。",
    },
    { label: "主要機器（パワコン等）のメーカー・型式", inputType: "TEXTAREA", required: true, responsible: "TECH" },
  ],
  SWITCHGEAR: [
    { label: "盤の設置場所", inputType: "SELECT", required: true, options: ["屋内", "屋外"] },
    { label: "材質・板厚・塗装色", inputType: "TEXT", required: true, responsible: "TECH" },
    { label: "主要機器の顧客指定の有無とメーカー・グレード", inputType: "TEXTAREA", required: true },
  ],
  RETROFIT: [
    { label: "現地調査の有無", inputType: "SELECT", required: true, options: ["実施済み", "実施予定", "実施しない"] },
    { label: "停電可能日", inputType: "TEXT", required: true },
    { label: "入構申請の要否", inputType: "SELECT", required: true, options: ["要", "不要"] },
    { label: "現地作業の日数・人数の見込み", inputType: "TEXT", required: true },
    { label: "工作・品管と協議済みか", inputType: "SELECT", required: true, options: ["協議済み", "未協議"], description: "現地作業の日数・人数を工作・品管と協議したか（SPEC §2.3）" },
  ],
  OTHER: [],
};

type DocDef = { name: string; req: Partial<Record<string, DocRequirement>>; description?: string; responsible?: ResponsibleType };

// 必要資料【船井案】
const DOCS: DocDef[] = [
  { name: "見積書（内訳・前提機器がわかるもの）", req: { SOLAR: "REQUIRED", SWITCHGEAR: "REQUIRED", RETROFIT: "REQUIRED", OTHER: "REQUIRED" } },
  { name: "顧客仕様書・設計図書", req: { SOLAR: "CONDITIONAL", SWITCHGEAR: "REQUIRED", RETROFIT: "CONDITIONAL", OTHER: "CONDITIONAL" } },
  { name: "単線結線図", req: { SOLAR: "REQUIRED", SWITCHGEAR: "REQUIRED", RETROFIT: "CONDITIONAL" }, responsible: "TECH" },
  { name: "配列図（盤面配置）", req: { SOLAR: "OPTIONAL", SWITCHGEAR: "REQUIRED", RETROFIT: "CONDITIONAL" }, responsible: "TECH" },
  { name: "機器外形図", req: { SOLAR: "OPTIONAL", SWITCHGEAR: "CONDITIONAL", RETROFIT: "CONDITIONAL" }, responsible: "TECH" },
  { name: "SPEC-Mオプション表", req: { SOLAR: "REQUIRED" } },
  { name: "既設図面", req: { RETROFIT: "REQUIRED" } },
  { name: "現地写真", req: { RETROFIT: "REQUIRED" } },
  { name: "注文書（または内示書）", req: { SOLAR: "REQUIRED", SWITCHGEAR: "REQUIRED", RETROFIT: "REQUIRED", OTHER: "REQUIRED" }, description: "内示書で発令する場合は基本情報で「内示書」を選ぶ。" },
];

const TASK_TYPES: { name: string; def: TaskDefaultAssignee; description?: string }[] = [
  { name: "入構申請", def: "SALES" },
  { name: "日程調整", def: "SALES" },
  { name: "装備品確認", def: "SALES" },
  { name: "納入図の承認催促", def: "SALES", description: "技術担当が営業に依頼する" },
  { name: "現地作業の協議", def: "NONE", description: "営業が起票し、工作・品管が回答する" },
  { name: "その他", def: "NONE" },
];

const CUSTOMERS = [
  "あおぞらソーラー株式会社（架空）",
  "ひかり太陽光発電合同会社（架空）",
  "東西エネルギー開発株式会社（架空）",
  "みなと化成工業株式会社（架空）",
  "さくら台市 水道部（架空）",
  "北斗精機株式会社（架空）",
];

async function seedMasters() {
  const deptIds = new Map<string, string>();
  for (const [i, d] of DEPARTMENTS.entries()) {
    const rec = await prisma.department.upsert({
      where: { name: d.name },
      create: { name: d.name, sortOrder: (i + 1) * 10, parentId: d.parent ? deptIds.get(d.parent) : null },
      update: {},
    });
    deptIds.set(d.name, rec.id);
  }

  const password = process.env.SEED_DEMO_PASSWORD || "Demo1234!";
  const mustChange = bool(process.env.SEED_MUST_CHANGE_PASSWORD, true);
  const hash = await bcrypt.hash(password, 10);
  const users = new Map<string, { id: string; roles: Role[]; departmentId: string | null }>();
  const demoUsers = bool(process.env.SEED_DEMO_USERS, true);
  for (const u of demoUsers ? USERS : []) {
    const rec = await prisma.user.upsert({
      where: { email: u.email },
      create: {
        name: u.name,
        email: u.email,
        roles: u.roles,
        departmentId: deptIds.get(u.dept),
        passwordHash: hash,
        mustChangePassword: mustChange,
      },
      update: {},
    });
    users.set(u.key, { id: rec.id, roles: rec.roles, departmentId: rec.departmentId });
  }

  const groups = new Map<string, string>();
  for (const g of [
    { name: "設計・大日程", depts: ["技術部 設計課", "技術部 大日程管理室"] },
    { name: "製造部", depts: ["製造部 工作一課", "製造部 工作二課", "製造部 資材管理課", "製造部 購買課"] },
    { name: "品質管理", depts: ["品質管理課"] },
  ]) {
    const rec = await prisma.notificationGroup.upsert({
      where: { name: g.name },
      create: { name: g.name, departments: { connect: g.depts.map((n) => ({ id: deptIds.get(n)! })) } },
      update: {},
    });
    groups.set(g.name, rec.id);
  }
  const categoryGroups: Record<string, string[]> = {
    SOLAR: ["設計・大日程", "製造部"],
    SWITCHGEAR: ["設計・大日程", "製造部", "品質管理"],
    RETROFIT: ["製造部", "品質管理"],
    OTHER: ["設計・大日程"],
  };

  const categories = new Map<string, string>();
  for (const c of CATEGORIES) {
    const existing = await prisma.productCategory.findUnique({ where: { code: c.code } });
    const rec =
      existing ??
      (await prisma.productCategory.create({
        data: {
          code: c.code,
          name: c.name,
          standardLeadTimeMonths: c.months,
          sortOrder: c.sort,
          // デモユーザーが無いときは未設定（技術受付ロールの全員に通知される）
          receptionUsers: users.has("reception") ? { connect: [{ id: users.get("reception")!.id }] } : undefined,
          notificationGroups: { connect: categoryGroups[c.code].map((n) => ({ id: groups.get(n)! })) },
        },
      }));
    categories.set(c.code, rec.id);
  }

  if ((await prisma.specFieldTemplate.count()) === 0) {
    for (const [i, s] of COMMON_SPECS.entries()) {
      await prisma.specFieldTemplate.create({
        data: {
          label: s.label,
          inputType: s.inputType,
          required: s.required,
          options: s.options ?? [],
          description: s.description,
          defaultResponsibleType: s.responsible ?? "SALES",
          sortOrder: (i + 1) * 10,
        },
      });
    }
    for (const [code, specs] of Object.entries(CATEGORY_SPECS)) {
      for (const [i, s] of specs.entries()) {
        await prisma.specFieldTemplate.create({
          data: {
            productCategoryId: categories.get(code),
            label: s.label,
            inputType: s.inputType,
            required: s.required,
            options: s.options ?? [],
            description: s.description,
            defaultResponsibleType: s.responsible ?? "SALES",
            sortOrder: (i + 1) * 10,
          },
        });
      }
    }
  }

  if ((await prisma.documentTemplate.count()) === 0) {
    for (const c of CATEGORIES) {
      let sort = 10;
      for (const d of DOCS) {
        const req = d.req[c.code];
        if (!req) continue;
        await prisma.documentTemplate.create({
          data: {
            productCategoryId: categories.get(c.code)!,
            name: d.name,
            requirement: req,
            description: d.description,
            defaultResponsibleType: d.responsible ?? "SALES",
            sortOrder: sort,
          },
        });
        sort += 10;
      }
    }
  }

  for (const [i, t] of TASK_TYPES.entries()) {
    await prisma.taskType.upsert({
      where: { name: t.name },
      create: { name: t.name, defaultAssignee: t.def, description: t.description, sortOrder: (i + 1) * 10 },
      update: {},
    });
  }

  for (const name of CUSTOMERS) await prisma.customer.upsert({ where: { name }, create: { name }, update: {} });

  await prisma.numberingRule.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} });
  await prisma.systemSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} });

  return { users, categories, deptIds };
}

// ───────────── サンプルオーダー ─────────────

type Ctx = Awaited<ReturnType<typeof seedMasters>>;

const daysFromToday = (n: number) => addDays(today(), n);

/** 製品区分の項目すべてに値を入れる */
async function fullSpec(categoryId: string, overrides: Record<string, Partial<SpecEntry>> = {}): Promise<SpecEntry[]> {
  const templates = await prisma.specFieldTemplate.findMany({
    where: { active: true, OR: [{ productCategoryId: null }, { productCategoryId: categoryId }] },
  });
  const sample: Record<string, string> = {
    "標準仕様からの変更点": "なし",
    "見積の前提": "見積書 2ページ目の主要機器一覧のとおり（メーカー指定なし、標準グレード）",
    "立会試験の有無・予定": "有。出荷前に工場立会（日程は別途調整）",
    "出荷先・搬入条件": "現地まで車上渡し。4t車で進入可",
    "顧客側の窓口（技術・購買）": "技術：設備課 担当者（架空）／購買：資材部 担当者（架空）",
    "特記事項": "",
    "SPEC-Mオプション選択内容": JSON.stringify(["オプションA（仮）", "オプションC（仮）"]),
    "主要機器（パワコン等）のメーカー・型式": "パワコン：メーカーX（架空） 型式 PC-500（架空）×2台",
    "盤の設置場所": "屋外",
    "材質・板厚・塗装色": "SS400 t2.3、マンセル 5Y7/1",
    "主要機器の顧客指定の有無とメーカー・グレード": "顧客指定あり：遮断器はメーカーY（架空）の標準品",
    "現地調査の有無": "実施済み",
    "停電可能日": "2027年1月の土日（顧客と調整中）",
    "入構申請の要否": "要",
    "現地作業の日数・人数の見込み": "2日間・4名",
    "工作・品管と協議済みか": "協議済み",
  };
  return templates.map((t) => {
    const value = sample[t.label] ?? "";
    return {
      templateId: t.id,
      state: value ? "FILLED" : null,
      value: value || null,
      naReason: null,
      ...overrides[t.label],
    } as SpecEntry;
  });
}

async function fullDocs(categoryId: string, orderNumberHint: string, overrides: Record<string, Partial<DocumentEntry>> = {}): Promise<DocumentEntry[]> {
  const templates = await prisma.documentTemplate.findMany({ where: { productCategoryId: categoryId, active: true } });
  return templates.map((t, i) => {
    const base: DocumentEntry =
      t.requirement === "OPTIONAL"
        ? { templateId: t.id, state: null, url: null, version: null, docDate: null, naReason: null }
        : {
            templateId: t.id,
            state: "ATTACHED",
            url: `https://example.sharepoint.com/sites/demo/${orderNumberHint}/doc${i + 1}.pdf`,
            version: "1",
            docDate: daysFromToday(-30),
            naReason: null,
          };
    const key = Object.keys(overrides).find((k) => t.name.startsWith(k));
    return { ...base, ...(key ? overrides[key] : {}) };
  });
}

function unresolved(assigneeId: string, dueInDays: number, extra: Partial<UnresolvedInput> = {}): UnresolvedInput {
  return {
    knownInfo: null,
    confirmTarget: "CUSTOMER",
    responsibleType: "SALES",
    assigneeId,
    dueDate: daysFromToday(dueInDays),
    designImpact: "PARTIAL_START",
    ...extra,
  };
}

async function backdate(orderId: string, days: { issued?: number; accepted?: number; fixed?: number; created?: number }) {
  const ago = (n: number) => new Date(Date.now() - n * 86_400_000);
  const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  await prisma.order.update({
    where: { id: orderId },
    data: {
      createdAt: days.created !== undefined ? ago(days.created) : undefined,
      issuedAt: days.issued !== undefined && o.issuedAt ? ago(days.issued) : undefined,
      firstIssuedAt: days.issued !== undefined && o.firstIssuedAt ? ago(days.issued) : undefined,
      acceptedAt: days.accepted !== undefined && o.acceptedAt ? ago(days.accepted) : undefined,
      specFixedAt: days.fixed !== undefined && o.specFixedAt ? ago(days.fixed) : undefined,
    },
  });
  const map: Record<string, number | undefined> = {
    DRAFT: days.created,
    ACCEPT_PENDING: days.issued,
    RETURNED: days.issued !== undefined ? days.issued - 1 : undefined,
    SPEC_PENDING: days.accepted,
    SPEC_FIXED: days.fixed ?? days.accepted,
  };
  const hist = await prisma.statusHistory.findMany({ where: { orderId } });
  for (const h of hist) {
    const n = map[h.toStatus];
    if (n !== undefined) await prisma.statusHistory.update({ where: { id: h.id }, data: { createdAt: ago(n) } });
  }
  if (days.created !== undefined)
    await prisma.unresolvedItem.updateMany({ where: { orderId }, data: { createdAt: ago(days.created) } });
}

async function seedOrders(ctx: Ctx) {
  if ((await prisma.order.count()) > 0) {
    console.log("オーダーが既にあるため、サンプルオーダーは作成しません。");
    return;
  }
  const U = (k: string) => ctx.users.get(k)! as Actor;
  const sales1 = U("sales1");
  const sales2 = U("sales2");
  const reception = U("reception");
  const tech1 = U("tech1");
  const tech2 = U("tech2");
  const cat = (c: string) => ctx.categories.get(c)!;
  const customers = await prisma.customer.findMany({ orderBy: { name: "asc" } });
  const cus = (i: number) => customers[i % customers.length].id;

  const basic = (o: Partial<BasicInput> & { productCategoryId: string; salesUserId: string; salesDepartmentId: string | null }): BasicInput => ({
    customerId: null,
    newCustomerName: null,
    siteName: null,
    endUser: null,
    title: null,
    quantity: "1",
    quantityUnit: "面",
    contractDeliveryDate: daysFromToday(240),
    deliveryType: "FIXED",
    deliveryFixDueDate: null,
    shortLeadConsulted: null,
    shortLeadNote: null,
    orderDocType: "PURCHASE_ORDER",
    quoteNumber: null,
    inquiryNumber: null,
    ...o,
  });

  // 1. 太陽光：下書き（作成途中）
  {
    const o = await createOrder(sales1, basic({ productCategoryId: cat("SOLAR"), salesUserId: sales1.id, salesDepartmentId: sales1.departmentId, customerId: cus(0), siteName: "あおぞら第3発電所（架空）", title: "SPEC-M 集電盤 一式", quantity: "3", quoteNumber: "Q-2026-0451" }));
    await saveSpecValues(sales1, o.id, (await fullSpec(cat("SOLAR"))).filter((e) => e.state && !e.value?.includes("工場立会")));
    await backdate(o.id, { created: 1 });
  }

  // 2. 太陽光：受入待ち（発令から3営業日以上。受入催促の対象）、未確定2件
  {
    const o = await createOrder(sales1, basic({ productCategoryId: cat("SOLAR"), salesUserId: sales1.id, salesDepartmentId: sales1.departmentId, customerId: cus(1), siteName: "ひかり北メガソーラー（架空）", title: "SPEC-M 接続箱・集電盤", quantity: "6", contractDeliveryDate: daysFromToday(200) }));
    await saveSpecValues(sales1, o.id, await fullSpec(cat("SOLAR"), {
      "SPEC-Mオプション選択内容": { state: "UNRESOLVED", value: null, unresolved: unresolved(sales1.id, 10, { knownInfo: "オプションAは確定。Cを付けるか顧客が社内検討中" }) },
    }));
    await saveDocuments(sales1, o.id, await fullDocs(cat("SOLAR"), o.orderNumber, {
      "単線結線図": { state: "NOT_OBTAINED", url: null, version: null, docDate: null, unresolved: unresolved(sales1.id, 7, { knownInfo: "顧客の電気設計会社が作成中", designImpact: "CANNOT_START" }) },
    }));
    await issueOrder(sales1, o.id, null);
    await backdate(o.id, { created: 7, issued: 6 });
  }

  // 3. 太陽光：仕様確定待ち（期限超過あり）
  {
    const o = await createOrder(sales2, basic({ productCategoryId: cat("SOLAR"), salesUserId: sales2.id, salesDepartmentId: sales2.departmentId, customerId: cus(2), siteName: "東西エネルギー 南丘サイト（架空）", title: "SPEC-M 集電盤 増設", quantity: "2", contractDeliveryDate: daysFromToday(150) }));
    await saveSpecValues(sales2, o.id, await fullSpec(cat("SOLAR"), {
      "主要機器（パワコン等）のメーカー・型式": { state: "UNRESOLVED", value: null, unresolved: unresolved(tech1.id, -5, { responsibleType: "TECH", confirmTarget: "CUSTOMER", knownInfo: "パワコンのメーカーは2社で比較中", designImpact: "CANNOT_START" }) },
      "立会試験の有無・予定": { state: "UNRESOLVED", value: null, unresolved: unresolved(sales2.id, 2, { knownInfo: "立会の要否を顧客に確認中" }) },
    }));
    await saveDocuments(sales2, o.id, await fullDocs(cat("SOLAR"), o.orderNumber));
    await issueOrder(sales2, o.id, null);
    await acceptOrder(reception, o.id, tech1.id, "受入します。パワコンの型式は早めに確定をお願いします。");
    await backdate(o.id, { created: 40, issued: 38, accepted: 36 });
    await postMessage(tech1, o.id, { kind: "CUSTOMER_RECORD", body: "パワコンのメーカー候補2社の仕様書を顧客から受領。来週中に決定予定とのこと。", counterpart: "東西エネルギー開発 設備課（架空）", channel: "PHONE", occurredAt: new Date(Date.now() - 3 * 86_400_000), unresolvedItemId: null, taskId: null });
    await postMessage(sales2, o.id, { kind: "INTERNAL", body: "@大野翔 さん、パワコンの件ありがとうございます。顧客にも期限を再度伝えます。", counterpart: null, channel: null, occurredAt: null, unresolvedItemId: null, taskId: null });
  }

  // 4. 太陽光：仕様確定（未確定を確定済み）
  {
    const o = await createOrder(sales1, basic({ productCategoryId: cat("SOLAR"), salesUserId: sales1.id, salesDepartmentId: sales1.departmentId, customerId: cus(0), siteName: "あおぞら第2発電所（架空）", title: "SPEC-M 集電盤", quantity: "4" }));
    await saveSpecValues(sales1, o.id, await fullSpec(cat("SOLAR"), {
      "SPEC-Mオプション選択内容": { state: "UNRESOLVED", value: null, unresolved: unresolved(sales1.id, -20) },
    }));
    await saveDocuments(sales1, o.id, await fullDocs(cat("SOLAR"), o.orderNumber));
    await issueOrder(sales1, o.id, null);
    await acceptOrder(reception, o.id, tech2.id, null);
    const item = await prisma.unresolvedItem.findFirstOrThrow({ where: { orderId: o.id, status: "OPEN" } });
    await resolveUnresolved(sales1, item.id, { resolution: "オプションA・Bで確定（顧客メール 10/5）", resolvedDate: daysFromToday(-22), applySpecValue: JSON.stringify(["オプションA（仮）", "オプションB（仮）"]) });
    await backdate(o.id, { created: 70, issued: 68, accepted: 66, fixed: 22 });
    await prisma.unresolvedItem.update({ where: { id: item.id }, data: { resolvedAt: new Date(Date.now() - 22 * 86_400_000) } });
  }

  // 5. 受配電盤：差戻し
  {
    const o = await createOrder(sales2, basic({ productCategoryId: cat("SWITCHGEAR"), salesUserId: sales2.id, salesDepartmentId: sales2.departmentId, customerId: cus(3), siteName: "みなと化成 第2工場（架空）", title: "高圧受電盤 更新", quantity: "5", contractDeliveryDate: daysFromToday(300) }));
    await saveSpecValues(sales2, o.id, await fullSpec(cat("SWITCHGEAR"), { "標準仕様からの変更点": { value: "盤の扉を両開きに変更（顧客要望）" } }));
    await saveDocuments(sales2, o.id, await fullDocs(cat("SWITCHGEAR"), o.orderNumber, {
      "機器外形図": { state: "NOT_APPLICABLE", url: null, version: null, docDate: null, naReason: "標準機器のみのため不要" },
    }));
    await issueOrder(sales2, o.id, null);
    await returnOrder(reception, o.id, "顧客仕様書が旧版（第1版）です。顧客に最新版（第2版）があるはずなので確認のうえ、差し替えて再発令してください。");
    await backdate(o.id, { created: 5, issued: 4 });
  }

  // 6. 受配電盤：仕様確定待ち（内示書・納期仮・期限超過）
  {
    const o = await createOrder(sales1, basic({ productCategoryId: cat("SWITCHGEAR"), salesUserId: sales1.id, salesDepartmentId: sales1.departmentId, customerId: cus(4), siteName: "さくら台浄水場（架空）", title: "受配電設備 一式", quantity: "8", contractDeliveryDate: daysFromToday(120), deliveryType: "TENTATIVE", deliveryFixDueDate: daysFromToday(-3), orderDocType: "LETTER_OF_INTENT", shortLeadConsulted: true, shortLeadNote: "大日程管理室・工作一課と10/1に協議済み" }));
    await saveSpecValues(sales1, o.id, await fullSpec(cat("SWITCHGEAR"), {
      "材質・板厚・塗装色": { state: "UNRESOLVED", value: null, unresolved: unresolved(tech2.id, 5, { responsibleType: "TECH", knownInfo: "塗装色は顧客標準色。色番号を確認中" }) },
    }));
    await saveDocuments(sales1, o.id, await fullDocs(cat("SWITCHGEAR"), o.orderNumber, {
      "機器外形図": { state: "NOT_OBTAINED", url: null, version: null, docDate: null, unresolved: unresolved(tech2.id, -2, { responsibleType: "TECH", confirmTarget: "INTERNAL" }) },
    }));
    await issueOrder(sales1, o.id, "内示書での発令です。注文書は11月中旬の予定です。");
    await acceptOrder(reception, o.id, tech2.id, null);
    await backdate(o.id, { created: 30, issued: 28, accepted: 27 });
    // 資料の新しい版（旧版が履歴に残る例）
    const doc = await prisma.orderDocument.findFirstOrThrow({ where: { orderId: o.id, template: { name: "顧客仕様書・設計図書" } } });
    await addDocumentVersion(sales1, o.id, { documentId: doc.id, url: `https://example.sharepoint.com/sites/demo/${o.orderNumber}/spec_v2.pdf`, version: "2", docDate: daysFromToday(-4), note: "顧客から第2版を受領" });
  }

  // 7. 受配電盤：完了
  {
    const o = await createOrder(sales2, basic({ productCategoryId: cat("SWITCHGEAR"), salesUserId: sales2.id, salesDepartmentId: sales2.departmentId, customerId: cus(5), siteName: "北斗精機 本社工場（架空）", title: "低圧配電盤 増設", quantity: "2", contractDeliveryDate: daysFromToday(60), shortLeadConsulted: true }));
    await saveSpecValues(sales2, o.id, await fullSpec(cat("SWITCHGEAR")));
    await saveDocuments(sales2, o.id, await fullDocs(cat("SWITCHGEAR"), o.orderNumber));
    await issueOrder(sales2, o.id, null);
    await acceptOrder(reception, o.id, tech1.id, null);
    await completeOrder(sales2, o.id, "設計に引き渡し済み");
    await backdate(o.id, { created: 100, issued: 98, accepted: 97, fixed: 97 });
  }

  // 8. 改造：仕様確定待ち（タスクあり）
  {
    const o = await createOrder(sales1, basic({ productCategoryId: cat("RETROFIT"), salesUserId: sales1.id, salesDepartmentId: sales1.departmentId, customerId: cus(3), siteName: "みなと化成 第1工場（架空）", title: "既設受電盤 遮断器更新工事", quantity: "1", quantityUnit: "式", contractDeliveryDate: daysFromToday(110) }));
    await saveSpecValues(sales1, o.id, await fullSpec(cat("RETROFIT"), {
      "停電可能日": { state: "UNRESOLVED", value: null, unresolved: unresolved(sales1.id, 1, { knownInfo: "1月の土日のどこか。顧客の生産計画次第", designImpact: "CAN_START" }) },
    }));
    await saveDocuments(sales1, o.id, await fullDocs(cat("RETROFIT"), o.orderNumber));
    await issueOrder(sales1, o.id, null);
    await acceptOrder(reception, o.id, tech1.id, null);
    await backdate(o.id, { created: 15, issued: 14, accepted: 12 });
    const types = await prisma.taskType.findMany();
    const tt = (n: string) => types.find((t) => t.name === n)!.id;
    await createTask(tech1, o.id, { taskTypeId: tt("入構申請"), content: "1月の作業に向けて入構申請をお願いします（作業者4名）。", assigneeId: sales1.id, dueDate: daysFromToday(-1) });
    await createTask(tech1, o.id, { taskTypeId: tt("納入図の承認催促"), content: "納入図を10/20に提出済み。顧客承認の催促をお願いします。", assigneeId: sales1.id, dueDate: daysFromToday(3) });
    const t3 = await createTask(sales1, o.id, { taskTypeId: tt("現地作業の協議"), content: "現地作業2日間・4名で足りるか確認をお願いします。", assigneeId: U("factory").id, dueDate: daysFromToday(5) });
    await updateTask(U("factory"), t3.id, { status: "IN_PROGRESS" });
    await createOtherUnresolved(tech1, o.id, { title: "既設盤の銘板記載（定格）", knownInfo: "現地写真では銘板が読めない", confirmTarget: "CUSTOMER", responsibleType: "TECH", assigneeId: tech1.id, dueDate: daysFromToday(4), designImpact: "PARTIAL_START" });
  }

  // 9. 改造：受入待ち（発令直後）
  {
    const o = await createOrder(sales2, basic({ productCategoryId: cat("RETROFIT"), salesUserId: sales2.id, salesDepartmentId: sales2.departmentId, customerId: cus(4), siteName: "さくら台第2ポンプ場（架空）", title: "制御盤 改造", quantity: "1", quantityUnit: "式", contractDeliveryDate: daysFromToday(180) }));
    await saveSpecValues(sales2, o.id, await fullSpec(cat("RETROFIT")));
    await saveDocuments(sales2, o.id, await fullDocs(cat("RETROFIT"), o.orderNumber));
    await issueOrder(sales2, o.id, null);
  }

  // 10. 改造：取消（欠番）
  {
    const o = await createOrder(sales1, basic({ productCategoryId: cat("RETROFIT"), salesUserId: sales1.id, salesDepartmentId: sales1.departmentId, customerId: cus(5), siteName: "北斗精機 物流センター（架空）", title: "分電盤 改造" }));
    await cancelOrder(sales1, o.id, "失注（顧客の予算見送り）");
    await backdate(o.id, { created: 20 });
  }

  // 11. 太陽光：仕様確定（発令時点で未確定なし。8月発令）
  {
    const o = await createOrder(sales2, basic({ productCategoryId: cat("SOLAR"), salesUserId: sales2.id, salesDepartmentId: sales2.departmentId, customerId: cus(1), siteName: "ひかり西メガソーラー（架空）", title: "SPEC-M 集電盤", quantity: "5" }));
    await saveSpecValues(sales2, o.id, await fullSpec(cat("SOLAR")));
    await saveDocuments(sales2, o.id, await fullDocs(cat("SOLAR"), o.orderNumber));
    await issueOrder(sales2, o.id, null);
    await acceptOrder(reception, o.id, tech2.id, null);
    await backdate(o.id, { created: 85, issued: 84, accepted: 83, fixed: 83 });
  }

}

async function main() {
  const ctx = await seedMasters();
  console.log("マスタを登録しました。");
  if (bool(process.env.SEED_SAMPLE_ORDERS, true) && ctx.users.size > 0) {
    await seedOrders(ctx);
    console.log("サンプルオーダーを登録しました。");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
