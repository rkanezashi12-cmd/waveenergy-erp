"use client";
// ④資料チェックリスト
import { useState } from "react";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Badge, cx } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import { docRequirementLabel } from "@/lib/labels";
import { UnresolvedFields, type UnresolvedDefaults, type UserOpt } from "./unresolved-fields";

export type DocTemplateView = { id: string; name: string; requirement: "REQUIRED" | "CONDITIONAL" | "OPTIONAL"; description: string | null; defaultResponsibleType: string };
export type DocView = {
  state: string | null;
  naReason: string | null;
  latest: { url: string; version: string; docDate: string } | null;
  historyCount: number;
};

const reqColor = {
  REQUIRED: "bg-red-50 text-red-700 ring-red-300",
  CONDITIONAL: "bg-amber-50 text-amber-800 ring-amber-300",
  OPTIONAL: "bg-slate-100 text-slate-600 ring-slate-300",
};

function DocRow({ t, d, openItem, users, salesUserId, techUserId, defaultDue }: { t: DocTemplateView; d: DocView | null; openItem: UnresolvedDefaults | null; users: UserOpt[]; salesUserId: string; techUserId: string | null; defaultDue: string }) {
  const [state, setState] = useState(d?.state ?? "");
  const options: [string, string][] = [
    ["ATTACHED", "添付済み"],
    ["NOT_OBTAINED", "未入手"],
    ["NOT_APPLICABLE", "該当なし"],
  ];
  if (t.requirement === "OPTIONAL" || !d?.state) options.push(["", "未選択"]);
  return (
    <div className={cx("border-b border-slate-100 py-4", state === "NOT_OBTAINED" && "bg-amber-50/40")} data-doc={t.name}>
      <input type="hidden" name="templateIds" value={t.id} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">
          {t.name}
          <Badge className={cx("ml-2", reqColor[t.requirement])}>{docRequirementLabel[t.requirement]}</Badge>
        </div>
        <div className="flex flex-wrap gap-3" role="radiogroup" aria-label={`${t.name}の状態`}>
          {options.map(([v, l]) => (
            <label key={v} className="flex items-center gap-1">
              <input type="radio" name={`dstate_${t.id}`} value={v} checked={state === v} onChange={() => setState(v)} /> {l}
            </label>
          ))}
        </div>
      </div>
      {t.description && <div className="mt-1 text-xs text-slate-500">{t.description}</div>}
      {state === "ATTACHED" && (
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_8rem_10rem]">
          <div>
            <input name={`url_${t.id}`} className="input" placeholder="https://… または \\サーバー\共有\…" defaultValue={d?.latest?.url ?? ""} aria-label={`${t.name}のURL（またはパス）`} />
            <FieldError name={`url_${t.id}`} />
          </div>
          <div>
            <input name={`version_${t.id}`} className="input" placeholder="版数" defaultValue={d?.latest?.version ?? ""} aria-label={`${t.name}の版数`} />
            <FieldError name={`version_${t.id}`} />
          </div>
          <div>
            <input type="date" name={`docDate_${t.id}`} className="input" defaultValue={d?.latest?.docDate ?? ""} aria-label={`${t.name}の日付`} />
            <FieldError name={`docDate_${t.id}`} />
          </div>
          {d?.latest && (
            <div className="text-xs text-slate-500 sm:col-span-3">
              URL・版数・日付を変えて保存すると新しい版として登録し、旧版は履歴に残ります（登録済みの版：{d.historyCount}件）。
            </div>
          )}
        </div>
      )}
      {state === "NOT_APPLICABLE" && (
        <div className="mt-2">
          <input name={`na_${t.id}`} className="input" placeholder="該当なしの理由（必須）" defaultValue={d?.naReason ?? ""} aria-label={`${t.name}を該当なしにする理由`} />
          <FieldError name={`na_${t.id}`} />
        </div>
      )}
      {state === "NOT_OBTAINED" && (
        <div className="mt-2">
          <div className="mb-1 text-xs text-slate-600">未入手の資料は未確定項目として登録し、入手の担当と期限を決めます。</div>
          <UnresolvedFields
            prefix={`un_${t.id}_`}
            users={users}
            salesUserId={salesUserId}
            techUserId={techUserId}
            errorKey={`un_${t.id}`}
            defaults={openItem ?? { responsibleType: t.defaultResponsibleType, dueDate: defaultDue }}
          />
        </div>
      )}
    </div>
  );
}

export function DocsForm({
  action,
  templates,
  docs,
  openItems,
  users,
  salesUserId,
  techUserId,
  defaultDue,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  templates: DocTemplateView[];
  docs: Record<string, DocView>;
  openItems: Record<string, UnresolvedDefaults>;
  users: UserOpt[];
  salesUserId: string;
  techUserId: string | null;
  defaultDue: string;
}) {
  return (
    <ActionForm action={action} className="flex flex-col gap-2">
      <p className="text-slate-600">
        資料ごとに「添付済み（URL・版数・日付）」「未入手」「該当なし（理由）」を選びます。必須・条件付きの資料は空欄のままでは発令できません。アプリはファイル本体を保管しません。保管場所のURL（またはファイルサーバーのパス）を登録してください。
      </p>
      {templates.map((t) => (
        <DocRow key={t.id} t={t} d={docs[t.id] ?? null} openItem={openItems[t.id] ?? null} users={users} salesUserId={salesUserId} techUserId={techUserId} defaultDue={defaultDue} />
      ))}
      <div className="sticky bottom-0 mt-4 flex flex-wrap gap-2 border-t border-slate-200 bg-white/95 py-3">
        <SubmitButton name="intent" value="prev" variant="secondary">
          保存して前へ
        </SubmitButton>
        <SubmitButton name="intent" value="save" variant="secondary">
          保存
        </SubmitButton>
        <SubmitButton name="intent" value="next">
          保存して次へ
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
