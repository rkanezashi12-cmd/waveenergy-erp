// タスク（SPEC §4.6）
import type { TaskStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/dates";
import { ForbiddenError, UserError } from "@/lib/errors";
import { canUpdateTask, type Actor } from "@/lib/permissions";
import { flush, getOrder, orderLabel, orderLink, requireOrderAccess, type Outbox } from "@/lib/orders/common";

export type TaskInput = {
  taskTypeId: string;
  content: string;
  assigneeId: string;
  dueDate: Date | null;
};

async function validate(input: TaskInput) {
  const errors: Record<string, string> = {};
  if (!input.content?.trim()) errors.content = "内容を入力してください。";
  if (!input.assigneeId) errors.assigneeId = "担当者を選んでください。";
  if (!input.taskTypeId) errors.taskTypeId = "種別を選んでください。";
  if (Object.keys(errors).length) throw new UserError("入力内容に不足があります。", errors);
  const [type, user] = await Promise.all([
    prisma.taskType.findUnique({ where: { id: input.taskTypeId } }),
    prisma.user.findUnique({ where: { id: input.assigneeId } }),
  ]);
  if (!type) throw new UserError("タスク種別が見つかりません。");
  if (!user || !user.active) throw new UserError("担当者が見つからないか、無効になっています。");
  return type;
}

export async function createTask(actor: Actor, orderId: string, input: TaskInput) {
  await requireOrderAccess(actor, orderId, (a) => a.createTask, "タスクを登録する権限がありません。");
  const type = await validate(input);
  const outbox: Outbox = [];
  const task = await prisma.$transaction(async (tx) => {
    const order = await getOrder(tx, orderId);
    const t = await tx.task.create({
      data: {
        orderId,
        taskTypeId: input.taskTypeId,
        content: input.content.trim(),
        assigneeId: input.assigneeId,
        dueDate: input.dueDate,
        createdById: actor.id,
      },
    });
    outbox.push({
      type: "TASK_ASSIGNED",
      userIds: [t.assigneeId],
      orderId,
      title: `タスクの依頼：${type.name}（${orderLabel(order)}）`,
      body: `オーダー ${orderLabel(order)} のタスク「${type.name}」の担当になりました。\n内容：${t.content}${t.dueDate ? `\n期限：${fmtDate(t.dueDate)}` : ""}`,
      link: `${orderLink(orderId)}?tab=tasks`,
      actorId: actor.id,
    });
    return t;
  });
  await flush(outbox);
  return task;
}

export async function updateTask(
  actor: Actor,
  taskId: string,
  input: Partial<TaskInput> & { status?: TaskStatus },
) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { taskType: true } });
  if (!task) throw new UserError("タスクが見つかりません。");
  const { access } = await requireOrderAccess(actor, task.orderId, (a) => a.view);
  if (!canUpdateTask(actor, access, task)) throw new ForbiddenError("このタスクを更新する権限がありません。");
  if (input.content !== undefined && !input.content.trim()) throw new UserError("内容を入力してください。", { content: "内容を入力してください。" });
  if (input.assigneeId) {
    const u = await prisma.user.findUnique({ where: { id: input.assigneeId } });
    if (!u || !u.active) throw new UserError("担当者が見つからないか、無効になっています。");
  }
  const outbox: Outbox = [];
  const updated = await prisma.$transaction(async (tx) => {
    const order = await getOrder(tx, task.orderId);
    const u = await tx.task.update({
      where: { id: taskId },
      data: {
        content: input.content?.trim(),
        assigneeId: input.assigneeId,
        dueDate: input.dueDate,
        status: input.status,
        taskTypeId: input.taskTypeId,
        completedAt: input.status === undefined ? undefined : input.status === "DONE" ? task.completedAt ?? new Date() : null,
      },
    });
    if (u.assigneeId !== task.assigneeId)
      outbox.push({
        type: "TASK_ASSIGNED",
        userIds: [u.assigneeId],
        orderId: task.orderId,
        title: `タスクの依頼：${task.taskType.name}（${orderLabel(order)}）`,
        body: `オーダー ${orderLabel(order)} のタスク「${task.taskType.name}」の担当になりました。\n内容：${u.content}${u.dueDate ? `\n期限：${fmtDate(u.dueDate)}` : ""}`,
        link: `${orderLink(task.orderId)}?tab=tasks`,
        actorId: actor.id,
      });
    return u;
  });
  await flush(outbox);
  return updated;
}
