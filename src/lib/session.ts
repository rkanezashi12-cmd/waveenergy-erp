// ログイン中のユーザーの取得。ロール・有効/無効は毎リクエストDBから読む
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { Role, EmailPreference } from "@/generated/prisma/enums";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  departmentId: string | null;
  departmentName: string | null;
  mustChangePassword: boolean;
  emailPreference: EmailPreference;
};

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const u = await prisma.user.findUnique({ where: { id }, include: { department: true } });
  if (!u || !u.active) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    roles: u.roles,
    departmentId: u.departmentId,
    departmentName: u.department?.name ?? null,
    mustChangePassword: u.mustChangePassword,
    emailPreference: u.emailPreference,
  };
});

/** ログイン必須。初回パスワード変更が済んでいなければ変更画面へ */
export async function requireUser(opts: { allowPasswordChange?: boolean } = {}): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword && !opts.allowPasswordChange) redirect("/change-password");
  return user;
}

export { ForbiddenError } from "@/lib/errors";
