"use server";
// オーダー関連のサーバーアクション（入力の取り出しと結果の変換だけを行い、業務処理は lib/orders に任せる）
import { redirect } from "next/navigation";
import type {
  ConfirmTarget,
  ContactChannel,
  DeliveryType,
  DesignImpact,
  DocState,
  MessageKind,
  OrderDocType,
  ResponsibleType,
  TaskStatus,
  ValueState,
} from "@/generated/prisma/enums";
import { requireUser } from "@/lib/session";
import { toActionError, UserError, type ActionResult } from "@/lib/errors";
import { all, date, enumVal, optStr, str, triBool } from "@/lib/form-data";
import { parseDateOnly, today } from "@/lib/dates";
import {
  acceptOrder,
  addDocumentVersion,
  assignTech,
  cancelOrder,
  completeOrder,
  createOrder,
  issueOrder,
  returnOrder,
  saveDocuments,
  saveSpecValues,
  updateBasic,
  type BasicInput,
  type DocumentEntry,
  type SpecEntry,
} from "@/lib/orders/service";
import {
  createOtherUnresolved,
  resolveUnresolved,
  updateUnresolved,
  withdrawUnresolved,
  type UnresolvedInput,
} from "@/lib/orders/unresolved";
import { createTask, updateTask } from "@/lib/orders/tasks";
import { postMessage } from "@/lib/orders/messages";
import { prisma } from "@/lib/db";
import { getSystemSetting } from "@/lib/settings";

const CONFIRM: ConfirmTarget[] = ["CUSTOMER", "INTERNAL"];
const RESP: ResponsibleType[] = ["SALES", "TECH"];
const IMPACT: DesignImpact[] = ["CAN_START", "PARTIAL_START", "CANNOT_START"];

// ───────────── 入力の取り出し ─────────────

function parseBasic(fd: FormData, actorId: string): BasicInput {
  const errors: Record<string, string> = {};
  const quantity = str(fd, "quantity");
  if (quantity && (Number.isNaN(Number(quantity)) || Number(quantity) < 0)) errors.quantity = "数量は0以上の数値で入力してください。";
  for (const k of ["contractDeliveryDate", "deliveryFixDueDate"]) {
    if (str(fd, k) && !date(fd, k)) errors[k] = "日付の形式が正しくありません。";
  }
  if (Object.keys(errors).length) throw new UserError("入力内容を確認してください。", errors);
  return {
    productCategoryId: optStr(fd, "productCategoryId"),
    customerId: null,
    newCustomerName: optStr(fd, "customerName"),
    siteName: optStr(fd, "siteName"),
    endUser: optStr(fd, "endUser"),
    title: optStr(fd, "title"),
    quantity: quantity || null,
    quantityUnit: optStr(fd, "quantityUnit"),
    salesUserId: str(fd, "salesUserId") || actorId,
    salesDepartmentId: optStr(fd, "salesDepartmentId"),
    contractDeliveryDate: date(fd, "contractDeliveryDate"),
    deliveryType: enumVal<DeliveryType>(fd, "deliveryType", ["FIXED", "TENTATIVE"]),
    deliveryFixDueDate: date(fd, "deliveryFixDueDate"),
    shortLeadConsulted: triBool(fd, "shortLeadConsulted"),
    shortLeadNote: optStr(fd, "shortLeadNote"),
    orderDocType: enumVal<OrderDocType>(fd, "orderDocType", ["PURCHASE_ORDER", "LETTER_OF_INTENT"]),
    quoteNumber: optStr(fd, "quoteNumber"),
    inquiryNumber: optStr(fd, "inquiryNumber"),
  };
}

/** 未確定項目の入力（prefix_assigneeId など）。担当者・期限が無ければ null */
function parseUnresolved(fd: FormData, prefix: string): UnresolvedInput | null {
  const assigneeId = str(fd, `${prefix}assigneeId`);
  const dueDate = date(fd, `${prefix}dueDate`);
  if (!assigneeId || !dueDate) return null;
  return {
    title: optStr(fd, `${prefix}title`),
    knownInfo: optStr(fd, `${prefix}knownInfo`),
    confirmTarget: enumVal(fd, `${prefix}confirmTarget`, CONFIRM) ?? "CUSTOMER",
    responsibleType: enumVal(fd, `${prefix}responsibleType`, RESP) ?? "SALES",
    assigneeId,
    dueDate,
    designImpact: enumVal(fd, `${prefix}designImpact`, IMPACT) ?? "PARTIAL_START",
  };
}

function stepRedirect(orderId: string, fd: FormData, current: number) {
  const intent = str(fd, "intent");
  if (intent === "next") redirect(`/orders/${orderId}/edit?step=${current + 1}`);
  if (intent === "prev") redirect(`/orders/${orderId}/edit?step=${current - 1}`);
}

// ───────────── 作成手順 ─────────────

export async function createOrderAction(fd: FormData): Promise<ActionResult> {
  let id: string;
  let aiEnabled = false;
  try {
    const actor = await requireUser();
    const order = await createOrder(actor, parseBasic(fd, actor.id), { manualNumber: optStr(fd, "manualNumber") });
    id = order.id;
    aiEnabled = (await getSystemSetting()).aiEnabled;
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/orders/${id}/edit?step=${aiEnabled ? 2 : 3}&created=1`);
}

export async function updateBasicAction(orderId: string, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireUser();
    await updateBasic(actor, orderId, parseBasic(fd, actor.id));
  } catch (e) {
    return toActionError(e);
  }
  stepRedirect(orderId, fd, 1);
  return { ok: true, message: "基本情報を保存しました。" };
}

export async function saveSpecAction(orderId: string, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireUser();
    const ids = all(fd, "templateIds");
    const entries: SpecEntry[] = ids.map((id) => {
      const multi = fd.getAll(`value_${id}`).filter((v): v is string => typeof v === "string" && v !== "");
      const isMulti = str(fd, `multi_${id}`) === "1";
      const value = isMulti ? (multi.length ? JSON.stringify(multi) : null) : optStr(fd, `value_${id}`);
      let state = enumVal<ValueState>(fd, `state_${id}`, ["FILLED", "UNRESOLVED", "NOT_APPLICABLE"]);
      if (state === "FILLED" && !value) state = null;
      return {
        templateId: id,
        state,
        value,
        naReason: optStr(fd, `na_${id}`),
        aiDerived: str(fd, `ai_${id}`) === "1",
        unresolved: state === "UNRESOLVED" ? parseUnresolved(fd, `un_${id}_`) : null,
      };
    });
    await saveSpecValues(actor, orderId, entries);
  } catch (e) {
    return toActionError(e);
  }
  stepRedirect(orderId, fd, 3);
  return { ok: true, message: "要求仕様書を保存しました。" };
}

export async function saveDocumentsAction(orderId: string, fd: FormData): Promise<ActionResult> {
  let warnings: string[] = [];
  try {
    const actor = await requireUser();
    const ids = all(fd, "templateIds");
    const entries: DocumentEntry[] = ids.map((id) => {
      const state = enumVal<DocState>(fd, `dstate_${id}`, ["ATTACHED", "NOT_OBTAINED", "NOT_APPLICABLE"]);
      return {
        templateId: id,
        state,
        url: optStr(fd, `url_${id}`),
        version: optStr(fd, `version_${id}`),
        docDate: date(fd, `docDate_${id}`),
        naReason: optStr(fd, `na_${id}`),
        unresolved: state === "NOT_OBTAINED" ? parseUnresolved(fd, `un_${id}_`) : null,
      };
    });
    warnings = (await saveDocuments(actor, orderId, entries)).warnings;
  } catch (e) {
    return toActionError(e);
  }
  // 警告があるときは次へ進まず、内容を見せる
  if (!warnings.length) stepRedirect(orderId, fd, 4);
  return { ok: true, message: "資料チェックリストを保存しました。", warnings };
}

export async function issueAction(orderId: string, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireUser();
    if (str(fd, "confirmed") !== "1") throw new UserError("確認のチェックを入れてください。", { confirmed: "内容を確認したらチェックを入れてください。" });
    await issueOrder(actor, orderId, optStr(fd, "comment"));
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/orders/${orderId}?issued=1`);
}

// ───────────── ステータス操作 ─────────────

export async function acceptAction(orderId: string, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireUser();
    await acceptOrder(actor, orderId, str(fd, "techUserId"), optStr(fd, "comment"));
    return { ok: true, message: "受入しました。" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function returnAction(orderId: string, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireUser();
    await returnOrder(actor, orderId, str(fd, "reason"));
    return { ok: true, message: "差し戻しました。" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function assignTechAction(orderId: string, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireUser();
    await assignTech(actor, orderId, str(fd, "techUserId"));
    return { ok: true, message: "技術担当を変更しました。" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function cancelAction(orderId: string, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireUser();
    await cancelOrder(actor, orderId, str(fd, "reason"));
    return { ok: true, message: "取消しました。" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function completeAction(orderId: string, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireUser();
    await completeOrder(actor, orderId, optStr(fd, "comment"));
    return { ok: true, message: "完了にしました。" };
  } catch (e) {
    return toActionError(e);
  }
}

// ───────────── 資料 ─────────────

export async function addDocumentVersionAction(orderId: string, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireUser();
    const r = await addDocumentVersion(actor, orderId, {
      documentId: optStr(fd, "documentId"),
      newDocumentName: optStr(fd, "name"),
      url: str(fd, "url"),
      version: str(fd, "version"),
      docDate: date(fd, "docDate"),
      note: optStr(fd, "note"),
    });
    return { ok: true, message: "資料の新しい版を登録しました。", warnings: r.warnings };
  } catch (e) {
    // 項目名を画面のフォームに合わせる
    const r = toActionError(e);
    if (r.fieldErrors)
      r.fieldErrors = Object.fromEntries(Object.entries(r.fieldErrors).map(([k, v]) => [k.replace(/_new$/, ""), v]));
    return r;
  }
}

// ───────────── 未確定項目 ─────────────

export async function createUnresolvedAction(orderId: string, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireUser();
    const input = parseUnresolved(fd, "");
    if (!input) throw new UserError("担当者と回答期限を入力してください。", { assigneeId: str(fd, "assigneeId") ? "" : "担当者を選んでください。", dueDate: date(fd, "dueDate") ? "" : "回答期限を入力してください。" });
    await createOtherUnresolved(actor, orderId, input);
    return { ok: true, message: "未確定項目を登録しました。" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateUnresolvedAction(itemId: string, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireUser();
    const dueDate = date(fd, "dueDate");
    if (!dueDate) throw new UserError("回答期限を入力してください。", { dueDate: "回答期限を入力してください。" });
    await updateUnresolved(actor, itemId, {
      title: optStr(fd, "title"),
      knownInfo: optStr(fd, "knownInfo"),
      confirmTarget: enumVal(fd, "confirmTarget", CONFIRM) ?? undefined,
      responsibleType: enumVal(fd, "responsibleType", RESP) ?? undefined,
      assigneeId: str(fd, "assigneeId") || undefined,
      dueDate,
      designImpact: enumVal(fd, "designImpact", IMPACT) ?? undefined,
      status: enumVal(fd, "status", ["OPEN", "CHECKING"] as const) ?? undefined,
    });
    return { ok: true, message: "未確定項目を更新しました。" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function resolveUnresolvedAction(itemId: string, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireUser();
    const item = await prisma.unresolvedItem.findUnique({ where: { id: itemId }, include: { specTemplate: true } });
    if (!item) throw new UserError("未確定項目が見つかりません。");
    // 資料の未確定項目は、URL・版数・日付が入っていれば資料の登録として確定する
    if (item.targetType === "DOCUMENT" && item.documentId && str(fd, "url")) {
      const r = await addDocumentVersion(actor, item.orderId, {
        documentId: item.documentId,
        url: str(fd, "url"),
        version: str(fd, "version"),
        docDate: date(fd, "docDate"),
      });
      return { ok: true, message: "資料を登録し、未確定項目を確定しました。", warnings: r.warnings };
    }
    let applySpecValue: string | null = null;
    if (item.targetType === "SPEC_FIELD" && str(fd, "applySpec") === "1") {
      const multi = fd.getAll("specValue").filter((v): v is string => typeof v === "string" && v !== "");
      applySpecValue = item.specTemplate?.inputType === "MULTISELECT" ? (multi.length ? JSON.stringify(multi) : null) : optStr(fd, "specValue");
      if (!applySpecValue) throw new UserError("要求仕様書に反映する値を入力してください。", { specValue: "反映する値を入力してください。" });
    }
    const applyDeliveryDate = item.targetType === "DELIVERY" ? date(fd, "deliveryDate") : null;
    if (item.targetType === "DELIVERY" && !applyDeliveryDate)
      throw new UserError("確定した契約納期を入力してください。", { deliveryDate: "確定した契約納期を入力してください。" });
    await resolveUnresolved(actor, itemId, {
      resolution: str(fd, "resolution"),
      resolvedDate: parseDateOnly(str(fd, "resolvedDate")) ?? today(),
      applySpecValue,
      applyDeliveryDate,
    });
    return { ok: true, message: "未確定項目を確定しました。" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function withdrawUnresolvedAction(itemId: string, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireUser();
    await withdrawUnresolved(actor, itemId, str(fd, "reason"));
    return { ok: true, message: "未確定項目を取り下げました。" };
  } catch (e) {
    const r = toActionError(e);
    if (r.fieldErrors?.resolution) r.fieldErrors = { reason: r.fieldErrors.resolution };
    return r;
  }
}

// ───────────── タスク ─────────────

export async function createTaskAction(orderId: string, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireUser();
    await createTask(actor, orderId, {
      taskTypeId: str(fd, "taskTypeId"),
      content: str(fd, "content"),
      assigneeId: str(fd, "assigneeId"),
      dueDate: date(fd, "dueDate"),
    });
    return { ok: true, message: "タスクを登録しました。" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateTaskAction(taskId: string, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireUser();
    await updateTask(actor, taskId, {
      content: fd.has("content") ? str(fd, "content") : undefined,
      assigneeId: str(fd, "assigneeId") || undefined,
      dueDate: fd.has("dueDate") ? date(fd, "dueDate") : undefined,
      status: enumVal<TaskStatus>(fd, "status", ["TODO", "IN_PROGRESS", "DONE"]) ?? undefined,
    });
    return { ok: true, message: "タスクを更新しました。" };
  } catch (e) {
    return toActionError(e);
  }
}

// ───────────── やり取り ─────────────

export async function postMessageAction(orderId: string, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireUser();
    const occurred = str(fd, "occurredAt");
    await postMessage(actor, orderId, {
      kind: enumVal<MessageKind>(fd, "kind", ["INTERNAL", "CUSTOMER_RECORD"]) ?? "INTERNAL",
      body: str(fd, "body"),
      counterpart: optStr(fd, "counterpart"),
      channel: enumVal<ContactChannel>(fd, "channel", ["PHONE", "EMAIL", "MEETING", "OTHER"]),
      // datetime-local は日本時間として扱う
      occurredAt: occurred ? new Date(`${occurred}:00+09:00`) : null,
      unresolvedItemId: optStr(fd, "unresolvedItemId"),
      taskId: optStr(fd, "taskId"),
    });
    return { ok: true, message: "投稿しました。" };
  } catch (e) {
    return toActionError(e);
  }
}
