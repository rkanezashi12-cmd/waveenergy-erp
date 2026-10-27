"use server";
import bcrypt from "bcryptjs";
import { Role, EmailPreference } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireAdminAction } from "@/lib/admin";
import { diffFields, writeAudit } from "@/lib/audit";
import { UserError, toActionError, type ActionResult } from "@/lib/errors";
import { all, bool, enumVal, str } from "@/lib/form-data";
import { generatePassword } from "@/lib/password";
import { requiredStr } from "../_util";

const ROLES = Object.values(Role);
const EMAIL_PREFS = Object.values(EmailPreference);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 画面の入力を読み取り、チェックする（登録・変更で共通） */
async function readUserInput(fd: FormData, id: string | null) {
  const name = requiredStr(fd, "name", "氏名", 50);
  const email = str(fd, "email").toLowerCase();
  if (!email) throw new UserError("メールアドレスを入力してください。", { email: "メールアドレスを入力してください。" });
  if (!EMAIL_RE.test(email) || email.length > 254)
    throw new UserError("メールアドレスの形式が正しくありません。", { email: "メールアドレスの形式が正しくありません。" });
  const dup = await prisma.user.findFirst({ where: { email, NOT: id ? { id } : undefined }, select: { id: true } });
  if (dup) throw new UserError("このメールアドレスは既に登録されています。", { email: "既に登録されています。" });

  const departmentId = str(fd, "departmentId") || null;
  if (departmentId && !(await prisma.department.findUnique({ where: { id: departmentId }, select: { id: true } })))
    throw new UserError("部署が見つかりません。", { departmentId: "部署が見つかりません。" });

  const rawRoles = all(fd, "roles");
  const roles = ROLES.filter((r) => rawRoles.includes(r));
  if (!roles.length) throw new UserError("ロールを1つ以上選んでください。", { roles: "ロールを1つ以上選んでください。" });

  const emailPreference = enumVal(fd, "emailPreference", EMAIL_PREFS) ?? "ALL";
  return { name, email, departmentId, roles, emailPreference };
}

async function hashPassword(p: string) {
  return bcrypt.hash(p, 10);
}

/** ユーザーの登録（招待制）。初期パスワードを生成し、画面に一度だけ表示する */
export async function createUser(fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireAdminAction();
    const input = await readUserInput(fd, null);
    const password = generatePassword();
    const user = await prisma.user.create({
      data: { ...input, passwordHash: await hashPassword(password), mustChangePassword: true, active: true },
    });
    await writeAudit({
      actorId: actor.id,
      action: "USER_CREATE",
      targetType: "User",
      targetId: user.id,
      targetLabel: input.email,
      after: { ...input, active: true },
    });
    return {
      ok: true,
      message: `${input.name}さんを登録しました。初期パスワード：${password}　（この表示は一度だけです。本人に伝えてください。初回ログイン時にパスワードの変更を求めます）`,
    };
  } catch (e) {
    return toActionError(e);
  }
}

/** ユーザーの変更 */
export async function updateUser(fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireAdminAction();
    const id = str(fd, "id");
    const before = await prisma.user.findUnique({ where: { id } });
    if (!before) throw new UserError("ユーザーが見つかりません。");
    const input = await readUserInput(fd, id);
    const active = bool(fd, "active");
    if (id === actor.id) {
      if (!input.roles.includes("ADMIN")) throw new UserError("自分自身の管理者ロールは外せません。", { roles: "自分自身の管理者ロールは外せません。" });
      if (!active) throw new UserError("自分自身を無効にすることはできません。", { active: "自分自身を無効にすることはできません。" });
    }
    const data = { ...input, active };
    const diff = diffFields(
      {
        name: before.name,
        email: before.email,
        departmentId: before.departmentId,
        roles: before.roles,
        emailPreference: before.emailPreference,
        active: before.active,
      },
      data,
    );
    if (!diff.changed) return { ok: true, message: "変更はありません。" };
    await prisma.user.update({ where: { id }, data });
    await writeAudit({
      actorId: actor.id,
      action: "USER_UPDATE",
      targetType: "User",
      targetId: id,
      targetLabel: input.email,
      before: diff.before,
      after: diff.after,
    });
    return { ok: true, message: "保存しました。" };
  } catch (e) {
    return toActionError(e);
  }
}

/** パスワードの再設定。新しい初期パスワードを生成し、画面に一度だけ表示する */
export async function resetPassword(fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireAdminAction();
    const id = str(fd, "id");
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new UserError("ユーザーが見つかりません。");
    const password = generatePassword();
    await prisma.user.update({
      where: { id },
      data: { passwordHash: await hashPassword(password), mustChangePassword: true },
    });
    // パスワードそのものは記録しない
    await writeAudit({
      actorId: actor.id,
      action: "PASSWORD_RESET",
      targetType: "User",
      targetId: id,
      targetLabel: user.email,
      after: { mustChangePassword: true },
    });
    return {
      ok: true,
      message: `パスワードを再設定しました。新しい初期パスワード：${password}　（この表示は一度だけです。本人に伝えてください。次回ログイン時にパスワードの変更を求めます）`,
    };
  } catch (e) {
    return toActionError(e);
  }
}
