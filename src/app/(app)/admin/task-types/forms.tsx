"use client";
import type { TaskDefaultAssignee } from "@/generated/prisma/enums";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Field } from "@/components/ui";
import { useCloseEdit } from "../_edit-row";
import { taskDefaultAssigneeLabel } from "@/lib/labels";
import { saveTaskType } from "./actions";

type TaskType = { id: string; name: string; defaultAssignee: TaskDefaultAssignee; description: string | null; sortOrder: number; active: boolean };

const ASSIGNEES = Object.keys(taskDefaultAssigneeLabel) as TaskDefaultAssignee[];

export function TaskTypeForm({ taskType }: { taskType?: TaskType }) {
  const close = useCloseEdit();
  return (
    <ActionForm
      action={saveTaskType}
      resetOnSuccess={!taskType}
      onSuccess={() => close?.()}
      className="grid gap-3 sm:grid-cols-[1fr_14rem_1fr_6rem_auto_auto] sm:items-end"
    >
      {taskType && <input type="hidden" name="id" value={taskType.id} />}
      <Field label="種別名" required>
        <input name="name" className="input" defaultValue={taskType?.name} />
        <FieldError name="name" />
      </Field>
      <Field label="既定担当" required>
        <select name="defaultAssignee" className="input" defaultValue={taskType?.defaultAssignee ?? "SALES"}>
          {ASSIGNEES.map((a) => (
            <option key={a} value={a}>
              {taskDefaultAssigneeLabel[a]}
            </option>
          ))}
        </select>
        <FieldError name="defaultAssignee" />
      </Field>
      <Field label="説明">
        <input name="description" className="input" defaultValue={taskType?.description ?? ""} />
        <FieldError name="description" />
      </Field>
      <Field label="並び順">
        <input name="sortOrder" type="number" min={0} className="input" defaultValue={taskType?.sortOrder ?? 0} />
        <FieldError name="sortOrder" />
      </Field>
      {taskType ? (
        <label className="flex items-center gap-2 pb-2">
          <input type="checkbox" name="active" defaultChecked={taskType.active} /> 有効
        </label>
      ) : (
        <span />
      )}
      <SubmitButton>{taskType ? "保存" : "追加"}</SubmitButton>
    </ActionForm>
  );
}
