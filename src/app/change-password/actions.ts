"use server";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireUser } from "@/lib/session";
import type { ActionResult } from "@/lib/errors";
import { validatePassword } from "@/lib/password";

export async function changePasswordAction(fd: FormData): Promise<ActionResult> {
  const user = await requireUser({ allowPasswordChange: true });
  const current = String(fd.get("current") ?? "");
  const next = String(fd.get("next") ?? "");
  const confirm = String(fd.get("confirm") ?? "");
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!dbUser.passwordHash || !(await bcrypt.compare(current, dbUser.passwordHash)))
    return { ok: false, error: "現在のパスワードが正しくありません。", fieldErrors: { current: "現在のパスワードが正しくありません。" } };
  const err = validatePassword(next);
  if (err) return { ok: false, error: err, fieldErrors: { next: err } };
  if (next !== confirm) return { ok: false, error: "確認用のパスワードが一致しません。", fieldErrors: { confirm: "一致しません。" } };
  if (next === current) return { ok: false, error: "現在と異なるパスワードにしてください。", fieldErrors: { next: "現在と異なるパスワードにしてください。" } };
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(next, 10), mustChangePassword: false },
  });
  await writeAudit({ actorId: user.id, action: "PASSWORD_CHANGE", targetType: "User", targetId: user.id, targetLabel: user.email });
  redirect("/");
}
