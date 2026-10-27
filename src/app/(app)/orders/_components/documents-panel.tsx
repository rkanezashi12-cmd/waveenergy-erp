"use client";
// 資料タブ：最新版の表示、版の履歴、新しい版の登録
import { ActionForm, Disclosure, FieldError, SubmitButton } from "@/components/form";
import { Badge, cx, Empty, Field } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import { docRequirementLabel, docStateLabel } from "@/lib/labels";

export type DocPanelItem = {
  id: string | null;
  templateId: string | null;
  name: string;
  requirement: keyof typeof docRequirementLabel | null;
  state: keyof typeof docStateLabel | null;
  naReason: string | null;
  versions: { id: string; url: string; version: string; docDate: string; isLatest: boolean; note: string | null; registeredBy: string; registeredAt: string }[];
};

function VersionForm({ action, documentId, withName }: { action: (fd: FormData) => Promise<ActionResult>; documentId: string | null; withName?: boolean }) {
  return (
    <ActionForm action={action} resetOnSuccess className="grid gap-2 sm:grid-cols-2">
      {documentId && <input type="hidden" name="documentId" value={documentId} />}
      {withName && (
        <Field label="資料名" required className="sm:col-span-2">
          <input name="name" className="input" />
          <FieldError name="name" />
        </Field>
      )}
      <Field label="URL（またはパス）" required className="sm:col-span-2">
        <input name="url" className="input" placeholder="https://… または \\サーバー\共有\…" />
        <FieldError name="url" />
      </Field>
      <Field label="版数" required>
        <input name="version" className="input" />
        <FieldError name="version" />
      </Field>
      <Field label="日付" required>
        <input type="date" name="docDate" className="input" />
        <FieldError name="docDate" />
      </Field>
      <Field label="メモ（変更点など）" className="sm:col-span-2">
        <input name="note" className="input" />
      </Field>
      <div>
        <SubmitButton>登録する</SubmitButton>
      </div>
    </ActionForm>
  );
}

const isUrl = (s: string) => /^https:\/\//i.test(s);

export function DocumentsPanel({ docs, canAdd, action, issued }: { docs: DocPanelItem[]; canAdd: boolean; action: (fd: FormData) => Promise<ActionResult>; issued: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {issued && canAdd && (
        <div className="text-slate-600">新しい版を登録すると、技術担当・関係者に通知されます。旧版は履歴として残ります。</div>
      )}
      {!docs.length && <Empty>資料はまだ登録されていません。</Empty>}
      {docs.map((d) => {
        const latest = d.versions.find((v) => v.isLatest);
        const old = d.versions.filter((v) => !v.isLatest);
        return (
          <div key={d.id ?? d.templateId} className={cx("rounded-md border p-3", d.state === "NOT_OBTAINED" ? "border-amber-300 bg-amber-50/50" : "border-slate-200")}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{d.name}</span>
              {d.requirement && <Badge className="bg-slate-100 text-slate-600 ring-slate-300">{docRequirementLabel[d.requirement]}</Badge>}
              {d.state ? (
                <Badge className={d.state === "ATTACHED" ? "bg-emerald-50 text-emerald-800 ring-emerald-300" : d.state === "NOT_OBTAINED" ? "bg-amber-50 text-amber-800 ring-amber-300" : "bg-slate-100 text-slate-600 ring-slate-300"}>
                  {docStateLabel[d.state]}
                </Badge>
              ) : (
                <Badge className="bg-slate-50 text-slate-400 ring-slate-200">未選択</Badge>
              )}
            </div>
            {d.state === "NOT_APPLICABLE" && <div className="mt-1 text-slate-600">理由：{d.naReason}</div>}
            {latest && (
              <div className="mt-2 rounded bg-emerald-50/60 p-2">
                <Badge className="mr-2 bg-emerald-600 text-white ring-emerald-600">最新</Badge>
                版数 <span className="font-semibold">{latest.version}</span> ／ 日付 {latest.docDate.replaceAll("-", "/")}
                <div className="mt-1 break-all">
                  {isUrl(latest.url) ? (
                    <a href={latest.url} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">
                      {latest.url}
                    </a>
                  ) : (
                    <code className="text-xs">{latest.url}</code>
                  )}
                </div>
                <div className="text-xs text-slate-500">
                  登録：{latest.registeredBy}（{latest.registeredAt}）{latest.note ? `　メモ：${latest.note}` : ""}
                </div>
              </div>
            )}
            {!!old.length && (
              <details className="mt-2">
                <summary className="cursor-pointer text-slate-600">旧版の履歴（{old.length}件）</summary>
                <ul className="mt-1 flex flex-col gap-1 pl-2">
                  {old.map((v) => (
                    <li key={v.id} className="text-slate-500">
                      <span className="line-through">版数 {v.version}</span> ／ {v.docDate.replaceAll("-", "/")} ／ <span className="break-all">{v.url}</span>（{v.registeredBy}、{v.registeredAt}）
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {canAdd && d.id && (
              <div className="mt-2">
                <Disclosure label={latest ? "新しい版を登録" : "資料を登録"}>
                  <VersionForm action={action} documentId={d.id} />
                </Disclosure>
              </div>
            )}
          </div>
        );
      })}
      {canAdd && (
        <Disclosure label="チェックリスト以外の資料を追加">
          <VersionForm action={action} documentId={null} withName />
        </Disclosure>
      )}
    </div>
  );
}
