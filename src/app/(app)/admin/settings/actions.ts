"use server";
import { prisma } from "@/lib/db";
import { requireAdminAction } from "@/lib/admin";
import { diffFields, writeAudit } from "@/lib/audit";
import { toActionError, type ActionResult } from "@/lib/errors";
import { bool } from "@/lib/form-data";
import { intField } from "../_util";

/** システム設定の保存 */
export async function saveSettings(fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireAdminAction();
    const data = {
      aiEnabled: bool(fd, "aiEnabled"),
      acceptReminderBusinessDays: intField(fd, "acceptReminderBusinessDays", "受入催促までの営業日数", { min: 1, max: 30, required: true })!,
      digestDueSoonDays: intField(fd, "digestDueSoonDays", "「期限が近い」とみなす日数", { min: 1, max: 14, required: true })!,
    };
    const before = (await prisma.systemSetting.findUnique({ where: { id: "default" } })) ?? {
      aiEnabled: true,
      acceptReminderBusinessDays: 2,
      digestDueSoonDays: 3,
    };
    const diff = diffFields(before, data);
    if (!diff.changed) return { ok: true, message: "変更はありません。" };
    await prisma.systemSetting.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });
    await writeAudit({
      actorId: actor.id,
      action: "SETTING_UPDATE",
      targetType: "SystemSetting",
      targetId: "default",
      targetLabel: "システム設定",
      before: diff.before,
      after: diff.after,
    });
    return { ok: true, message: "保存しました。" };
  } catch (e) {
    return toActionError(e);
  }
}
