"use server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { enumVal } from "@/lib/form-data";
import type { ActionResult } from "@/lib/errors";
import type { EmailPreference } from "@/generated/prisma/enums";

export async function saveEmailPreferenceAction(fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const pref = enumVal<EmailPreference>(fd, "emailPreference", ["ALL", "DIGEST_ONLY", "NONE"]);
  if (!pref) return { ok: false, error: "メール通知の設定を選んでください。" };
  await prisma.user.update({ where: { id: user.id }, data: { emailPreference: pref } });
  await writeAudit({ actorId: user.id, action: "USER_UPDATE", targetType: "User", targetId: user.id, targetLabel: user.email, before: { emailPreference: user.emailPreference }, after: { emailPreference: pref } });
  return { ok: true, message: "保存しました。" };
}
