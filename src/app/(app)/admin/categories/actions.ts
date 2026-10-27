"use server";
import { prisma } from "@/lib/db";
import { requireAdminAction } from "@/lib/admin";
import { diffFields, writeAudit } from "@/lib/audit";
import { UserError, toActionError, type ActionResult } from "@/lib/errors";
import { all, bool, str } from "@/lib/form-data";
import { intField, requiredStr, sortOrderField } from "../_util";

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]*$/;

/** 製品区分の登録・変更。コードは登録後に変更できない */
export async function saveCategory(fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireAdminAction();
    const id = str(fd, "id") || null;
    const before = id
      ? await prisma.productCategory.findUnique({
          where: { id },
          include: { receptionUsers: { select: { id: true, name: true } }, notificationGroups: { select: { id: true, name: true } } },
        })
      : null;
    if (id && !before) throw new UserError("製品区分が見つかりません。");

    let code = before?.code ?? "";
    if (!before) {
      code = str(fd, "code").toUpperCase();
      if (!code) throw new UserError("コードを入力してください。", { code: "コードを入力してください。" });
      if (!CODE_RE.test(code) || code.length > 20)
        throw new UserError("コードは英大文字・数字・「_」「-」で20文字以内にしてください。", { code: "英大文字・数字・「_」「-」で20文字以内" });
      if (await prisma.productCategory.findUnique({ where: { code }, select: { id: true } }))
        throw new UserError("同じコードの製品区分が登録されています。", { code: "登録済みです。" });
    }
    const name = requiredStr(fd, "name", "名称", 50);
    const standardLeadTimeMonths = intField(fd, "standardLeadTimeMonths", "標準納期（月数）", { min: 1, max: 120 });
    const sortOrder = sortOrderField(fd);
    const active = id ? bool(fd, "active") : true;

    // 技術受付の通知先：有効な技術受付ロールのユーザー（既に設定済みの人はそのまま残せる）
    const receptionIds = [...new Set(all(fd, "receptionUserIds"))];
    const currentReception = new Set(before?.receptionUsers.map((u) => u.id) ?? []);
    const receptionUsers = await prisma.user.findMany({ where: { id: { in: receptionIds } }, select: { id: true, name: true, active: true, roles: true } });
    if (
      receptionUsers.length !== receptionIds.length ||
      receptionUsers.some((u) => !currentReception.has(u.id) && !(u.active && u.roles.includes("TECH_RECEPTION")))
    )
      throw new UserError("技術受付の通知先には、有効な技術受付ロールのユーザーを選んでください。", {
        receptionUserIds: "有効な技術受付ロールのユーザーを選んでください。",
      });

    const groupIds = [...new Set(all(fd, "notificationGroupIds"))];
    const groups = await prisma.notificationGroup.findMany({ where: { id: { in: groupIds } }, select: { id: true, name: true } });
    if (groups.length !== groupIds.length) throw new UserError("通知グループが見つかりません。", { notificationGroupIds: "通知グループが見つかりません。" });

    const data = { name, standardLeadTimeMonths, sortOrder, active };
    const after = {
      code,
      ...data,
      receptionUsers: receptionUsers.map((u) => u.name),
      notificationGroups: groups.map((g) => g.name),
    };
    if (before) {
      const diff = diffFields(
        {
          code: before.code,
          name: before.name,
          standardLeadTimeMonths: before.standardLeadTimeMonths,
          sortOrder: before.sortOrder,
          active: before.active,
          receptionUsers: before.receptionUsers.map((u) => u.name).sort(),
          notificationGroups: before.notificationGroups.map((g) => g.name).sort(),
        },
        { ...after, receptionUsers: [...after.receptionUsers].sort(), notificationGroups: [...after.notificationGroups].sort() },
      );
      if (!diff.changed) return { ok: true, message: "変更はありません。" };
      await prisma.productCategory.update({
        where: { id: before.id },
        data: {
          ...data,
          receptionUsers: { set: receptionIds.map((uid) => ({ id: uid })) },
          notificationGroups: { set: groupIds.map((gid) => ({ id: gid })) },
        },
      });
      await writeAudit({
        actorId: actor.id,
        action: "MASTER_UPDATE",
        targetType: "ProductCategory",
        targetId: before.id,
        targetLabel: name,
        before: diff.before,
        after: diff.after,
      });
    } else {
      const c = await prisma.productCategory.create({
        data: {
          code,
          ...data,
          receptionUsers: { connect: receptionIds.map((uid) => ({ id: uid })) },
          notificationGroups: { connect: groupIds.map((gid) => ({ id: gid })) },
        },
      });
      await writeAudit({ actorId: actor.id, action: "MASTER_CREATE", targetType: "ProductCategory", targetId: c.id, targetLabel: name, after });
    }
    return { ok: true, message: "保存しました。" };
  } catch (e) {
    return toActionError(e);
  }
}
