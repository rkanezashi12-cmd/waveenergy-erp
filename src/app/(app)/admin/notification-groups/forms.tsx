"use client";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Field } from "@/components/ui";
import { useCloseEdit } from "../_edit-row";
import { CheckboxGroup } from "../_shared";
import { saveNotificationGroup } from "./actions";

type Group = { id: string; name: string; description: string | null; active: boolean; userIds: string[]; departmentIds: string[] };
type Option = { value: string; label: string; note?: string };

export function NotificationGroupForm({ group, userOptions, departmentOptions }: { group?: Group; userOptions: Option[]; departmentOptions: Option[] }) {
  const close = useCloseEdit();
  return (
    <ActionForm action={saveNotificationGroup} resetOnSuccess={!group} onSuccess={() => close?.()} className="grid gap-3">
      {group && <input type="hidden" name="id" value={group.id} />}
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <Field label="グループ名" required>
          <input name="name" className="input" defaultValue={group?.name} />
          <FieldError name="name" />
        </Field>
        <Field label="説明">
          <input name="description" className="input" defaultValue={group?.description ?? ""} />
          <FieldError name="description" />
        </Field>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Field label="メンバー（部署）" hint="部署の有効なユーザー全員に通知します">
          <CheckboxGroup name="departmentIds" options={departmentOptions} defaultValues={group?.departmentIds ?? []} />
          <FieldError name="departmentIds" />
        </Field>
        <Field label="メンバー（個人）" hint="部署単位ではなく個別に追加する人">
          <CheckboxGroup name="userIds" options={userOptions} defaultValues={group?.userIds ?? []} />
          <FieldError name="userIds" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {group ? (
          <label className="flex items-center gap-2">
            <input type="checkbox" name="active" defaultChecked={group.active} /> 有効
          </label>
        ) : (
          <span />
        )}
        <SubmitButton>{group ? "保存" : "追加"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
