"use client";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Field } from "@/components/ui";
import { saveCustomer } from "./actions";
import { useCloseEdit } from "../_edit-row";

type Customer = { id: string; name: string; note: string | null; active: boolean };

export function CustomerForm({ customer }: { customer?: Customer }) {
  const close = useCloseEdit();
  return (
    <ActionForm action={saveCustomer} resetOnSuccess={!customer} onSuccess={() => close?.()} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
      {customer && <input type="hidden" name="id" value={customer.id} />}
      <Field label="顧客名" required>
        <input name="name" className="input" defaultValue={customer?.name} />
        <FieldError name="name" />
      </Field>
      <Field label="備考">
        <input name="note" className="input" defaultValue={customer?.note ?? ""} />
      </Field>
      {customer ? (
        <label className="flex items-center gap-2 pb-2">
          <input type="checkbox" name="active" defaultChecked={customer.active} /> 有効
        </label>
      ) : (
        <span />
      )}
      <SubmitButton>{customer ? "保存" : "追加"}</SubmitButton>
    </ActionForm>
  );
}
