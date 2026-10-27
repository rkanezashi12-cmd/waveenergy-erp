"use client";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Field } from "@/components/ui";
import { useCloseEdit } from "../_edit-row";
import { saveDepartment } from "./actions";

type Department = { id: string; name: string; parentId: string | null; sortOrder: number; active: boolean };
type ParentOption = { id: string; label: string };

export function DepartmentForm({ department, parents }: { department?: Department; parents: ParentOption[] }) {
  const close = useCloseEdit();
  return (
    <ActionForm
      action={saveDepartment}
      resetOnSuccess={!department}
      onSuccess={() => close?.()}
      className="grid gap-3 sm:grid-cols-[1fr_1fr_7rem_auto_auto] sm:items-end"
    >
      {department && <input type="hidden" name="id" value={department.id} />}
      <Field label="部署名" required>
        <input name="name" className="input" defaultValue={department?.name} />
        <FieldError name="name" />
      </Field>
      <Field label="上位部署">
        <select name="parentId" className="input" defaultValue={department?.parentId ?? ""}>
          <option value="">（なし：最上位）</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <FieldError name="parentId" />
      </Field>
      <Field label="並び順">
        <input name="sortOrder" type="number" min={0} className="input" defaultValue={department?.sortOrder ?? 0} />
        <FieldError name="sortOrder" />
      </Field>
      {department ? (
        <label className="flex items-center gap-2 pb-2">
          <input type="checkbox" name="active" defaultChecked={department.active} /> 有効
        </label>
      ) : (
        <span />
      )}
      <SubmitButton>{department ? "保存" : "追加"}</SubmitButton>
    </ActionForm>
  );
}
