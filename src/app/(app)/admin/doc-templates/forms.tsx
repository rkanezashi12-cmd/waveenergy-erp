"use client";
import type { DocRequirement, ResponsibleType } from "@/generated/prisma/enums";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Field } from "@/components/ui";
import { useCloseEdit } from "../_edit-row";
import { docRequirementLabel, responsibleTypeLabel } from "@/lib/labels";
import { moveDocTemplate, saveDocTemplate } from "./actions";

type DocTemplate = {
  id: string;
  name: string;
  requirement: DocRequirement;
  description: string | null;
  defaultResponsibleType: ResponsibleType;
  active: boolean;
};

const REQUIREMENTS = Object.keys(docRequirementLabel) as DocRequirement[];
const RESPONSIBLE = Object.keys(responsibleTypeLabel) as ResponsibleType[];

export function DocTemplateForm({ doc, productCategoryId }: { doc?: DocTemplate; productCategoryId?: string }) {
  const close = useCloseEdit();
  return (
    <ActionForm action={saveDocTemplate} resetOnSuccess={!doc} onSuccess={() => close?.()} className="grid gap-3">
      {doc ? <input type="hidden" name="id" value={doc.id} /> : <input type="hidden" name="productCategoryId" value={productCategoryId ?? ""} />}
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_10rem]">
        <Field label="資料名" required>
          <input name="name" className="input" defaultValue={doc?.name} />
          <FieldError name="name" />
        </Field>
        <Field label="必須区分" required>
          <select name="requirement" className="input" defaultValue={doc?.requirement ?? "REQUIRED"}>
            {REQUIREMENTS.map((r) => (
              <option key={r} value={r}>
                {docRequirementLabel[r]}
              </option>
            ))}
          </select>
          <FieldError name="requirement" />
        </Field>
        <Field label="確認担当区分の既定値" hint="未入手にしたときの初期値">
          <select name="defaultResponsibleType" className="input" defaultValue={doc?.defaultResponsibleType ?? "SALES"}>
            {RESPONSIBLE.map((r) => (
              <option key={r} value={r}>
                {responsibleTypeLabel[r]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="説明" hint="条件付きの場合は、どんなときに必要かを書きます">
        <textarea name="description" rows={2} className="input" defaultValue={doc?.description ?? ""} />
        <FieldError name="description" />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {doc ? (
          <label className="flex items-center gap-2">
            <input type="checkbox" name="active" defaultChecked={doc.active} /> 有効
          </label>
        ) : (
          <span />
        )}
        <SubmitButton>{doc ? "保存" : "追加"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** 並べ替えボタン（↑／↓） */
export function MoveButtons({ id, label, isFirst, isLast }: { id: string; label: string; isFirst: boolean; isLast: boolean }) {
  return (
    <ActionForm action={moveDocTemplate} showSuccess={false} className="flex gap-1">
      <input type="hidden" name="id" value={id} />
      <SubmitButton
        name="dir"
        value="up"
        variant="secondary"
        className="px-2 py-1"
        disabled={isFirst}
        pendingText="…"
        aria-label={`${label}を1つ上へ`}
        title="1つ上へ"
      >
        ↑
      </SubmitButton>
      <SubmitButton
        name="dir"
        value="down"
        variant="secondary"
        className="px-2 py-1"
        disabled={isLast}
        pendingText="…"
        aria-label={`${label}を1つ下へ`}
        title="1つ下へ"
      >
        ↓
      </SubmitButton>
    </ActionForm>
  );
}
