// オーダーごとのやり取り（SPEC §4.7）。投稿は削除できない（訂正は追記で行う）
import type { ContactChannel, MessageKind } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions";
import { extractMentions } from "@/lib/orders/rules";
import { flush, getOrder, orderLabel, orderLink, requireOrderAccess, type Outbox } from "@/lib/orders/common";

export type MessageInput = {
  kind: MessageKind;
  body: string;
  counterpart: string | null;
  channel: ContactChannel | null;
  occurredAt: Date | null;
  unresolvedItemId: string | null;
  taskId: string | null;
};

export async function postMessage(actor: Actor, orderId: string, input: MessageInput) {
  await requireOrderAccess(actor, orderId, (a) => a.postMessage, "投稿する権限がありません。");
  const errors: Record<string, string> = {};
  if (!input.body?.trim()) errors.body = "本文を入力してください。";
  if (input.kind === "CUSTOMER_RECORD") {
    if (!input.counterpart?.trim()) errors.counterpart = "相手先を入力してください。";
    if (!input.occurredAt) errors.occurredAt = "日時を入力してください。";
    if (!input.channel) errors.channel = "手段（電話・メール・打合せ）を選んでください。";
  }
  if (Object.keys(errors).length) throw new UserError("入力内容に不足があります。", errors);
  if (input.unresolvedItemId) {
    const it = await prisma.unresolvedItem.findUnique({ where: { id: input.unresolvedItemId } });
    if (!it || it.orderId !== orderId) throw new UserError("紐づける未確定項目が見つかりません。");
  }
  if (input.taskId) {
    const t = await prisma.task.findUnique({ where: { id: input.taskId } });
    if (!t || t.orderId !== orderId) throw new UserError("紐づけるタスクが見つかりません。");
  }
  const users = await prisma.user.findMany({ where: { active: true }, select: { id: true, name: true } });
  const mentioned = extractMentions(input.body, users);
  const outbox: Outbox = [];
  const message = await prisma.$transaction(async (tx) => {
    const order = await getOrder(tx, orderId);
    const m = await tx.message.create({
      data: {
        orderId,
        kind: input.kind,
        body: input.body.trim(),
        counterpart: input.kind === "CUSTOMER_RECORD" ? input.counterpart?.trim() : null,
        channel: input.kind === "CUSTOMER_RECORD" ? input.channel : null,
        occurredAt: input.kind === "CUSTOMER_RECORD" ? input.occurredAt : null,
        unresolvedItemId: input.unresolvedItemId,
        taskId: input.taskId,
        authorId: actor.id,
        mentions: { connect: mentioned.map((u) => ({ id: u.id })) },
      },
    });
    const author = await tx.user.findUnique({ where: { id: actor.id } });
    if (mentioned.length)
      outbox.push({
        type: "MENTION",
        userIds: mentioned.map((u) => u.id),
        orderId,
        title: `メンション：${orderLabel(order)}`,
        body: `${author?.name ?? ""}さんがオーダー ${orderLabel(order)} のやり取りであなたをメンションしました。\n\n${m.body}`,
        link: `${orderLink(orderId)}?tab=messages`,
        actorId: actor.id,
      });
    return m;
  });
  await flush(outbox);
  return message;
}
