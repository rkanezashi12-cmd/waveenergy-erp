import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/session";
import { Alert, Button } from "@/components/ui";
import { LoginForm } from "./login-form";
import { entraLoginAction } from "./actions";

export const metadata: Metadata = { title: "ログイン" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-slate-900">オーダー発令・仕様確定管理</h1>
        <p className="mt-1 text-slate-500">ログインしてください</p>
        {env.isDemo && (
          <div className="mt-3">
            <Alert kind="info">デモ環境です。架空のデータのみを登録してください。</Alert>
          </div>
        )}
        {error && (
          <div className="mt-3">
            <Alert kind="error">
              {error === "AccessDenied"
                ? "このアカウントは登録されていないか、無効になっています。管理者にお問い合わせください。"
                : "ログインできませんでした。もう一度お試しください。"}
            </Alert>
          </div>
        )}
        <div className="mt-5 flex flex-col gap-4">
          {env.entraEnabled && (
            <form action={entraLoginAction}>
              <Button type="submit" className="w-full">
                Microsoftアカウントでログイン
              </Button>
            </form>
          )}
          {env.passwordLoginEnabled && <LoginForm />}
          {!env.entraEnabled && !env.passwordLoginEnabled && (
            <Alert kind="error">ログイン方法が設定されていません。管理者にお問い合わせください。</Alert>
          )}
        </div>
      </div>
    </main>
  );
}
