"use server";
import { prisma } from "@/lib/db";
import { requireAdminAction } from "@/lib/admin";
import { diffFields, writeAudit } from "@/lib/audit";
import { UserError, toActionError, type ActionResult } from "@/lib/errors";
import { all, bool, optStr, str } from "@/lib/form-data";
import { requiredStr } from "../_util";

/** 通知グループの登録・変更（メンバーはユーザー・部署で指定） */
export async function saveNotificationGroup(fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireAdminAction();
    const id = str(fd, "id") || null;
    const before = id
      ? await prisma.notificationGroup.findUnique({
          where: { id },
          include: { users: { select: { id: true, name: true } }, departments: { select: { id: true, name: true } } },
        })
      : null;
    if (id && !before) throw new UserError("通知グループが見つかりません。");

    const name = requiredStr(fd, "name", "グループ名", 50);
    const dup = await prisma.notificationGroup.findFirst({ where: { name, NOT: id ? { id } : undefined }, select: { id: true } });
    if (dup) throw new UserError("同じ名前の通知グループが登録されています。", { name: "登録済みです。" });
    const description = optStr(fd, "description");
    if (description && description.length > 500) throw new UserError("説明は500文字以内にしてください。", { description: "500文字以内にしてください。" });

    const userIds = [...new Set(all(fd, "userIds"))];
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
    if (users.length !== userIds.length) throw new UserError("ユーザーが見つかりません。", { userIds: "ユーザーが見つかりません。" });
    const departmentIds = [...new Set(all(fd, "departmentIds"))];
    const departments = await prisma.department.findMany({ where: { id: { in: departmentIds } }, select: { id: true, name: true } });
    if (departments.length !== departmentIds.length) throw new UserError("部署が見つかりません。", { departmentIds: "部署が見つかりません。" });

    const data = { name, description, active: before ? bool(fd, "active") : true };
    const after = { ...data, users: users.map((u) => u.name).sort(), departments: departments.map((d) => d.name).sort() };
    if (before) {
      const diff = diffFields(
        {
          name: before.name,
          description: before.description,
          active: before.active,
          users: before.users.map((u) => u.name).sort(),
          departments: before.departments.map((d) => d.name).sort(),
        },
        after,
      );
      if (!diff.changed) return { ok: true, message: "変更はありません。" };
      await prisma.notificationGroup.update({
        where: { id: before.id },
        data: {
          ...data,
          users: { set: userIds.map((uid) => ({ id: uid })) },
          departments: { set: departmentIds.map((did) => ({ id: did })) },
        },
      });
      await writeAudit({
        actorId: actor.id,
        action: "MASTER_UPDATE",
        targetType: "NotificationGroup",
        targetId: before.id,
        targetLabel: name,
        before: diff.before,
        after: diff.after,
      });
    } else {
      const g = await prisma.notificationGroup.create({
        data: {
          ...data,
          users: { connect: userIds.map((uid) => ({ id: uid })) },
          departments: { connect: departmentIds.map((did) => ({ id: did })) },
        },
      });
      await writeAudit({ actorId: actor.id, action: "MASTER_CREATE", targetType: "NotificationGroup", targetId: g.id, targetLabel: name, after });
    }
    return { ok: true, message: "保存しました。" };
  } catch (e) {
    return toActionError(e);
  }
}
