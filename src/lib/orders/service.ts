// オーダーの作成・編集・発令・受入・差戻し（SPEC §3・§4.1〜4.3）
import type {
  DeliveryType,
  DocState,
  OrderDocType,
  ValueState,
} from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { diffFields, writeAudit } from "@/lib/audit";
import { fmtDate, today } from "@/lib/dates";
import { ForbiddenError, UserError } from "@/lib/errors";
import { can, hasRole, type Actor } from "@/lib/permissions";
import { issueOrderNumber } from "@/lib/numbering";
import { groupUserIds, receptionUserIds } from "@/lib/notify/notify";
import {
  checkIssuable,
  isShortLeadTime,
  isValidDocumentLocation,
  OPEN_UNRESOLVED,
  versionWarnings,
  type IssueCheckResult,
} from "@/lib/orders/rules";
import {
  changeStatus,
  countOpenUnresolved,
  flush,
  getOrder,
  orderLabel,
  orderLink,
  requireOrderAccess,
  type Outbox,
} from "@/lib/orders/common";
import {
  createUnresolvedTx,
  resolveUnresolvedTx,
  updateUnresolvedTx,
  withdrawUnresolvedTx,
  type UnresolvedInput,
} from "@/lib/orders/unresolved";
import { orderDocTypeLabel, deliveryTypeLabel } from "@/lib/labels";

// ───────────── 基本情報 ─────────────

export type BasicInput = {
  productCategoryId: string | null;
  customerId: string | null;
  /** 顧客マスタに無い場合の新規顧客名 */
  newCustomerName: string | null;
  siteName: string | null;
  endUser: string | null;
  title: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  salesUserId: string;
  salesDepartmentId: string | null;
  contractDeliveryDate: Date | null;
  deliveryType: DeliveryType | null;
  deliveryFixDueDate: Date | null;
  shortLeadConsulted: boolean | null;
  shortLeadNote: string | null;
  orderDocType: OrderDocType | null;
  quoteNumber: string | null;
  inquiryNumber: string | null;
};

async function resolveCustomer(tx: Tx, input: BasicInput) {
  const newName = input.newCustomerName?.trim();
  if (newName) {
    const c = await tx.customer.upsert({ where: { name: newName }, create: { name: newName }, update: {} });
    return c.id;
  }
  return input.customerId || null;
}

async function assertSalesUser(tx: Tx, userId: string) {
  const u = await tx.user.findUnique({ where: { id: userId } });
  if (!u || !u.active || !hasRole(u, "SALES", "SALES_MANAGER"))
    throw new UserError("営業担当には有効な営業ユーザーを選んでください。", { salesUserId: "営業ユーザーを選んでください。" });
}

async function computeShortLead(tx: Tx, categoryId: string | null, contract: Date | null, base: Date) {
  if (!categoryId) return false;
  const cat = await tx.productCategory.findUnique({ where: { id: categoryId } });
  return isShortLeadTime(contract, cat?.standardLeadTimeMonths, base);
}

function basicData(input: BasicInput) {
  return {
    productCategoryId: input.productCategoryId || null,
    siteName: input.siteName?.trim() || null,
    endUser: input.endUser?.trim() || null,
    title: input.title?.trim() || null,
    quantity: input.quantity ? new Prisma.Decimal(input.quantity) : null,
    quantityUnit: input.quantityUnit?.trim() || null,
    salesUserId: input.salesUserId,
    salesDepartmentId: input.salesDepartmentId || null,
    contractDeliveryDate: input.contractDeliveryDate,
    deliveryType: input.deliveryType,
    deliveryFixDueDate: input.deliveryType === "TENTATIVE" ? input.deliveryFixDueDate : null,
    orderDocType: input.orderDocType,
    quoteNumber: input.quoteNumber?.trim() || null,
    inquiryNumber: input.inquiryNumber?.trim() || null,
  };
}

/** 納期区分「仮」に合わせて納期の未確定項目を作成・更新・確定する */
async function syncDeliveryItem(tx: Tx, actor: Actor, orderId: string, outbox: Outbox) {
  const order = await getOrder(tx, orderId);
  const open = await tx.unresolvedItem.findFirst({
    where: { orderId, targetType: "DELIVERY", status: { in: OPEN_UNRESOLVED } },
  });
  if (order.deliveryType === "TENTATIVE" && order.deliveryFixDueDate) {
    if (!open) {
      await createUnresolvedTx(
        tx,
        actor,
        orderId,
        { targetType: "DELIVERY", title: "契約納期（仮）" },
        {
          knownInfo: order.contractDeliveryDate ? `仮の契約納期：${fmtDate(order.contractDeliveryDate)}` : null,
          confirmTarget: "CUSTOMER",
          responsibleType: "SALES",
          assigneeId: order.salesUserId,
          dueDate: order.deliveryFixDueDate,
          designImpact: "CAN_START",
        },
        outbox,
      );
    } else if (open.dueDate.getTime() !== order.deliveryFixDueDate.getTime() || open.assigneeId !== order.salesUserId) {
      await updateUnresolvedTx(tx, actor, open, { dueDate: order.deliveryFixDueDate, assigneeId: order.salesUserId }, outbox);
    }
  } else if (open && order.deliveryType === "FIXED" && order.contractDeliveryDate) {
    await resolveUnresolvedTx(
      tx,
      actor,
      open,
      { resolution: `契約納期を確定（${fmtDate(order.contractDeliveryDate)}）`, resolvedDate: today() },
      outbox,
    );
  }
}

/** 発番してオーダーを作成する（SPEC §4.1） */
export async function createOrder(actor: Actor, input: BasicInput, opts: { manualNumber?: string | null } = {}) {
  if (!can.createOrder(actor) && !(opts.manualNumber && can.manualNumber(actor)))
    throw new ForbiddenError("オーダーを作成する権限がありません。");
  const manual = opts.manualNumber?.trim();
  if (manual && !can.manualNumber(actor)) throw new ForbiddenError("既存番号の登録は管理者・営業管理職のみ行えます。");
  const outbox: Outbox = [];
  const order = await prisma.$transaction(async (tx) => {
    await assertSalesUser(tx, input.salesUserId);
    let orderNumber: string;
    if (manual) {
      const dup = await tx.order.findUnique({ where: { orderNumber: manual } });
      if (dup) throw new UserError(`オーダー番号「${manual}」はすでに登録されています。`, { manualNumber: "この番号は登録済みです。" });
      orderNumber = manual;
    } else {
      orderNumber = await issueOrderNumber(tx);
    }
    const customerId = await resolveCustomer(tx, input);
    const data = basicData(input);
    const shortLeadTime = await computeShortLead(tx, data.productCategoryId, data.contractDeliveryDate, today());
    const created = await tx.order.create({
      data: {
        ...data,
        orderNumber,
        numberSource: manual ? "MANUAL" : "AUTO",
        customerId,
        shortLeadTime,
        shortLeadConsulted: shortLeadTime ? input.shortLeadConsulted : null,
        shortLeadNote: shortLeadTime ? input.shortLeadNote?.trim() || null : null,
        createdById: actor.id,
      },
    });
    await tx.statusHistory.create({
      data: { orderId: created.id, fromStatus: null, toStatus: "DRAFT", actorId: actor.id, comment: manual ? "既存番号で登録" : "発番" },
    });
    await writeAudit(
      { actorId: actor.id, action: "ORDER_CREATE", targetType: "Order", targetId: created.id, targetLabel: orderNumber, after: { orderNumber, numberSource: created.numberSource } },
      tx,
    );
    await syncDeliveryItem(tx, actor, created.id, outbox);
    return created;
  });
  await flush(outbox);
  return order;
}

/** 基本情報を更新する（下書き・差戻しのみ） */
export async function updateBasic(actor: Actor, orderId: string, input: BasicInput) {
  await requireOrderAccess(actor, orderId, (a) => a.edit, "このオーダーは編集できません。");
  const outbox: Outbox = [];
  const order = await prisma.$transaction(async (tx) => {
    await assertSalesUser(tx, input.salesUserId);
    const before = await getOrder(tx, orderId);
    const customerId = await resolveCustomer(tx, input);
    const data = basicData(input);
    const shortLeadTime = await computeShortLead(tx, data.productCategoryId, data.contractDeliveryDate, today());
    const next = {
      ...data,
      customerId,
      shortLeadTime,
      shortLeadConsulted: shortLeadTime ? input.shortLeadConsulted : null,
      shortLeadNote: shortLeadTime ? input.shortLeadNote?.trim() || null : null,
    };
    const updated = await tx.order.update({ where: { id: orderId }, data: next });
    const diff = diffFields(before as unknown as Record<string, unknown>, {
      ...next,
      quantity: next.quantity?.toString() ?? null,
    } as Record<string, unknown>);
    if (diff.changed)
      await writeAudit(
        { actorId: actor.id, action: "ORDER_UPDATE", targetType: "Order", targetId: orderId, targetLabel: before.orderNumber, before: { ...diff.before, quantity: before.quantity?.toString() ?? null }, after: diff.after },
        tx,
      );
    await syncDeliveryItem(tx, actor, orderId, outbox);
    return updated;
  });
  await flush(outbox);
  return order;
}

// ───────────── 要求仕様書 ─────────────

export type SpecEntry = {
  templateId: string;
  state: ValueState | null;
  value: string | null;
  naReason: string | null;
  aiDerived?: boolean;
  /** 未確定にするときの未確定項目の内容 */
  unresolved?: UnresolvedInput | null;
};

/** オーダーで使う仕様項目テンプレート（共通＋製品区分別、有効のみ） */
export async function activeSpecTemplates(tx: Tx, productCategoryId: string | null) {
  return tx.specFieldTemplate.findMany({
    where: {
      active: true,
      OR: [{ productCategoryId: null }, ...(productCategoryId ? [{ productCategoryId }] : [])],
    },
    orderBy: [{ productCategoryId: { sort: "asc", nulls: "first" } }, { sortOrder: "asc" }],
  });
}

/** 要求仕様書の値を保存する（下書き・差戻しのみ） */
export async function saveSpecValues(actor: Actor, orderId: string, entries: SpecEntry[]) {
  await requireOrderAccess(actor, orderId, (a) => a.edit, "このオーダーは編集できません。");
  const outbox: Outbox = [];
  const fieldErrors: Record<string, string> = {};
  await prisma.$transaction(async (tx) => {
    const order = await getOrder(tx, orderId);
    const templates = await activeSpecTemplates(tx, order.productCategoryId);
    const byId = new Map(templates.map((t) => [t.id, t]));
    for (const e of entries) {
      const t = byId.get(e.templateId);
      if (!t) continue;
      const before = await tx.specValue.findUnique({ where: { orderId_templateId: { orderId, templateId: t.id } } });
      const value = e.value?.trim() || null;
      const state: ValueState | null = e.state ?? (value ? "FILLED" : null);
      if (state === "NOT_APPLICABLE" && !e.naReason?.trim()) fieldErrors[`na_${t.id}`] = "該当なしの理由を入力してください。";
      const openItems = await tx.unresolvedItem.findMany({
        where: { orderId, specTemplateId: t.id, status: { in: OPEN_UNRESOLVED } },
      });
      if (state === "UNRESOLVED") {
        if (!openItems.length) {
          if (!e.unresolved) {
            fieldErrors[`un_${t.id}`] = "未確定項目の担当者と回答期限を入力してください。";
          } else {
            await createUnresolvedTx(tx, actor, orderId, { targetType: "SPEC_FIELD", specTemplateId: t.id, title: t.label }, e.unresolved, outbox);
          }
        } else if (e.unresolved) {
          await updateUnresolvedTx(tx, actor, openItems[0], e.unresolved, outbox);
        }
      } else if (openItems.length) {
        // 未確定から入力済み・該当なしに変えた場合は、未確定項目を確定（または取下げ）にする
        for (const it of openItems) {
          if (state === "FILLED" && value)
            await resolveUnresolvedTx(tx, actor, it, { resolution: value, resolvedDate: today() }, outbox);
          else await withdrawUnresolvedTx(tx, actor, it, "要求仕様書の作成中に変更", outbox, { syncTarget: false });
        }
      }
      const data = {
        value,
        state,
        naReason: state === "NOT_APPLICABLE" ? e.naReason?.trim() || null : null,
        aiDerived: before && before.value === value ? before.aiDerived : !!e.aiDerived,
      };
      const changed = !before || before.value !== data.value || before.state !== data.state || before.naReason !== data.naReason;
      if (!changed) continue;
      await tx.specValue.upsert({
        where: { orderId_templateId: { orderId, templateId: t.id } },
        create: { orderId, templateId: t.id, ...data },
        update: data,
      });
      await writeAudit(
        {
          actorId: actor.id,
          action: "SPEC_UPDATE",
          targetType: "Order",
          targetId: orderId,
          targetLabel: `${order.orderNumber} ${t.label}`,
          before: before ? { value: before.value, state: before.state, naReason: before.naReason } : null,
          after: { value: data.value, state: data.state, naReason: data.naReason },
        },
        tx,
      );
    }
    if (Object.keys(fieldErrors).length)
      throw new UserError("入力内容に不足があります。赤字の項目を確認してください。", fieldErrors);
  });
  await flush(outbox);
}

// ───────────── 資料チェックリスト ─────────────

export type DocumentEntry = {
  templateId: string;
  state: DocState | null;
  url: string | null;
  version: string | null;
  docDate: Date | null;
  naReason: string | null;
  unresolved?: UnresolvedInput | null;
};

export async function activeDocumentTemplates(tx: Tx, productCategoryId: string | null) {
  if (!productCategoryId) return [];
  return tx.documentTemplate.findMany({
    where: { active: true, productCategoryId },
    orderBy: { sortOrder: "asc" },
  });
}

function validateVersionInput(url: string | null, version: string | null, docDate: Date | null, key: string, errors: Record<string, string>) {
  if (!url?.trim()) errors[`url_${key}`] = "URL（またはパス）を入力してください。";
  else if (!isValidDocumentLocation(url)) errors[`url_${key}`] = "https:// で始まるURL、または \\\\ で始まるファイルサーバーのパスを入力してください。";
  if (!version?.trim()) errors[`version_${key}`] = "版数を入力してください。";
  if (!docDate) errors[`docDate_${key}`] = "日付を入力してください。";
}

/** 資料の版を追加する（旧版は最新でなくする）。警告を返す */
async function addVersionTx(
  tx: Tx,
  actor: Actor,
  documentId: string,
  v: { url: string; version: string; docDate: Date; note?: string | null },
) {
  const prev = await tx.documentVersion.findFirst({ where: { documentId, isLatest: true } });
  const warnings = versionWarnings(prev, { version: v.version.trim(), docDate: v.docDate });
  await tx.documentVersion.updateMany({ where: { documentId, isLatest: true }, data: { isLatest: false } });
  const created = await tx.documentVersion.create({
    data: {
      documentId,
      url: v.url.trim(),
      version: v.version.trim(),
      docDate: v.docDate,
      note: v.note?.trim() || null,
      registeredById: actor.id,
      isLatest: true,
    },
  });
  await tx.orderDocument.update({ where: { id: documentId }, data: { state: "ATTACHED", naReason: null } });
  return { created, prev, warnings };
}

/** 資料チェックリストを保存する（下書き・差戻しのみ）。警告を返す */
export async function saveDocuments(actor: Actor, orderId: string, entries: DocumentEntry[]) {
  await requireOrderAccess(actor, orderId, (a) => a.edit, "このオーダーは編集できません。");
  const outbox: Outbox = [];
  const fieldErrors: Record<string, string> = {};
  const warnings: string[] = [];
  await prisma.$transaction(async (tx) => {
    const order = await getOrder(tx, orderId);
    const templates = await activeDocumentTemplates(tx, order.productCategoryId);
    const byId = new Map(templates.map((t) => [t.id, t]));
    for (const e of entries) {
      const t = byId.get(e.templateId);
      if (!t) continue;
      let doc = await tx.orderDocument.findUnique({
        where: { orderId_templateId: { orderId, templateId: t.id } },
        include: { versions: { where: { isLatest: true } } },
      });
      if (!doc && !e.state) continue;
      if (!doc)
        doc = await tx.orderDocument.create({
          data: { orderId, templateId: t.id },
          include: { versions: { where: { isLatest: true } } },
        });
      const before = { state: doc.state, naReason: doc.naReason, latest: doc.versions[0] ?? null };
      const openItems = await tx.unresolvedItem.findMany({
        where: { documentId: doc.id, status: { in: OPEN_UNRESOLVED } },
      });

      if (e.state === "ATTACHED") {
        const latest = doc.versions[0];
        const same =
          latest &&
          latest.url === e.url?.trim() &&
          latest.version === e.version?.trim() &&
          !!e.docDate &&
          latest.docDate.getTime() === e.docDate.getTime();
        if (!same) {
          const errs: Record<string, string> = {};
          validateVersionInput(e.url, e.version, e.docDate, t.id, errs);
          if (Object.keys(errs).length) {
            Object.assign(fieldErrors, errs);
            continue;
          }
          const r = await addVersionTx(tx, actor, doc.id, { url: e.url!, version: e.version!, docDate: e.docDate! });
          r.warnings.forEach((w) => warnings.push(`「${t.name}」：${w}`));
        } else if (doc.state !== "ATTACHED") {
          await tx.orderDocument.update({ where: { id: doc.id }, data: { state: "ATTACHED", naReason: null } });
        }
        for (const it of openItems)
          await resolveUnresolvedTx(tx, actor, it, { resolution: `資料を登録（版数：${e.version?.trim()}、日付：${fmtDate(e.docDate)}）`, resolvedDate: today() }, outbox);
      } else if (e.state === "NOT_OBTAINED") {
        if (!openItems.length) {
          if (!e.unresolved) {
            fieldErrors[`un_${t.id}`] = "未入手の資料について、担当者と回答期限を入力してください。";
            continue;
          }
          await createUnresolvedTx(tx, actor, orderId, { targetType: "DOCUMENT", documentId: doc.id, title: `資料：${t.name}` }, e.unresolved, outbox);
        } else if (e.unresolved) {
          await updateUnresolvedTx(tx, actor, openItems[0], e.unresolved, outbox);
        }
        await tx.orderDocument.update({ where: { id: doc.id }, data: { state: "NOT_OBTAINED", naReason: null } });
      } else if (e.state === "NOT_APPLICABLE") {
        if (!e.naReason?.trim()) {
          fieldErrors[`na_${t.id}`] = "該当なしの理由を入力してください。";
          continue;
        }
        for (const it of openItems) await withdrawUnresolvedTx(tx, actor, it, "資料チェックリストで該当なしに変更", outbox, { syncTarget: false });
        await tx.orderDocument.update({ where: { id: doc.id }, data: { state: "NOT_APPLICABLE", naReason: e.naReason.trim() } });
      } else {
        for (const it of openItems) await withdrawUnresolvedTx(tx, actor, it, "資料チェックリストで未選択に変更", outbox, { syncTarget: false });
        await tx.orderDocument.update({ where: { id: doc.id }, data: { state: null, naReason: null } });
      }
      const after = await tx.orderDocument.findUnique({
        where: { id: doc.id },
        include: { versions: { where: { isLatest: true } } },
      });
      const aLatest = after?.versions[0] ?? null;
      if (
        before.state !== after?.state ||
        before.naReason !== after?.naReason ||
        before.latest?.id !== aLatest?.id
      ) {
        await writeAudit(
          {
            actorId: actor.id,
            action: "DOCUMENT_UPDATE",
            targetType: "Order",
            targetId: orderId,
            targetLabel: `${order.orderNumber} ${t.name}`,
            before: { state: before.state, naReason: before.naReason, url: before.latest?.url, version: before.latest?.version, docDate: before.latest?.docDate },
            after: { state: after?.state, naReason: after?.naReason, url: aLatest?.url, version: aLatest?.version, docDate: aLatest?.docDate },
          },
          tx,
        );
      }
    }
    if (Object.keys(fieldErrors).length)
      throw new UserError("入力内容に不足があります。赤字の項目を確認してください。", fieldErrors);
  });
  await flush(outbox);
  return { warnings };
}

/** 資料の新しい版を登録する（発令後の詳細画面から。追加資料の新規登録も含む） */
export async function addDocumentVersion(
  actor: Actor,
  orderId: string,
  input: {
    documentId: string | null;
    /** 追加資料を新規登録するときの資料名 */
    newDocumentName?: string | null;
    url: string;
    version: string;
    docDate: Date | null;
    note?: string | null;
  },
) {
  const { access } = await requireOrderAccess(actor, orderId, (a) => a.addDocumentVersion || a.edit, "資料を登録する権限がありません。");
  const errs: Record<string, string> = {};
  validateVersionInput(input.url, input.version, input.docDate, "new", errs);
  if (!input.documentId && !input.newDocumentName?.trim()) errs["name_new"] = "資料名を入力してください。";
  if (Object.keys(errs).length) throw new UserError("入力内容に不足があります。", errs);
  const outbox: Outbox = [];
  const result = await prisma.$transaction(async (tx) => {
    const order = await getOrder(tx, orderId);
    let documentId = input.documentId;
    let name: string;
    if (documentId) {
      const d = await tx.orderDocument.findUnique({ where: { id: documentId }, include: { template: true } });
      if (!d || d.orderId !== orderId) throw new UserError("資料が見つかりません。");
      name = d.template?.name ?? d.name ?? "資料";
    } else {
      const d = await tx.orderDocument.create({ data: { orderId, name: input.newDocumentName!.trim() } });
      documentId = d.id;
      name = d.name!;
    }
    const r = await addVersionTx(tx, actor, documentId, { url: input.url, version: input.version, docDate: input.docDate!, note: input.note });
    await writeAudit(
      {
        actorId: actor.id,
        action: "DOCUMENT_VERSION_ADD",
        targetType: "Order",
        targetId: orderId,
        targetLabel: `${order.orderNumber} ${name}`,
        before: r.prev ? { url: r.prev.url, version: r.prev.version, docDate: r.prev.docDate } : null,
        after: { url: r.created.url, version: r.created.version, docDate: r.created.docDate },
      },
      tx,
    );
    // 未入手の資料の未確定項目は、資料の登録で確定にする
    const openItems = await tx.unresolvedItem.findMany({ where: { documentId, status: { in: OPEN_UNRESOLVED } } });
    for (const it of openItems)
      await resolveUnresolvedTx(tx, actor, it, { resolution: `資料を登録（版数：${r.created.version}、日付：${fmtDate(r.created.docDate)}）`, resolvedDate: today() }, outbox);
    // 発令後の新しい版は技術担当と通知グループへ通知（SPEC §4.3）
    if (!["DRAFT", "RETURNED"].includes(order.status)) {
      outbox.push({
        type: "DOCUMENT_VERSION",
        userIds: [order.techUserId, order.salesUserId, ...(await groupUserIds(order.productCategoryId))],
        orderId,
        title: `資料の新しい版：${orderLabel(order)}`,
        body: `オーダー ${orderLabel(order)} の資料「${name}」に新しい版が登録されました。\n版数：${r.created.version}　日付：${fmtDate(r.created.docDate)}\n${r.created.url}`,
        link: `${orderLink(orderId)}?tab=documents`,
        actorId: actor.id,
      });
    }
    return r;
  });
  await flush(outbox);
  void access;
  return { warnings: result.warnings };
}

// ───────────── 発令チェック ─────────────

/** 発令チェックの入力をDBから組み立てる */
export async function buildIssueCheck(tx: Tx, orderId: string): Promise<IssueCheckResult & { openCount: number }> {
  const order = await getOrder(tx, orderId);
  const [specTemplates, docTemplates, values, docs, openItems] = await Promise.all([
    activeSpecTemplates(tx, order.productCategoryId),
    activeDocumentTemplates(tx, order.productCategoryId),
    tx.specValue.findMany({ where: { orderId } }),
    tx.orderDocument.findMany({ where: { orderId }, include: { versions: { where: { isLatest: true } } } }),
    tx.unresolvedItem.findMany({ where: { orderId, status: { in: OPEN_UNRESOLVED } } }),
  ]);
  const valueBy = new Map(values.map((v) => [v.templateId, v]));
  const docBy = new Map(docs.filter((d) => d.templateId).map((d) => [d.templateId!, d]));
  const result = checkIssuable({
    order: { ...order, quantity: order.quantity?.toString() ?? null },
    hasOpenDeliveryItem: openItems.some((i) => i.targetType === "DELIVERY"),
    specFields: specTemplates.map((t) => ({
      templateId: t.id,
      label: t.label,
      required: t.required,
      inputType: t.inputType,
      value: valueBy.get(t.id) ?? null,
      hasOpenUnresolved: openItems.some((i) => i.specTemplateId === t.id),
    })),
    documents: docTemplates.map((t) => {
      const d = docBy.get(t.id);
      return {
        templateId: t.id,
        name: t.name,
        requirement: t.requirement,
        state: d?.state ?? null,
        naReason: d?.naReason ?? null,
        hasLatestVersion: !!d?.versions.length,
        hasOpenUnresolved: !!d && openItems.some((i) => i.documentId === d.id),
      };
    }),
  });
  return { ...result, openCount: openItems.length };
}

export async function getIssueCheck(actor: Actor, orderId: string) {
  await requireOrderAccess(actor, orderId, (a) => a.view);
  return buildIssueCheck(prisma, orderId);
}

// ───────────── ステータス操作 ─────────────

/** 発令（再発令を含む）。必須項目・必須資料が揃っていなければ発令できない */
export async function issueOrder(actor: Actor, orderId: string, comment: string | null) {
  await requireOrderAccess(actor, orderId, (a) => a.issue, "このオーダーは発令できません。");
  const outbox: Outbox = [];
  await prisma.$transaction(async (tx) => {
    const order = await getOrder(tx, orderId);
    // 発令日を基準に短納期を判定し直す
    const shortLeadTime = await computeShortLead(tx, order.productCategoryId, order.contractDeliveryDate, today());
    if (shortLeadTime !== order.shortLeadTime)
      await tx.order.update({ where: { id: orderId }, data: { shortLeadTime } });
    const check = await buildIssueCheck(tx, orderId);
    if (check.problems.length)
      throw new UserError(`発令できません。不足が${check.problems.length}件あります。確認画面の一覧を見て修正してください。`);
    const now = new Date();
    const isReissue = order.status === "RETURNED";
    await changeStatus(tx, order, "ACCEPT_PENDING", actor.id, comment || (isReissue ? "再発令" : "発令"), {
      issuedAt: now,
      firstIssuedAt: order.firstIssuedAt ?? now,
      issueCount: { increment: 1 },
      // 発令時点の未確定項目数は初回発令時に記録する（発令品質レポート用）
      unresolvedCountAtIssue: order.unresolvedCountAtIssue ?? check.openCount,
      lastAcceptReminderAt: null,
    });
    const reception = await receptionUserIds(order.productCategoryId);
    const groups = await groupUserIds(order.productCategoryId);
    const customer = order.customerId ? await tx.customer.findUnique({ where: { id: order.customerId } }) : null;
    const lines = [
      `オーダー ${orderLabel(order)} が${isReissue ? "再発令" : "発令"}されました。`,
      `顧客：${customer?.name ?? ""}`,
      `契約納期：${fmtDate(order.contractDeliveryDate)}（${order.deliveryType ? deliveryTypeLabel[order.deliveryType] : ""}）`,
      `注文書／内示書：${order.orderDocType ? orderDocTypeLabel[order.orderDocType] : ""}`,
      `未確定項目：${check.openCount}件`,
      ...(comment ? [`コメント：${comment}`] : []),
    ];
    outbox.push({
      type: "ORDER_ISSUED",
      userIds: reception,
      orderId,
      title: `${isReissue ? "再発令" : "発令"}（受入をお願いします）：${orderLabel(order)}`,
      body: lines.join("\n"),
      link: orderLink(orderId),
      actorId: actor.id,
    });
    outbox.push({
      type: "ORDER_ISSUED",
      userIds: groups.filter((id) => !reception.includes(id)),
      orderId,
      title: `${isReissue ? "再発令" : "発令"}：${orderLabel(order)}`,
      body: lines.join("\n"),
      link: orderLink(orderId),
      actorId: actor.id,
    });
  });
  await flush(outbox);
}

async function assertTechUser(tx: Tx, userId: string) {
  const u = await tx.user.findUnique({ where: { id: userId } });
  if (!u || !u.active || !hasRole(u, "TECH"))
    throw new UserError("技術担当には有効な技術担当ユーザーを選んでください。", { techUserId: "技術担当を選んでください。" });
}

/** 受入（技術担当の割当を含む）。未確定項目がゼロなら直接「仕様確定」にする */
export async function acceptOrder(actor: Actor, orderId: string, techUserId: string, comment: string | null) {
  await requireOrderAccess(actor, orderId, (a) => a.accept, "このオーダーは受入できません。");
  if (!techUserId) throw new UserError("技術担当を選んでください。", { techUserId: "技術担当を選んでください。" });
  const outbox: Outbox = [];
  await prisma.$transaction(async (tx) => {
    await assertTechUser(tx, techUserId);
    const order = await getOrder(tx, orderId);
    const open = await countOpenUnresolved(tx, orderId);
    const now = new Date();
    await tx.order.update({ where: { id: orderId }, data: { techUserId, acceptedAt: now } });
    await writeAudit(
      { actorId: actor.id, action: "TECH_ASSIGN", targetType: "Order", targetId: orderId, targetLabel: order.orderNumber, before: { techUserId: order.techUserId }, after: { techUserId } },
      tx,
    );
    const to = open === 0 ? "SPEC_FIXED" : "SPEC_PENDING";
    await changeStatus(tx, order, to, actor.id, comment || "受入", to === "SPEC_FIXED" ? { specFixedAt: now } : {});
    const tech = await tx.user.findUnique({ where: { id: techUserId } });
    outbox.push({
      type: "ORDER_ACCEPTED",
      userIds: [order.salesUserId],
      orderId,
      title: `受入：${orderLabel(order)}`,
      body: `オーダー ${orderLabel(order)} が受入されました。\n技術担当：${tech?.name ?? ""}${comment ? `\nコメント：${comment}` : ""}`,
      link: orderLink(orderId),
      actorId: actor.id,
    });
    outbox.push({
      type: "TECH_ASSIGNED",
      userIds: [techUserId],
      orderId,
      title: `技術担当の割当：${orderLabel(order)}`,
      body: `オーダー ${orderLabel(order)} の技術担当に割り当てられました。未確定項目：${open}件`,
      link: orderLink(orderId),
      actorId: actor.id,
    });
    if (to === "SPEC_FIXED") {
      outbox.push({
        type: "SPEC_FIXED",
        userIds: [order.salesUserId, techUserId, ...(await groupUserIds(order.productCategoryId))],
        orderId,
        title: `仕様確定：${orderLabel(order)}`,
        body: `オーダー ${orderLabel(order)} は未確定項目が無いため、受入と同時に「仕様確定」になりました。`,
        link: orderLink(orderId),
        actorId: actor.id,
      });
    }
  });
  await flush(outbox);
}

/** 差戻し（理由必須） */
export async function returnOrder(actor: Actor, orderId: string, reason: string) {
  await requireOrderAccess(actor, orderId, (a) => a.returnOrder, "このオーダーは差戻しできません。");
  if (!reason?.trim()) throw new UserError("差戻しの理由を入力してください。", { reason: "差戻しの理由を入力してください。" });
  const outbox: Outbox = [];
  await prisma.$transaction(async (tx) => {
    const order = await getOrder(tx, orderId);
    await changeStatus(tx, order, "RETURNED", actor.id, reason.trim());
    outbox.push({
      type: "ORDER_RETURNED",
      userIds: [order.salesUserId],
      orderId,
      title: `差戻し：${orderLabel(order)}`,
      body: `オーダー ${orderLabel(order)} が差し戻されました。\n差戻し理由：${reason.trim()}`,
      link: orderLink(orderId),
      actorId: actor.id,
    });
  });
  await flush(outbox);
}

/** 技術担当の割当・変更（受入後） */
export async function assignTech(actor: Actor, orderId: string, techUserId: string) {
  await requireOrderAccess(actor, orderId, (a) => a.assignTech, "技術担当を変更する権限がありません。");
  const outbox: Outbox = [];
  await prisma.$transaction(async (tx) => {
    await assertTechUser(tx, techUserId);
    const order = await getOrder(tx, orderId);
    if (order.techUserId === techUserId) return;
    await tx.order.update({ where: { id: orderId }, data: { techUserId } });
    await writeAudit(
      { actorId: actor.id, action: "TECH_ASSIGN", targetType: "Order", targetId: orderId, targetLabel: order.orderNumber, before: { techUserId: order.techUserId }, after: { techUserId } },
      tx,
    );
    outbox.push({
      type: "TECH_ASSIGNED",
      userIds: [techUserId],
      orderId,
      title: `技術担当の割当：${orderLabel(order)}`,
      body: `オーダー ${orderLabel(order)} の技術担当に割り当てられました。`,
      link: orderLink(orderId),
      actorId: actor.id,
    });
  });
  await flush(outbox);
}

/** 取消（失注・キャンセル）。番号は欠番として残す */
export async function cancelOrder(actor: Actor, orderId: string, reason: string) {
  await requireOrderAccess(actor, orderId, (a) => a.cancel, "このオーダーは取消できません。");
  if (!reason?.trim()) throw new UserError("取消の理由を入力してください。", { reason: "取消の理由を入力してください。" });
  await prisma.$transaction(async (tx) => {
    const order = await getOrder(tx, orderId);
    await changeStatus(tx, order, "CANCELLED", actor.id, reason.trim(), { cancelledAt: new Date() });
  });
}

/** 完了（このアプリでの管理を終了） */
export async function completeOrder(actor: Actor, orderId: string, comment: string | null) {
  await requireOrderAccess(actor, orderId, (a) => a.complete, "このオーダーは完了にできません。");
  await prisma.$transaction(async (tx) => {
    const order = await getOrder(tx, orderId);
    await changeStatus(tx, order, "COMPLETED", actor.id, comment?.trim() || "完了", { completedAt: new Date() });
  });
}
