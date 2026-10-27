// 最初の管理者ユーザーを作る（本番の初期構築用。infra/create-admin.sh から Cloud Run ジョブで実行する）
//   ADMIN_EMAIL            必須。メールアドレス（小文字にして保存）
//   ADMIN_NAME             必須。氏名
//   ADMIN_DEPARTMENT       任意。部署名（既定：システム管理。無ければ作る）
//   ADMIN_INITIAL_PASSWORD 任意。パスワードログインを使う場合の初期パスワード（初回ログイン時に変更を求める）
//   ADMIN_RESET_PASSWORD   既存ユーザーのパスワードを ADMIN_INITIAL_PASSWORD で上書きするとき true
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { validatePassword } from "@/lib/password";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const name = (process.env.ADMIN_NAME ?? "").trim();
  const deptName = (process.env.ADMIN_DEPARTMENT ?? "").trim() || "システム管理";
  const password = process.env.ADMIN_INITIAL_PASSWORD ?? "";
  const resetPassword = process.env.ADMIN_RESET_PASSWORD === "true";
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) fail("ADMIN_EMAIL に正しいメールアドレスを指定してください。");
  if (!name) fail("ADMIN_NAME に氏名を指定してください。");
  if (password) {
    const err = validatePassword(password);
    if (err) fail(`ADMIN_INITIAL_PASSWORD：${err}`);
  }

  const dept = await prisma.department.upsert({ where: { name: deptName }, create: { name: deptName, sortOrder: 9999 }, update: {} });
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    const user = await prisma.user.create({
      data: {
        email,
        name,
        roles: ["ADMIN"],
        active: true,
        departmentId: dept.id,
        passwordHash: password ? await bcrypt.hash(password, 10) : null,
        mustChangePassword: !!password,
      },
    });
    await writeAudit({ actorId: null, action: "USER_CREATE", targetType: "User", targetId: user.id, targetLabel: email, after: { roles: ["ADMIN"], source: "create-admin" } });
    console.log(`管理者ユーザーを作成しました：${email}`);
    return;
  }
  const roles = existing.roles.includes("ADMIN") ? existing.roles : [...existing.roles, "ADMIN" as const];
  const setPassword = resetPassword && !!password;
  await prisma.user.update({
    where: { id: existing.id },
    data: {
      roles,
      active: true,
      ...(setPassword ? { passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true } : {}),
    },
  });
  await writeAudit({
    actorId: null,
    action: "USER_UPDATE",
    targetType: "User",
    targetId: existing.id,
    targetLabel: email,
    before: { roles: existing.roles, active: existing.active },
    after: { roles, active: true, passwordReset: setPassword, source: "create-admin" },
  });
  console.log(`既存ユーザーを管理者にしました：${email}${setPassword ? "（パスワードを再設定）" : ""}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
