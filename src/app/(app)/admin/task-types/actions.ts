"use server";
import { TaskDefaultAssignee } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireAdminAction } from "@/lib/admin";
import { diffFields, writeAudit } from "@/lib/audit";
import { UserError, toActionError, type ActionResult } from "@/lib/errors";
import { bool, enumVal, optStr, str } from "@/lib/form-data";
import { requiredStr, sortOrderField } from "../_util";

const ASSIGNEES = Object.values(TaskDefaultAssignee);

export async function saveTaskType(fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireAdminAction();
    const id = str(fd, "id") || null;
    const name = requiredStr(fd, "name", "種別名", 50);
    const dup = await prisma.taskType.findFirst({ where: { name, NOT: id ? { id } : undefined }, select: { id: true } });
    if (dup) throw new UserError("同じ名前のタスク種別が登録されています。", { name: "登録済みです。" });
    const defaultAssignee = enumVal(fd, "defaultAssignee", ASSIGNEES);
    if (!defaultAssignee) throw new UserError("既定担当を選んでください。", { defaultAssignee: "既定担当を選んでください。" });
    const description = optStr(fd, "description");
    if (description && description.length > 500) throw new UserError("説明は500文字以内にしてください。", { description: "500文字以内にしてください。" });
    const data = { name, defaultAssignee, description, sortOrder: sortOrderField(fd), active: id ? bool(fd, "active") : true };

    if (id) {
      const before = await prisma.taskType.findUnique({ where: { id } });
      if (!before) throw new UserError("タスク種別が見つかりません。");
      const diff = diffFields(before, data);
      if (!diff.changed) return { ok: true, message: "変更はありません。" };
      await prisma.taskType.update({ where: { id }, data });
      await writeAudit({
        actorId: actor.id,
        action: "MASTER_UPDATE",
        targetType: "TaskType",
        targetId: id,
        targetLabel: name,
        before: diff.before,
        after: diff.after,
      });
    } else {
      const t = await prisma.taskType.create({ data });
      await writeAudit({ actorId: actor.id, action: "MASTER_CREATE", targetType: "TaskType", targetId: t.id, targetLabel: name, after: data });
    }
    return { ok: true, message: "保存しました。" };
  } catch (e) {
    return toActionError(e);
  }
}
