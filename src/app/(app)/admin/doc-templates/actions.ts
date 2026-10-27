"use server";
import { DocRequirement, ResponsibleType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireAdminAction } from "@/lib/admin";
import { diffFields, writeAudit } from "@/lib/audit";
import { UserError, toActionError, type ActionResult } from "@/lib/errors";
import { bool, enumVal, optStr, str } from "@/lib/form-data";
import { requiredStr, swapOrder } from "../_util";

const REQUIREMENTS = Object.values(DocRequirement);
const RESPONSIBLE = Object.values(ResponsibleType);

/** 資料チェックリストテンプレートの資料の追加・変更 */
export async function saveDocTemplate(fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireAdminAction();
    const id = str(fd, "id") || null;
    const before = id ? await prisma.documentTemplate.findUnique({ where: { id } }) : null;
    if (id && !before) throw new UserError("資料が見つかりません。");

    // 製品区分は登録後に変更しない
    const productCategoryId = before ? before.productCategoryId : str(fd, "productCategoryId");
    if (!before && !(await prisma.productCategory.findUnique({ where: { id: productCategoryId }, select: { id: true } })))
      throw new UserError("製品区分が見つかりません。");

    const name = requiredStr(fd, "name", "資料名", 100);
    const dup = await prisma.documentTemplate.findFirst({ where: { productCategoryId, name, NOT: id ? { id } : undefined }, select: { id: true } });
    if (dup) throw new UserError("同じ名前の資料が登録されています。", { name: "登録済みです。" });
    const requirement = enumVal(fd, "requirement", REQUIREMENTS);
    if (!requirement) throw new UserError("必須区分を選んでください。", { requirement: "必須区分を選んでください。" });
    const description = optStr(fd, "description");
    if (description && description.length > 1000) throw new UserError("説明は1000文字以内にしてください。", { description: "1000文字以内にしてください。" });

    const data = {
      name,
      requirement,
      description,
      defaultResponsibleType: enumVal(fd, "defaultResponsibleType", RESPONSIBLE) ?? "SALES",
      active: before ? bool(fd, "active") : true,
    };
    if (before) {
      const diff = diffFields(before, data);
      if (!diff.changed) return { ok: true, message: "変更はありません。" };
      await prisma.documentTemplate.update({ where: { id: before.id }, data });
      await writeAudit({
        actorId: actor.id,
        action: "MASTER_UPDATE",
        targetType: "DocumentTemplate",
        targetId: before.id,
        targetLabel: name,
        before: diff.before,
        after: diff.after,
      });
    } else {
      const last = await prisma.documentTemplate.aggregate({ where: { productCategoryId }, _max: { sortOrder: true } });
      const sortOrder = Math.ceil(((last._max.sortOrder ?? 0) + 1) / 10) * 10;
      const created = await prisma.documentTemplate.create({ data: { ...data, productCategoryId, sortOrder } });
      await writeAudit({
        actorId: actor.id,
        action: "MASTER_CREATE",
        targetType: "DocumentTemplate",
        targetId: created.id,
        targetLabel: name,
        after: { ...data, productCategoryId, sortOrder },
      });
    }
    return { ok: true, message: "保存しました。" };
  } catch (e) {
    return toActionError(e);
  }
}

/** 並べ替え（1つ上／下の資料と入れ替える） */
export async function moveDocTemplate(fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireAdminAction();
    const id = str(fd, "id");
    const dir = str(fd, "dir") === "up" ? "up" : "down";
    const target = await prisma.documentTemplate.findUnique({ where: { id } });
    if (!target) throw new UserError("資料が見つかりません。");
    const changes = await prisma.$transaction(async (tx) => {
      const siblings = await tx.documentTemplate.findMany({
        where: { productCategoryId: target.productCategoryId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: { id: true, sortOrder: true },
      });
      const updates = swapOrder(siblings, id, dir) ?? [];
      for (const u of updates) await tx.documentTemplate.update({ where: { id: u.id }, data: { sortOrder: u.sortOrder } });
      return updates;
    });
    if (changes.length) {
      await writeAudit({
        actorId: actor.id,
        action: "MASTER_UPDATE",
        targetType: "DocumentTemplate",
        targetId: id,
        targetLabel: target.name,
        before: { sortOrder: target.sortOrder },
        after: { sortOrder: changes.find((c) => c.id === id)?.sortOrder ?? target.sortOrder },
      });
    }
    return { ok: true, message: "並べ替えました。" };
  } catch (e) {
    return toActionError(e);
  }
}
