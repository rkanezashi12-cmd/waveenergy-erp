// 未確定項目（SPEC §4.5）
import type {
  ConfirmTarget,
  DesignImpact,
  ResponsibleType,
  UnresolvedTarget,
} from "@/generated/prisma/enums";
import type { UnresolvedItem } from "@/generated/prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { fmtDate } from "@/lib/dates";
import { ForbiddenError, UserError } from "@/lib/errors";
import { canUpdateUnresolved, type Actor } from "@/lib/permissions";
import { OPEN_UNRESOLVED } from "@/lib/orders/rules";
import {
  flush,
  getOrder,
  orderLabel,
  orderLink,
  recalcSpecStatus,
  requireOrderAccess,
  type Outbox,
} from "@/lib/orders/common";

export type UnresolvedInput = {
  title?: string | null;
  knownInfo?: string | null;
  confirmTarget: ConfirmTarget;
  responsibleType: ResponsibleType;
  assigneeId: string;
  dueDate: Date;
  designImpact: DesignImpact;
};

type Link =
  | { targetType: "SPEC_FIELD"; specTemplateId: string; title: string }
  | { targetType: "DOCUMENT"; documentId: string; title: string }
  | { targetType: "DELIVERY"; title: string }
  | { targetType: "OTHER"; title: string };

async function assertAssignee(tx: Tx, assigneeId: string) {
  const u = await tx.user.findUnique({ where: { id: assigneeId } });
  if (!u || !u.active) throw new UserError("担当者が見つからないか、無効になっています。", { assigneeId: "担当者を選んでください。" });
}

function auditView(i: Partial<UnresolvedItem>) {
  return {
    title: i.title,
    knownInfo: i.knownInfo,
    confirmTarget: i.confirmTarget,
    responsibleType: i.responsibleType,
    assigneeId: i.assigneeId,
    dueDate: i.dueDate,
    designImpact: i.designImpact,
    status: i.status,
    resolution: i.resolution,
  };
}

/** 未確定項目を作成する（通知は outbox に積む） */
export async function createUnresolvedTx(
  tx: Tx,
  actor: Actor,
  orderId: string,
  link: Link,
  input: UnresolvedInput,
  outbox: Outbox,
) {
  await assertAssignee(tx, input.assigneeId);
  const order = await getOrder(tx, orderId);
  const item = await tx.unresolvedItem.create({
    data: {
      orderId,
      targetType: link.targetType as UnresolvedTarget,
      specTemplateId: link.targetType === "SPEC_FIELD" ? link.specTemplateId : null,
      documentId: link.targetType === "DOCUMENT" ? link.documentId : null,
      title: (link.targetType === "OTHER" ? input.title?.trim() : null) || link.title,
      knownInfo: input.knownInfo?.trim() || null,
      confirmTarget: input.confirmTarget,
      responsibleType: input.responsibleType,
      assigneeId: input.assigneeId,
      dueDate: input.dueDate,
      designImpact: input.designImpact,
      createdById: actor.id,
    },
  });
  await writeAudit(
    {
      actorId: actor.id,
      action: "UNRESOLVED_CREATE",
      targetType: "UnresolvedItem",
      targetId: item.id,
      targetLabel: `${order.orderNumber} ${item.title}`,
      after: auditView(item),
    },
    tx,
  );
  outbox.push({
    type: "UNRESOLVED_ASSIGNED",
    userIds: [item.assigneeId],
    orderId,
    title: `未確定項目の担当：${orderLabel(order)}`,
    body: `オーダー ${orderLabel(order)} の未確定項目「${item.title}」の担当になりました。回答期限：${fmtDate(item.dueDate)}`,
    link: `${orderLink(orderId)}?tab=unresolved`,
    actorId: actor.id,
  });
  await recalcSpecStatus(tx, orderId, actor.id, outbox);
  return item;
}

/** 未確定項目の内容（担当・期限など）を更新する */
export async function updateUnresolvedTx(
  tx: Tx,
  actor: Actor,
  item: UnresolvedItem,
  input: Partial<UnresolvedInput> & { status?: "OPEN" | "CHECKING" },
  outbox: Outbox,
) {
  if (!OPEN_UNRESOLVED.includes(item.status)) throw new UserError("確定・取下げ済みの未確定項目は変更できません。");
  if (input.assigneeId) await assertAssignee(tx, input.assigneeId);
  const data = {
    title: item.targetType === "OTHER" && input.title?.trim() ? input.title.trim() : undefined,
    knownInfo: input.knownInfo === undefined ? undefined : input.knownInfo?.trim() || null,
    confirmTarget: input.confirmTarget,
    responsibleType: input.responsibleType,
    assigneeId: input.assigneeId,
    dueDate: input.dueDate,
    designImpact: input.designImpact,
    status: input.status,
  };
  const updated = await tx.unresolvedItem.update({ where: { id: item.id }, data });
  const order = await getOrder(tx, item.orderId);
  await writeAudit(
    {
      actorId: actor.id,
      action: "UNRESOLVED_UPDATE",
      targetType: "UnresolvedItem",
      targetId: item.id,
      targetLabel: `${order.orderNumber} ${item.title}`,
      before: auditView(item),
      after: auditView(updated),
    },
    tx,
  );
  if (updated.assigneeId !== item.assigneeId) {
    outbox.push({
      type: "UNRESOLVED_ASSIGNED",
      userIds: [updated.assigneeId],
      orderId: item.orderId,
      title: `未確定項目の担当：${orderLabel(order)}`,
      body: `オーダー ${orderLabel(order)} の未確定項目「${updated.title}」の担当になりました。回答期限：${fmtDate(updated.dueDate)}`,
      link: `${orderLink(item.orderId)}?tab=unresolved`,
      actorId: actor.id,
    });
  }
  return updated;
}

/** 未確定項目を確定する。関連する仕様項目・資料・納期にも反映できる（SPEC §4.5） */
export async function resolveUnresolvedTx(
  tx: Tx,
  actor: Actor,
  item: UnresolvedItem,
  input: {
    resolution: string;
    resolvedDate: Date;
    /** 仕様項目へ反映する値（対象が仕様項目のとき） */
    applySpecValue?: string | null;
    /** 納期へ反映する確定納期（対象が納期のとき） */
    applyDeliveryDate?: Date | null;
  },
  outbox: Outbox,
) {
  if (!OPEN_UNRESOLVED.includes(item.status)) throw new UserError("この未確定項目はすでに確定または取下げになっています。");
  if (!input.resolution.trim()) throw new UserError("確定内容を入力してください。", { resolution: "確定内容を入力してください。" });
  const updated = await tx.unresolvedItem.update({
    where: { id: item.id },
    data: {
      status: "RESOLVED",
      resolution: input.resolution.trim(),
      resolvedDate: input.resolvedDate,
      resolvedAt: new Date(),
      resolvedById: actor.id,
    },
  });
  const order = await getOrder(tx, item.orderId);
  await writeAudit(
    {
      actorId: actor.id,
      action: "UNRESOLVED_UPDATE",
      targetType: "UnresolvedItem",
      targetId: item.id,
      targetLabel: `${order.orderNumber} ${item.title}`,
      before: auditView(item),
      after: auditView(updated),
    },
    tx,
  );

  // 仕様項目へ反映
  if (item.targetType === "SPEC_FIELD" && item.specTemplateId && input.applySpecValue != null) {
    const v = input.applySpecValue.trim();
    if (v) {
      const before = await tx.specValue.findUnique({
        where: { orderId_templateId: { orderId: item.orderId, templateId: item.specTemplateId } },
      });
      // 同じ仕様項目に別の未確定項目が残っていれば「未確定」のままにする
      const otherOpen = await tx.unresolvedItem.count({
        where: { orderId: item.orderId, specTemplateId: item.specTemplateId, status: { in: OPEN_UNRESOLVED }, id: { not: item.id } },
      });
      const after = await tx.specValue.upsert({
        where: { orderId_templateId: { orderId: item.orderId, templateId: item.specTemplateId } },
        create: { orderId: item.orderId, templateId: item.specTemplateId, value: v, state: otherOpen ? "UNRESOLVED" : "FILLED", aiDerived: false },
        update: { value: v, state: otherOpen ? "UNRESOLVED" : "FILLED", naReason: null, aiDerived: false },
      });
      await writeAudit(
        {
          actorId: actor.id,
          action: "SPEC_UPDATE",
          targetType: "Order",
          targetId: item.orderId,
          targetLabel: `${order.orderNumber} ${item.title}`,
          before: before ? { value: before.value, state: before.state } : null,
          after: { value: after.value, state: after.state, source: "未確定項目の確定" },
        },
        tx,
      );
    }
  }
  // 納期へ反映
  if (item.targetType === "DELIVERY" && input.applyDeliveryDate) {
    await tx.order.update({
      where: { id: item.orderId },
      data: { contractDeliveryDate: input.applyDeliveryDate, deliveryType: "FIXED", deliveryFixDueDate: null },
    });
    await writeAudit(
      {
        actorId: actor.id,
        action: "ORDER_UPDATE",
        targetType: "Order",
        targetId: item.orderId,
        targetLabel: order.orderNumber,
        before: { contractDeliveryDate: order.contractDeliveryDate, deliveryType: order.deliveryType },
        after: { contractDeliveryDate: input.applyDeliveryDate, deliveryType: "FIXED", source: "未確定項目の確定" },
      },
      tx,
    );
  }

  outbox.push({
    type: "UNRESOLVED_RESOLVED",
    userIds: [order.salesUserId, order.techUserId],
    orderId: order.id,
    title: `未確定項目の確定：${orderLabel(order)}`,
    body: `オーダー ${orderLabel(order)} の未確定項目「${item.title}」が確定しました。\n確定内容：${updated.resolution}`,
    link: `${orderLink(order.id)}?tab=unresolved`,
    actorId: actor.id,
  });
  await recalcSpecStatus(tx, item.orderId, actor.id, outbox);
  return updated;
}

/** 未確定項目を取り下げる */
export async function withdrawUnresolvedTx(
  tx: Tx,
  actor: Actor,
  item: UnresolvedItem,
  reason: string,
  outbox: Outbox,
  opts: { syncTarget: boolean } = { syncTarget: true },
) {
  if (!OPEN_UNRESOLVED.includes(item.status)) throw new UserError("この未確定項目はすでに確定または取下げになっています。");
  if (!reason.trim()) throw new UserError("取下げの理由を入力してください。", { resolution: "取下げの理由を入力してください。" });
  const updated = await tx.unresolvedItem.update({
    where: { id: item.id },
    data: { status: "WITHDRAWN", resolution: reason.trim(), resolvedAt: new Date(), resolvedById: actor.id },
  });
  const order = await getOrder(tx, item.orderId);
  await writeAudit(
    {
      actorId: actor.id,
      action: "UNRESOLVED_UPDATE",
      targetType: "UnresolvedItem",
      targetId: item.id,
      targetLabel: `${order.orderNumber} ${item.title}`,
      before: auditView(item),
      after: auditView(updated),
    },
    tx,
  );
  // 対象の仕様項目・資料に他の未確定項目が無ければ「該当なし」にする（理由に取下げ理由を残す）
  if (opts.syncTarget) {
    const naReason = `未確定項目を取下げ：${reason.trim()}`;
    if (item.targetType === "SPEC_FIELD" && item.specTemplateId) {
      const otherOpen = await tx.unresolvedItem.count({
        where: { orderId: item.orderId, specTemplateId: item.specTemplateId, status: { in: OPEN_UNRESOLVED } },
      });
      if (!otherOpen)
        await tx.specValue.updateMany({
          where: { orderId: item.orderId, templateId: item.specTemplateId, state: "UNRESOLVED" },
          data: { state: "NOT_APPLICABLE", naReason },
        });
    }
    if (item.targetType === "DOCUMENT" && item.documentId) {
      const otherOpen = await tx.unresolvedItem.count({
        where: { documentId: item.documentId, status: { in: OPEN_UNRESOLVED } },
      });
      if (!otherOpen)
        await tx.orderDocument.updateMany({
          where: { id: item.documentId, state: "NOT_OBTAINED" },
          data: { state: "NOT_APPLICABLE", naReason },
        });
    }
  }
  await recalcSpecStatus(tx, item.orderId, actor.id, outbox);
  return updated;
}

// ── 画面から呼ぶ操作（権限チェック付き） ──

export async function createOtherUnresolved(actor: Actor, orderId: string, input: UnresolvedInput) {
  await requireOrderAccess(actor, orderId, (a) => a.manageUnresolved);
  if (!input.title?.trim()) throw new UserError("対象（何が未確定か）を入力してください。", { title: "対象を入力してください。" });
  const outbox: Outbox = [];
  const item = await prisma.$transaction((tx) =>
    createUnresolvedTx(tx, actor, orderId, { targetType: "OTHER", title: input.title!.trim() }, input, outbox),
  );
  await flush(outbox);
  return item;
}

async function loadItemForUpdate(actor: Actor, itemId: string) {
  const item = await prisma.unresolvedItem.findUnique({ where: { id: itemId } });
  if (!item) throw new UserError("未確定項目が見つかりません。");
  const { access } = await requireOrderAccess(actor, item.orderId, (a) => a.view);
  if (!canUpdateUnresolved(actor, access, item)) throw new ForbiddenError("この未確定項目を更新する権限がありません。");
  return item;
}

export async function updateUnresolved(
  actor: Actor,
  itemId: string,
  input: Partial<UnresolvedInput> & { status?: "OPEN" | "CHECKING" },
) {
  const item = await loadItemForUpdate(actor, itemId);
  const outbox: Outbox = [];
  const r = await prisma.$transaction((tx) => updateUnresolvedTx(tx, actor, item, input, outbox));
  await flush(outbox);
  return r;
}

export async function resolveUnresolved(
  actor: Actor,
  itemId: string,
  input: Parameters<typeof resolveUnresolvedTx>[3],
) {
  const item = await loadItemForUpdate(actor, itemId);
  const outbox: Outbox = [];
  const r = await prisma.$transaction((tx) => resolveUnresolvedTx(tx, actor, item, input, outbox));
  await flush(outbox);
  return r;
}

export async function withdrawUnresolved(actor: Actor, itemId: string, reason: string) {
  const item = await loadItemForUpdate(actor, itemId);
  const outbox: Outbox = [];
  const r = await prisma.$transaction((tx) => withdrawUnresolvedTx(tx, actor, item, reason, outbox));
  await flush(outbox);
  return r;
}
