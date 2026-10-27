// 認証（Auth.js）。デモ：メールアドレス＋パスワード、本番：Microsoft Entra ID（SPEC §6）
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import type { Provider } from "next-auth/providers";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { writeAudit } from "@/lib/audit";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

const providers: Provider[] = [];

if (env.passwordLoginEnabled) {
  providers.push(
    Credentials({
      id: "credentials",
      name: "メールアドレスとパスワード",
      credentials: {
        email: { label: "メールアドレス", type: "email" },
        password: { label: "パスワード", type: "password" },
      },
      async authorize(credentials) {
        const email = normalizeEmail(String(credentials?.email ?? ""));
        const password = String(credentials?.password ?? "");
        if (!email || !password) throw new CredentialsSignin();
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.active || !user.passwordHash) {
          await writeAudit({ actorId: null, action: "LOGIN_FAILED", targetType: "User", targetLabel: email });
          throw new CredentialsSignin();
        }
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          await writeAudit({ actorId: user.id, action: "LOGIN_FAILED", targetType: "User", targetId: user.id, targetLabel: email });
          throw new CredentialsSignin();
        }
        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        await writeAudit({ actorId: user.id, action: "LOGIN", targetType: "User", targetId: user.id, targetLabel: email });
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  );
}

if (env.entraEnabled) {
  // M9 で Wave Energy様のテナントを使って検証する
  providers.push(
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/login", error: "/login" },
  providers,
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "credentials") return true;
      // Entra ID：事前登録したユーザーのメールアドレスと照合する（招待制）
      const email = normalizeEmail(user.email ?? "");
      const dbUser = email ? await prisma.user.findUnique({ where: { email } }) : null;
      if (!dbUser || !dbUser.active) {
        await writeAudit({ actorId: null, action: "LOGIN_FAILED", targetType: "User", targetLabel: email || "(不明)" });
        return false;
      }
      await prisma.user.update({ where: { id: dbUser.id }, data: { lastLoginAt: new Date() } });
      await writeAudit({ actorId: dbUser.id, action: "LOGIN", targetType: "User", targetId: dbUser.id, targetLabel: email });
      return true;
    },
    async jwt({ token, user, account }) {
      if (user && account) {
        if (account.provider === "credentials") {
          token.uid = user.id;
        } else {
          const dbUser = await prisma.user.findUnique({ where: { email: normalizeEmail(user.email ?? "") } });
          token.uid = dbUser?.id;
        }
        token.provider = account.provider;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) session.user.id = token.uid as string;
      return session;
    },
  },
});
