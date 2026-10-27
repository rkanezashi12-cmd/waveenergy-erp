"use server";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import type { ActionResult } from "@/lib/errors";

export async function loginAction(fd: FormData): Promise<ActionResult> {
  const email = String(fd.get("email") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { ok: false, error: "メールアドレスとパスワードを入力してください。" };
  try {
    await signIn("credentials", { email, password, redirectTo: "/" });
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: "メールアドレスまたはパスワードが正しくありません。" };
    throw e;
  }
}

export async function entraLoginAction() {
  await signIn("microsoft-entra-id", { redirectTo: "/" });
}
