"use client";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Field } from "@/components/ui";
import { changePasswordAction } from "./actions";

export function ChangePasswordForm() {
  return (
    <ActionForm action={changePasswordAction} className="flex flex-col gap-4">
      <Field label="現在のパスワード" htmlFor="current">
        <input id="current" name="current" type="password" autoComplete="current-password" className="input" />
        <FieldError name="current" />
      </Field>
      <Field label="新しいパスワード" htmlFor="next" hint="8文字以上。英字と数字を含めてください。">
        <input id="next" name="next" type="password" autoComplete="new-password" className="input" />
        <FieldError name="next" />
      </Field>
      <Field label="新しいパスワード（確認）" htmlFor="confirm">
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" className="input" />
        <FieldError name="confirm" />
      </Field>
      <SubmitButton>パスワードを変更する</SubmitButton>
    </ActionForm>
  );
}
