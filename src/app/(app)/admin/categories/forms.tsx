"use client";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Field } from "@/components/ui";
import { useCloseEdit } from "../_edit-row";
import { CheckboxGroup } from "../_shared";
import { saveCategory } from "./actions";

type Category = {
  id: string;
  code: string;
  name: string;
  standardLeadTimeMonths: number | null;
  sortOrder: number;
  active: boolean;
  receptionUserIds: string[];
  notificationGroupIds: string[];
};
type Option = { value: string; label: string; note?: string };

export function CategoryForm({ category, receptionOptions, groupOptions }: { category?: Category; receptionOptions: Option[]; groupOptions: Option[] }) {
  const close = useCloseEdit();
  return (
    <ActionForm action={saveCategory} resetOnSuccess={!category} onSuccess={() => close?.()} className="grid gap-3">
      {category && <input type="hidden" name="id" value={category.id} />}
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr_10rem_7rem]">
        <Field label="コード" required={!category} hint={category ? "登録後は変更できません" : "英大文字・数字（例：SOLAR）。登録後は変更できません"}>
          {category ? (
            <input className="input" value={category.code} disabled readOnly />
          ) : (
            <input name="code" className="input uppercase" autoComplete="off" />
          )}
          <FieldError name="code" />
        </Field>
        <Field label="名称" required>
          <input name="name" className="input" defaultValue={category?.name} />
          <FieldError name="name" />
        </Field>
        <Field label="標準納期（月数）" hint="空欄なら短納期判定をしない">
          <input name="standardLeadTimeMonths" type="number" min={1} className="input" defaultValue={category?.standardLeadTimeMonths ?? ""} />
          <FieldError name="standardLeadTimeMonths" />
        </Field>
        <Field label="並び順">
          <input name="sortOrder" type="number" min={0} className="input" defaultValue={category?.sortOrder ?? 0} />
          <FieldError name="sortOrder" />
        </Field>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Field label="技術受付の通知先" hint="発令時に通知します。技術受付ロールを持つ有効なユーザーから選びます（未設定なら技術受付ロールの全員に通知）">
          <CheckboxGroup
            name="receptionUserIds"
            options={receptionOptions}
            defaultValues={category?.receptionUserIds ?? []}
            empty="技術受付ロールのユーザーがいません。ユーザー画面でロールを付けてください。"
          />
          <FieldError name="receptionUserIds" />
        </Field>
        <Field label="通知グループ（関係部門）" hint="発令・資料の新しい版・仕様確定を知らせます">
          <CheckboxGroup
            name="notificationGroupIds"
            options={groupOptions}
            defaultValues={category?.notificationGroupIds ?? []}
            empty="通知グループがありません。"
          />
          <FieldError name="notificationGroupIds" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {category ? (
          <label className="flex items-center gap-2">
            <input type="checkbox" name="active" defaultChecked={category.active} /> 有効
          </label>
        ) : (
          <span />
        )}
        <SubmitButton>{category ? "保存" : "追加"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
