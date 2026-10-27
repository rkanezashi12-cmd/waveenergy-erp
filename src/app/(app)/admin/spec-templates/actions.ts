"use server";
import { ResponsibleType, SpecInputType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireAdminAction } from "@/lib/admin";
import { diffFields, writeAudit } from "@/lib/audit";
import { UserError, toActionError, type ActionResult } from "@/lib/errors";
import { bool, enumVal, optStr, str } from "@/lib/form-data";
import { lines, requiredStr, swapOrder } from "../_util";

const INPUT_TYPES = Object.values(SpecInputType);
const RESPONSIBLE = Object.values(ResponsibleType);
const NEEDS_OPTIONS: SpecInputType[] = ["SELECT", "MULTISELECT"];

/** 要求仕様書テンプレートの項目の追加・変更 */
export async function saveSpecField(fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireAdminAction();
    const id = str(fd, "id") || null;
    const before = id ? await prisma.specFieldTemplate.findUnique({ where: { id } }) : null;
    if (id && !before) throw new UserError("項目が見つかりません。");

    // 製品区分（共通項目は null）。登録後は変更しない
    let productCategoryId: string | null = before ? before.productCategoryId : str(fd, "productCategoryId") || null;
    if (!before && productCategoryId) {
      const cat = await prisma.productCategory.findUnique({ where: { id: productCategoryId }, select: { id: true } });
      if (!cat) throw new UserError("製品区分が見つかりません。");
      productCategoryId = cat.id;
    }

    const label = requiredStr(fd, "label", "項目名", 100);
    // 同じ製品区分の項目・共通項目と同じ名前は不可（発令画面で区別できなくなるため）
    const dup = await prisma.specFieldTemplate.findFirst({
      where: {
        label,
        NOT: id ? { id } : undefined,
        ...(productCategoryId ? { OR: [{ productCategoryId }, { productCategoryId: null }] } : {}),
      },
      select: { productCategoryId: true },
    });
    if (dup) {
      const msg =
        dup.productCategoryId === productCategoryId
          ? "登録済みです。"
          : productCategoryId
            ? "共通項目に同じ名前があります。"
            : "製品区分別の項目に同じ名前があります。";
      throw new UserError("同じ名前の項目が登録されています。", { label: msg });
    }

    const inputType = enumVal(fd, "inputType", INPUT_TYPES);
    if (!inputType) throw new UserError("入力形式を選んでください。", { inputType: "入力形式を選んでください。" });
    let options: string[] = [];
    if (NEEDS_OPTIONS.includes(inputType)) {
      options = lines(fd, "options");
      if (!options.length) throw new UserError("選択肢を1行に1つずつ入力してください。", { options: "選択形式では選択肢が必須です。" });
      if (options.some((o) => o.length > 100)) throw new UserError("選択肢は1つ100文字以内にしてください。", { options: "1つ100文字以内にしてください。" });
    }
    const defaultResponsibleType = enumVal(fd, "defaultResponsibleType", RESPONSIBLE) ?? "SALES";
    const description = optStr(fd, "description");
    if (description && description.length > 1000) throw new UserError("説明は1000文字以内にしてください。", { description: "1000文字以内にしてください。" });

    const data = {
      label,
      inputType,
      required: bool(fd, "required"),
      options,
      description,
      defaultResponsibleType,
      active: before ? bool(fd, "active") : true,
    };

    if (before) {
      const diff = diffFields(before, data);
      if (!diff.changed) return { ok: true, message: "変更はありません。" };
      await prisma.specFieldTemplate.update({ where: { id: before.id }, data });
      await writeAudit({
        actorId: actor.id,
        action: "MASTER_UPDATE",
        targetType: "SpecFieldTemplate",
        targetId: before.id,
        targetLabel: label,
        before: diff.before,
        after: diff.after,
      });
    } else {
      // 末尾に追加する
      const last = await prisma.specFieldTemplate.aggregate({ where: { productCategoryId }, _max: { sortOrder: true } });
      const sortOrder = Math.ceil(((last._max.sortOrder ?? 0) + 1) / 10) * 10;
      const created = await prisma.specFieldTemplate.create({ data: { ...data, productCategoryId, sortOrder } });
      await writeAudit({
        actorId: actor.id,
        action: "MASTER_CREATE",
        targetType: "SpecFieldTemplate",
        targetId: created.id,
        targetLabel: label,
        after: { ...data, productCategoryId, sortOrder },
      });
    }
    return { ok: true, message: "保存しました。" };
  } catch (e) {
    return toActionError(e);
  }
}

/** 並べ替え（1つ上／下の項目と入れ替える） */
export async function moveSpecField(fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireAdminAction();
    const id = str(fd, "id");
    const dir = str(fd, "dir") === "up" ? "up" : "down";
    const target = await prisma.specFieldTemplate.findUnique({ where: { id } });
    if (!target) throw new UserError("項目が見つかりません。");
    const changes = await prisma.$transaction(async (tx) => {
      const siblings = await tx.specFieldTemplate.findMany({
        where: { productCategoryId: target.productCategoryId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: { id: true, sortOrder: true },
      });
      const updates = swapOrder(siblings, id, dir) ?? [];
      for (const u of updates) await tx.specFieldTemplate.update({ where: { id: u.id }, data: { sortOrder: u.sortOrder } });
      return updates;
    });
    if (changes.length) {
      const after = changes.find((c) => c.id === id)?.sortOrder ?? target.sortOrder;
      await writeAudit({
        actorId: actor.id,
        action: "MASTER_UPDATE",
        targetType: "SpecFieldTemplate",
        targetId: id,
        targetLabel: target.label,
        before: { sortOrder: target.sortOrder },
        after: { sortOrder: after },
      });
    }
    return { ok: true, message: "並べ替えました。" };
  } catch (e) {
    return toActionError(e);
  }
}
