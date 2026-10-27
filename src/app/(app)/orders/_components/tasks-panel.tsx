"use client";
// タスクタブ
import { useState } from "react";
import { ActionForm, Disclosure, FieldError, SubmitButton } from "@/components/form";
import { cx, Empty, Field, OverdueBadge, TaskBadge } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import type { TaskStatus } from "@/generated/prisma/enums";
import { taskDefaultAssigneeLabel } from "@/lib/labels";

export type TaskView = {
  id: string;
  typeName: string;
  content: string;
  assigneeId: string;
  assigneeName: string;
  dueDate: string | null;
  status: TaskStatus;
  createdByName: string;
  createdAt: string;
  overdue: boolean;
  canUpdate: boolean;
};
type Opt = { id: string; name: string };
type TaskTypeOpt = Opt & { defaultAssignee: keyof typeof taskDefaultAssigneeLabel; description: string | null };

export function NewTaskForm({
  action,
  types,
  users,
  salesUserId,
  techUserId,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  types: TaskTypeOpt[];
  users: Opt[];
  salesUserId: string;
  techUserId: string | null;
}) {
  const def = (t?: TaskTypeOpt) => (t?.defaultAssignee === "SALES" ? salesUserId : t?.defaultAssignee === "TECH" ? techUserId ?? "" : "");
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [assignee, setAssignee] = useState(def(types[0]));
  const type = types.find((t) => t.id === typeId);
  return (
    <ActionForm action={action} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
      <Field label="種別" required hint={type ? `既定の担当：${taskDefaultAssigneeLabel[type.defaultAssignee]}${type.description ? `／${type.description}` : ""}` : undefined}>
        <select
          name="taskTypeId"
          className="input"
          value={typeId}
          onChange={(e) => {
            setTypeId(e.target.value);
            const d = def(types.find((t) => t.id === e.target.value));
            if (d) setAssignee(d);
          }}
        >
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="担当者（依頼先）" required>
        <select name="assigneeId" className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">（選択してください）</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <FieldError name="assigneeId" />
      </Field>
      <Field label="内容" required className="sm:col-span-2">
        <textarea name="content" rows={2} className="input" />
        <FieldError name="content" />
      </Field>
      <Field label="期限">
        <input type="date" name="dueDate" className="input" />
      </Field>
      <div className="flex items-end">
        <SubmitButton>タスクを登録</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function TaskList({ tasks, users, update }: { tasks: TaskView[]; users: Opt[]; update: (id: string, fd: FormData) => Promise<ActionResult> }) {
  if (!tasks.length) return <Empty>タスクはありません。</Empty>;
  return (
    <div className="flex flex-col gap-3">
      {tasks.map((t) => (
        <div key={t.id} className={cx("rounded-md border p-3", t.overdue ? "border-red-300 bg-red-50/60" : t.status === "DONE" ? "border-slate-200 bg-slate-50" : "border-slate-200")}>
          <div className="flex flex-wrap items-center gap-2">
            <TaskBadge status={t.status} />
            {t.overdue && <OverdueBadge />}
            <span className="font-semibold">{t.typeName}</span>
            <span className="text-slate-600">
              担当：{t.assigneeName}
              {t.dueDate && <span className={cx("ml-2", t.overdue && "font-bold text-red-700")}>期限：{t.dueDate.replaceAll("-", "/")}</span>}
            </span>
          </div>
          <div className="mt-1 whitespace-pre-wrap">{t.content}</div>
          <div className="text-xs text-slate-500">
            依頼：{t.createdByName}（{t.createdAt}）
          </div>
          {t.canUpdate && (
            <div className="mt-2 flex flex-wrap gap-2">
              {t.status !== "IN_PROGRESS" && t.status !== "DONE" && (
                <ActionForm action={update.bind(null, t.id)} showSuccess={false}>
                  <input type="hidden" name="status" value="IN_PROGRESS" />
                  <SubmitButton variant="secondary">対応中にする</SubmitButton>
                </ActionForm>
              )}
              {t.status !== "DONE" ? (
                <ActionForm action={update.bind(null, t.id)} showSuccess={false}>
                  <input type="hidden" name="status" value="DONE" />
                  <SubmitButton>完了にする</SubmitButton>
                </ActionForm>
              ) : (
                <ActionForm action={update.bind(null, t.id)} showSuccess={false}>
                  <input type="hidden" name="status" value="TODO" />
                  <SubmitButton variant="ghost">未着手に戻す</SubmitButton>
                </ActionForm>
              )}
              <Disclosure label="変更" variant="ghost">
                <ActionForm action={update.bind(null, t.id)} className="grid gap-2 sm:grid-cols-2">
                  <Field label="担当者">
                    <select name="assigneeId" className="input" defaultValue={t.assigneeId}>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="期限">
                    <input type="date" name="dueDate" className="input" defaultValue={t.dueDate ?? ""} />
                  </Field>
                  <Field label="内容" className="sm:col-span-2">
                    <textarea name="content" rows={2} className="input" defaultValue={t.content} />
                    <FieldError name="content" />
                  </Field>
                  <div>
                    <SubmitButton>保存</SubmitButton>
                  </div>
                </ActionForm>
              </Disclosure>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
