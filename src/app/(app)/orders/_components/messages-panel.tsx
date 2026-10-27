"use client";
// やり取りタブ：スレッド形式の投稿欄。投稿は削除できない（訂正は追記で行う）
import { useRef, useState } from "react";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Badge, cx, Empty, Field } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import { contactChannelLabel } from "@/lib/labels";

export type MessageView = {
  id: string;
  kind: "INTERNAL" | "CUSTOMER_RECORD";
  body: string;
  counterpart: string | null;
  channel: keyof typeof contactChannelLabel | null;
  occurredAt: string | null;
  authorName: string;
  createdAt: string;
  mentions: string[];
  unresolvedTitle: string | null;
  taskLabel: string | null;
  mine: boolean;
};
type Opt = { id: string; name: string };

/** 本文中の @名前 を強調表示する */
function renderBody(body: string, names: string[]) {
  if (!names.length) return body;
  const compact = names.map((n) => n.replace(/[\s　]+/g, "")).sort((a, b) => b.length - a.length);
  const parts = body.split(/([@＠][^\s　@＠、。,.:：;；!?！？()（）「」]+)/g);
  return parts.map((p, i) =>
    /^[@＠]/.test(p) && compact.some((n) => p.slice(1).startsWith(n)) ? (
      <span key={i} className="rounded bg-brand-100 px-0.5 font-medium text-brand-800">
        {p}
      </span>
    ) : (
      p
    ),
  );
}

export function MessageThread({ messages }: { messages: MessageView[] }) {
  if (!messages.length) return <Empty>やり取りはまだありません。</Empty>;
  return (
    <ol className="flex flex-col gap-3">
      {messages.map((m) => (
        <li key={m.id} className={cx("rounded-md border p-3", m.kind === "CUSTOMER_RECORD" ? "border-sky-200 bg-sky-50/60" : "border-slate-200 bg-white", m.mine && "border-l-4 border-l-brand-600")}>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="text-sm font-semibold text-slate-800">{m.authorName}</span>
            <span>{m.createdAt}</span>
            {m.kind === "CUSTOMER_RECORD" && <Badge className="bg-sky-100 text-sky-800 ring-sky-300">顧客とのやり取り記録</Badge>}
            {m.unresolvedTitle && <Badge className="bg-amber-50 text-amber-800 ring-amber-300">未確定：{m.unresolvedTitle}</Badge>}
            {m.taskLabel && <Badge className="bg-slate-100 text-slate-700 ring-slate-300">タスク：{m.taskLabel}</Badge>}
          </div>
          {m.kind === "CUSTOMER_RECORD" && (
            <div className="mt-1 text-xs text-slate-700">
              相手先：{m.counterpart} ／ {m.channel ? contactChannelLabel[m.channel] : ""} ／ 日時：{m.occurredAt}
            </div>
          )}
          <div className="mt-1 break-words whitespace-pre-wrap">{renderBody(m.body, m.mentions)}</div>
        </li>
      ))}
    </ol>
  );
}

export function MessageForm({
  action,
  users,
  unresolvedItems,
  tasks,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  users: Opt[];
  unresolvedItems: Opt[];
  tasks: Opt[];
}) {
  const [kind, setKind] = useState("INTERNAL");
  const ref = useRef<HTMLTextAreaElement>(null);
  const insertMention = (name: string) => {
    const el = ref.current;
    if (!el) return;
    const tag = `@${name.replace(/[\s　]+/g, "")} `;
    const pos = el.selectionStart ?? el.value.length;
    el.value = el.value.slice(0, pos) + tag + el.value.slice(pos);
    el.focus();
    el.selectionStart = el.selectionEnd = pos + tag.length;
  };
  return (
    <ActionForm action={action} resetOnSuccess className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-4" role="radiogroup" aria-label="投稿の種別">
        <label className="flex items-center gap-1">
          <input type="radio" name="kind" value="INTERNAL" checked={kind === "INTERNAL"} onChange={() => setKind("INTERNAL")} /> 社内連絡
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name="kind" value="CUSTOMER_RECORD" checked={kind === "CUSTOMER_RECORD"} onChange={() => setKind("CUSTOMER_RECORD")} /> 顧客とのやり取り記録（電話・メール・打合せの要旨）
        </label>
      </div>
      {kind === "CUSTOMER_RECORD" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="相手先" required>
            <input name="counterpart" className="input" placeholder="会社名・氏名" />
            <FieldError name="counterpart" />
          </Field>
          <Field label="手段" required>
            <select name="channel" className="input" defaultValue="">
              <option value="">（選択）</option>
              {Object.entries(contactChannelLabel).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <FieldError name="channel" />
          </Field>
          <Field label="日時" required>
            <input type="datetime-local" name="occurredAt" className="input" />
            <FieldError name="occurredAt" />
          </Field>
        </div>
      )}
      <Field label="本文" required hint="「@名前」でメンションすると、その人に通知されます。投稿は削除できません（訂正は追記してください）。">
        <textarea ref={ref} name="body" rows={4} className="input" />
        <FieldError name="body" />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="input max-w-56"
          value=""
          aria-label="メンションする人を挿入"
          onChange={(e) => {
            const u = users.find((x) => x.id === e.target.value);
            if (u) insertMention(u.name);
          }}
        >
          <option value="">＠メンションを挿入…</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        {!!unresolvedItems.length && (
          <select name="unresolvedItemId" className="input max-w-64" defaultValue="" aria-label="紐づける未確定項目">
            <option value="">未確定項目に紐づけない</option>
            {unresolvedItems.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
        {!!tasks.length && (
          <select name="taskId" className="input max-w-64" defaultValue="" aria-label="紐づけるタスク">
            <option value="">タスクに紐づけない</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div>
        <SubmitButton>投稿する</SubmitButton>
      </div>
    </ActionForm>
  );
}
