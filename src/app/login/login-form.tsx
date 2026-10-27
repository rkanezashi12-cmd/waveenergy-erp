"use client";
import { ActionForm, SubmitButton } from "@/components/form";
import { Field } from "@/components/ui";
import { loginAction } from "./actions";

export function LoginForm() {
  return (
    <ActionForm action={loginAction} className="flex flex-col gap-4">
      <Field label="メールアドレス" htmlFor="email">
        <input id="email" name="email" type="email" autoComplete="username" className="input" required />
      </Field>
      <Field label="パスワード" htmlFor="password">
        <input id="password" name="password" type="password" autoComplete="current-password" className="input" required />
      </Field>
      <SubmitButton pendingText="ログイン中…">ログイン</SubmitButton>
    </ActionForm>
  );
}
