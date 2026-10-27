"use client";
// オーダー詳細の操作ボタン（受入・差戻し・技術担当の変更・完了・取消）
import { ActionForm, Disclosure, FieldError, SubmitButton } from "@/components/form";
import { Field } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";

type Opt = { id: string; name: string };
type Act = (fd: FormData) => Promise<ActionResult>;

export function StatusActions({
  access,
  techUsers,
  currentTechUserId,
  actions,
  openCount,
}: {
  access: { accept: boolean; returnOrder: boolean; assignTech: boolean; complete: boolean; cancel: boolean };
  techUsers: Opt[];
  currentTechUserId: string | null;
  actions: { accept: Act; returnOrder: Act; assignTech: Act; complete: Act; cancel: Act };
  openCount: number;
}) {
  const techSelect = (
    <Field label="技術担当" required>
      <select name="techUserId" className="input" defaultValue={currentTechUserId ?? ""}>
        <option value="">（選択してください）</option>
        {techUsers.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
      <FieldError name="techUserId" />
    </Field>
  );
  return (
    <div className="flex flex-wrap items-start gap-2">
      {access.accept && (
        <Disclosure label="受入する" variant="primary">
          <ActionForm action={actions.accept} className="flex min-w-72 flex-col gap-3">
            {techSelect}
            <Field label="コメント（任意）">
              <textarea name="comment" rows={2} className="input" />
            </Field>
            <div className="text-xs text-slate-600">
              {openCount === 0 ? "未確定項目が無いため、受入と同時に「仕様確定」になります。" : `未確定項目が${openCount}件あるため「仕様確定待ち」になります。`}
            </div>
            <div>
              <SubmitButton>受入する</SubmitButton>
            </div>
          </ActionForm>
        </Disclosure>
      )}
      {access.returnOrder && (
        <Disclosure label="差し戻す" variant="danger">
          <ActionForm action={actions.returnOrder} className="flex min-w-72 flex-col gap-3">
            <Field label="差戻し理由" required hint="営業担当に通知されます。何をどう直せばよいか具体的に書いてください。">
              <textarea name="reason" rows={3} className="input" />
              <FieldError name="reason" />
            </Field>
            <div>
              <SubmitButton variant="danger">差し戻す</SubmitButton>
            </div>
          </ActionForm>
        </Disclosure>
      )}
      {access.assignTech && (
        <Disclosure label="技術担当を変更">
          <ActionForm action={actions.assignTech} className="flex min-w-72 flex-col gap-3">
            {techSelect}
            <div>
              <SubmitButton>変更する</SubmitButton>
            </div>
          </ActionForm>
        </Disclosure>
      )}
      {access.complete && (
        <Disclosure label="完了にする">
          <ActionForm action={actions.complete} className="flex min-w-72 flex-col gap-3">
            <Field label="コメント（任意）">
              <input name="comment" className="input" />
            </Field>
            <div>
              <SubmitButton>完了にする</SubmitButton>
            </div>
          </ActionForm>
        </Disclosure>
      )}
      {access.cancel && (
        <Disclosure label="取消" variant="ghost">
          <ActionForm action={actions.cancel} className="flex min-w-72 flex-col gap-3" confirmMessage="このオーダーを取消します。番号は欠番として残り、元に戻せません。よろしいですか？">
            <Field label="取消の理由（失注・キャンセルなど）" required>
              <input name="reason" className="input" />
              <FieldError name="reason" />
            </Field>
            <div>
              <SubmitButton variant="danger">取消する</SubmitButton>
            </div>
          </ActionForm>
        </Disclosure>
      )}
    </div>
  );
}
