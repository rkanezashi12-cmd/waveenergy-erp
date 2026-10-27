import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { Alert } from "@/components/ui";
import { ChangePasswordForm } from "./form";

export const metadata: Metadata = { title: "パスワード変更" };

export default async function ChangePasswordPage() {
  const user = await requireUser({ allowPasswordChange: true });
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold">パスワード変更</h1>
        <p className="mt-1 text-slate-500">{user.name} さん</p>
        {user.mustChangePassword && (
          <div className="mt-3">
            <Alert kind="warn">初回ログインのため、パスワードを変更してください。</Alert>
          </div>
        )}
        <div className="mt-4">
          <ChangePasswordForm />
        </div>
        {!user.mustChangePassword && (
          <div className="mt-4 text-center">
            <Link href="/settings" className="text-brand-700 underline">
              戻る
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
