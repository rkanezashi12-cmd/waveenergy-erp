"use server";
import { prisma } from "@/lib/db";
import { requireAdminAction } from "@/lib/admin";
import { writeAudit } from "@/lib/audit";
import { toActionError, type ActionResult } from "@/lib/errors";
import { bool, optStr, str } from "@/lib/form-data";

export async function saveCustomer(fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireAdminAction();
    const id = str(fd, "id");
    const name = str(fd, "name");
    if (!name) return { ok: false, error: "顧客名を入力してください。", fieldErrors: { name: "顧客名を入力してください。" } };
    const dup = await prisma.customer.findFirst({ where: { name, NOT: id ? { id } : undefined } });
    if (dup) return { ok: false, error: "同じ名前の顧客が登録されています。", fieldErrors: { name: "登録済みです。" } };
    const data = { name, note: optStr(fd, "note"), active: id ? bool(fd, "active") : true };
    if (id) {
      const before = await prisma.customer.findUniqueOrThrow({ where: { id } });
      await prisma.customer.update({ where: { id }, data });
      await writeAudit({ actorId: actor.id, action: "MASTER_UPDATE", targetType: "Customer", targetId: id, targetLabel: name, before, after: data });
    } else {
      const c = await prisma.customer.create({ data });
      await writeAudit({ actorId: actor.id, action: "MASTER_CREATE", targetType: "Customer", targetId: c.id, targetLabel: name, after: data });
    }
    return { ok: true, message: "保存しました。" };
  } catch (e) {
    return toActionError(e);
  }
}
