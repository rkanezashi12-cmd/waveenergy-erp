"use client";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Field } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";

export function IssueForm({ action, disabled, reissue }: { action: (fd: FormData) => Promise<ActionResult>; disabled: boolean; reissue: boolean }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-3">
      <Field label="技術受付へのコメント（任意）">
        <textarea name="comment" rows={2} className="input" disabled={disabled} />
      </Field>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="confirmed" value="1" disabled={disabled} /> 要求仕様書・資料・未確定項目の内容を確認しました
      </label>
      <FieldError name="confirmed" />
      <div>
        <SubmitButton disabled={disabled} pendingText="発令しています…">
          {reissue ? "再発令する" : "発令する"}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
