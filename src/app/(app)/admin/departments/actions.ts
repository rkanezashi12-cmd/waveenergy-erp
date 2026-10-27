"use server";
import { prisma } from "@/lib/db";
import { requireAdminAction } from "@/lib/admin";
import { diffFields, writeAudit } from "@/lib/audit";
import { UserError, toActionError, type ActionResult } from "@/lib/errors";
import { bool, str } from "@/lib/form-data";
import { requiredStr, sortOrderField } from "../_util";

export async function saveDepartment(fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireAdminAction();
    const id = str(fd, "id") || null;
    const name = requiredStr(fd, "name", "部署名", 50);
    const dup = await prisma.department.findFirst({ where: { name, NOT: id ? { id } : undefined }, select: { id: true } });
    if (dup) throw new UserError("同じ名前の部署が登録されています。", { name: "登録済みです。" });

    const parentId = str(fd, "parentId") || null;
    if (parentId) {
      const all = await prisma.department.findMany({ select: { id: true, parentId: true } });
      const byId = new Map(all.map((d) => [d.id, d.parentId]));
      if (!byId.has(parentId)) throw new UserError("上位部署が見つかりません。", { parentId: "上位部署が見つかりません。" });
      // 上位部署をたどって自分自身に戻る場合は循環になる
      if (id) {
        const seen = new Set<string>();
        for (let cur: string | null | undefined = parentId; cur; cur = byId.get(cur)) {
          if (cur === id || seen.has(cur))
            throw new UserError("上位部署に自分自身や配下の部署は選べません。", { parentId: "自分自身や配下の部署は選べません。" });
          seen.add(cur);
        }
      }
    }
    const sortOrder = sortOrderField(fd);
    const data = { name, parentId, sortOrder, active: id ? bool(fd, "active") : true };

    if (id) {
      const before = await prisma.department.findUnique({ where: { id } });
      if (!before) throw new UserError("部署が見つかりません。");
      const diff = diffFields(before, data);
      if (!diff.changed) return { ok: true, message: "変更はありません。" };
      await prisma.department.update({ where: { id }, data });
      await writeAudit({
        actorId: actor.id,
        action: "MASTER_UPDATE",
        targetType: "Department",
        targetId: id,
        targetLabel: name,
        before: diff.before,
        after: diff.after,
      });
    } else {
      const d = await prisma.department.create({ data });
      await writeAudit({ actorId: actor.id, action: "MASTER_CREATE", targetType: "Department", targetId: d.id, targetLabel: name, after: data });
    }
    return { ok: true, message: "保存しました。" };
  } catch (e) {
    return toActionError(e);
  }
}
