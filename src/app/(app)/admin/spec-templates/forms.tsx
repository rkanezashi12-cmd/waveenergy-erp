"use client";
import { useState } from "react";
import type { ResponsibleType, SpecInputType } from "@/generated/prisma/enums";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Field } from "@/components/ui";
import { responsibleTypeLabel, specInputTypeLabel } from "@/lib/labels";
import { useCloseEdit } from "../_edit-row";
import { moveSpecField, saveSpecField } from "./actions";

type SpecField = {
  id: string;
  label: string;
  inputType: SpecInputType;
  required: boolean;
  options: string[];
  description: string | null;
  defaultResponsibleType: ResponsibleType;
  active: boolean;
};

const INPUT_TYPES = Object.keys(specInputTypeLabel) as SpecInputType[];
const RESPONSIBLE = Object.keys(responsibleTypeLabel) as ResponsibleType[];

export function SpecFieldForm({ field, productCategoryId, usedCount = 0 }: { field?: SpecField; productCategoryId?: string | null; usedCount?: number }) {
  const [inputType, setInputType] = useState<SpecInputType>(field?.inputType ?? "TEXTAREA");
  const needsOptions = inputType === "SELECT" || inputType === "MULTISELECT";
  const close = useCloseEdit();
  return (
    <ActionForm
      action={saveSpecField}
      resetOnSuccess={!field}
      onSuccess={() => {
        if (field) close?.();
        else setInputType("TEXTAREA");
      }}
      className="grid gap-3"
    >
      {field ? <input type="hidden" name="id" value={field.id} /> : <input type="hidden" name="productCategoryId" value={productCategoryId ?? ""} />}
      <div className="grid gap-3 sm:grid-cols-[1fr_14rem_10rem]">
        <Field label="項目名" required>
          <input name="label" className="input" defaultValue={field?.label} />
          <FieldError name="label" />
        </Field>
        <Field label="入力形式" required>
          <select name="inputType" className="input" value={inputType} onChange={(e) => setInputType(e.target.value as SpecInputType)}>
            {INPUT_TYPES.map((t) => (
              <option key={t} value={t}>
                {specInputTypeLabel[t]}
              </option>
            ))}
          </select>
          <FieldError name="inputType" />
        </Field>
        <Field label="確認担当区分の既定値" hint="未確定にしたときの初期値">
          <select name="defaultResponsibleType" className="input" defaultValue={field?.defaultResponsibleType ?? "SALES"}>
            {RESPONSIBLE.map((r) => (
              <option key={r} value={r}>
                {responsibleTypeLabel[r]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {field && usedCount > 0 && field.inputType !== inputType && (
        <div className="text-xs font-medium text-amber-700">
          この項目は {usedCount} 件のオーダーで入力されています。入力形式を変えると、既存の値が正しく表示されないことがあります。
        </div>
      )}
      {needsOptions && (
        <Field label="選択肢" required hint="1行に1つずつ入力します">
          <textarea name="options" rows={4} className="input" defaultValue={field?.options.join("\n")} />
          <FieldError name="options" />
        </Field>
      )}
      <Field label="説明" hint="入力する人向けの説明（入力欄の下に表示）">
        <textarea name="description" rows={2} className="input" defaultValue={field?.description ?? ""} />
        <FieldError name="description" />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="required" defaultChecked={field?.required ?? false} /> 必須（空欄のまま発令できない）
          </label>
          {field && (
            <label className="flex items-center gap-2">
              <input type="checkbox" name="active" defaultChecked={field.active} /> 有効
            </label>
          )}
        </div>
        <SubmitButton>{field ? "保存" : "追加"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** 並べ替えボタン（↑／↓） */
export function MoveButtons({ id, label, isFirst, isLast }: { id: string; label: string; isFirst: boolean; isLast: boolean }) {
  return (
    <ActionForm action={moveSpecField} showSuccess={false} className="flex gap-1">
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
