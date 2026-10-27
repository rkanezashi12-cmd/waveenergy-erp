// オーダー関連サービスの共通処理
import type { OrderStatus } from "@/generated/prisma/enums";
import type { Order } from "@/generated/prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { orderStatusLabel } from "@/lib/labels";
import { notify, groupUserIds, type NotifyInput } from "@/lib/notify/notify";
import { canTransition, OPEN_UNRESOLVED } from "@/lib/orders/rules";
import { ForbiddenError, UserError } from "@/lib/errors";
import { loadOrderAccess, type Actor, type OrderAccess } from "@/lib/permissions";

/** トランザクション確定後に送る通知 */
export type Outbox = NotifyInput[];

export async function flush(outbox: Outbox) {
  for (const n of outbox) {
    try {
      await notify(n);
    } catch (e) {
      console.error(JSON.stringify({ severity: "ERROR", message: "通知の作成に失敗しました", type: n.type, error: e instanceof Error ? e.message : String(e) }));
    }
  }
}

export const orderLink = (id: string) => `/orders/${id}`;

export function orderLabel(o: { orderNumber: string; title: string | null }) {
  return o.title ? `${o.orderNumber}（${o.title}）` : o.orderNumber;
}

/** 権限を確認してオーダーを返す。権限が無ければ例外 */
export async function requireOrderAccess(
  actor: Actor,
  orderId: string,
  check: (a: OrderAccess) => boolean,
  message = "この操作を行う権限がありません。",
) {
  const r = await loadOrderAccess(actor, orderId);
  if (!r || !r.access.view) throw new UserError("オーダーが見つかりません。");
  if (!check(r.access)) throw new ForbiddenError(message);
  return r;
}

export async function getOrder(tx: Tx, id: string) {
  const o = await tx.order.findUnique({ where: { id } });
  if (!o) throw new UserError("オーダーが見つかりません。");
  return o;
}

/** ステータスを変更し、履歴と監査ログを残す */
export async function changeStatus(
  tx: Tx,
  order: Pick<Order, "id" | "status" | "orderNumber" | "title">,
  to: OrderStatus,
  actorId: string | null,
  comment: string | null,
  extra: Record<string, unknown> = {},
) {
  if (!canTransition(order.status, to))
    throw new UserError(
      `「${orderStatusLabel[order.status]}」から「${orderStatusLabel[to]}」には変更できません。`,
    );
  await tx.order.update({ where: { id: order.id }, data: { status: to, ...extra } });
  await tx.statusHistory.create({
    data: { orderId: order.id, fromStatus: order.status, toStatus: to, actorId, comment },
  });
  await writeAudit(
    {
      actorId,
      action: "STATUS_CHANGE",
      targetType: "Order",
      targetId: order.id,
      targetLabel: order.orderNumber,
      before: { status: order.status },
      after: { status: to, comment },
    },
    tx,
  );
}

export async function countOpenUnresolved(tx: Tx, orderId: string) {
  return tx.unresolvedItem.count({ where: { orderId, status: { in: OPEN_UNRESOLVED } } });
}

/**
 * 未確定項目の件数に応じて「仕様確定待ち」⇔「仕様確定」を自動で切り替える（SPEC §3.1）
 */
export async function recalcSpecStatus(tx: Tx, orderId: string, actorId: string | null, outbox: Outbox) {
  const order = await getOrder(tx, orderId);
  const open = await countOpenUnresolved(tx, orderId);
  if (order.status === "SPEC_PENDING" && open === 0) {
    await changeStatus(tx, order, "SPEC_FIXED", null, "未確定項目がすべて確定または取下げになりました。", {
      specFixedAt: new Date(),
    });
    outbox.push({
      type: "SPEC_FIXED",
      userIds: [order.salesUserId, order.techUserId, ...(await groupUserIds(order.productCategoryId))],
      orderId: order.id,
      title: `仕様確定：${orderLabel(order)}`,
      body: `オーダー ${orderLabel(order)} の未確定項目がすべて確定または取下げになり、ステータスが「仕様確定」になりました。`,
      link: orderLink(order.id),
      actorId: null,
    });
  } else if (order.status === "SPEC_FIXED" && open > 0) {
    await changeStatus(tx, order, "SPEC_PENDING", actorId, "仕様確定後に未確定項目が追加されました。", {
      specFixedAt: null,
    });
  }
}

export { prisma };
