"use client";
// ③要求仕様書
import { useState } from "react";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Badge, cx } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import { parseMulti } from "@/lib/orders/format";
import { UnresolvedFields, type UnresolvedDefaults, type UserOpt } from "./unresolved-fields";

export type SpecTemplateView = {
  id: string;
  label: string;
  inputType: string;
  required: boolean;
  options: string[];
  description: string | null;
  defaultResponsibleType: string;
  common: boolean;
};

export type SpecValueView = { state: string | null; value: string | null; naReason: string | null; aiDerived: boolean };


/** 入力形式に応じた入力欄 */
export function SpecInput({ t, name, value, disabled }: { t: SpecTemplateView; name: string; value: string | null; disabled?: boolean }) {
  const [none, setNone] = useState(value === "なし");
  switch (t.inputType) {
    case "TEXT":
      return <input name={name} className="input" defaultValue={value ?? ""} disabled={disabled} aria-label={t.label} />;
    case "NUMBER":
      return <input name={name} type="number" step="any" className="input max-w-xs" defaultValue={value ?? ""} disabled={disabled} aria-label={t.label} />;
    case "DATE":
      return <input name={name} type="date" className="input max-w-xs" defaultValue={value ?? ""} disabled={disabled} aria-label={t.label} />;
    case "SELECT":
      return (
        <select name={name} className="input max-w-md" defaultValue={value ?? ""} disabled={disabled} aria-label={t.label}>
          <option value="">（選択してください）</option>
          {t.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          {value && !t.options.includes(value) && <option value={value}>{value}</option>}
        </select>
      );
    case "MULTISELECT": {
      const selected = parseMulti(value);
      const opts = [...t.options, ...selected.filter((s) => !t.options.includes(s))];
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {opts.map((o) => (
            <label key={o} className="flex items-center gap-1">
              <input type="checkbox" name={name} value={o} defaultChecked={selected.includes(o)} disabled={disabled} /> {o}
            </label>
          ))}
        </div>
      );
    }
    case "TEXTAREA_NONE":
      return (
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={none} onChange={(e) => setNone(e.target.checked)} disabled={disabled} /> なし（変更なし）
          </label>
          {none ? (
            <input type="hidden" name={name} value="なし" />
          ) : (
            <textarea name={name} rows={3} className="input" defaultValue={value === "なし" ? "" : value ?? ""} disabled={disabled} aria-label={t.label} />
          )}
        </div>
      );
    default:
      return <textarea name={name} rows={3} className="input" defaultValue={value ?? ""} disabled={disabled} aria-label={t.label} />;
  }
}

function SpecRow({
  t,
  v,
  openItem,
  users,
  salesUserId,
  techUserId,
  defaultDue,
}: {
  t: SpecTemplateView;
  v: SpecValueView | null;
  openItem: UnresolvedDefaults | null;
  users: UserOpt[];
  salesUserId: string;
  techUserId: string | null;
  defaultDue: string;
}) {
  const [state, setState] = useState(v?.state ?? "FILLED");
  return (
    <div className={cx("border-b border-slate-100 py-4", state === "UNRESOLVED" && "bg-amber-50/40")} id={`spec-${t.id}`} data-spec={t.label}>
      <input type="hidden" name="templateIds" value={t.id} />
      {t.inputType === "MULTISELECT" && <input type="hidden" name={`multi_${t.id}`} value="1" />}
      {v?.aiDerived && <input type="hidden" name={`ai_${t.id}`} value="1" />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium text-slate-800">
          {t.label}
          {t.required ? <span className="ml-1 rounded bg-red-100 px-1 text-xs text-red-700">必須</span> : <span className="ml-1 text-xs text-slate-400">任意</span>}
          {v?.aiDerived && <Badge className="ml-2 bg-violet-50 text-violet-700 ring-violet-300">AI下書き</Badge>}
        </div>
        <div className="flex gap-3 text-sm" role="radiogroup" aria-label={`${t.label}の状態`}>
          {[
            ["FILLED", "入力"],
            ["UNRESOLVED", "未確定"],
            ["NOT_APPLICABLE", "該当なし"],
          ].map(([val, l]) => (
            <label key={val} className="flex items-center gap-1">
              <input type="radio" name={`state_${t.id}`} value={val} checked={state === val} onChange={() => setState(val)} /> {l}
            </label>
          ))}
        </div>
      </div>
      {t.description && <div className="mt-1 text-xs text-slate-500">{t.description}</div>}
      <div className="mt-2">
        {state === "NOT_APPLICABLE" ? (
          <>
            <input name={`na_${t.id}`} className="input" placeholder="該当なしの理由（必須）" defaultValue={v?.naReason ?? ""} aria-label={`${t.label}を該当なしにする理由`} />
            <FieldError name={`na_${t.id}`} />
          </>
        ) : (
          <>
            {state === "UNRESOLVED" && <div className="mb-1 text-xs text-slate-500">わかっている範囲の値があれば入力できます（任意）。</div>}
            <SpecInput t={t} name={`value_${t.id}`} value={v?.value ?? null} />
          </>
        )}
        {state === "UNRESOLVED" && (
          <div className="mt-2">
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
    </div>
  );
}

export function SpecForm({
  action,
  templates,
  values,
  openItems,
  users,
  salesUserId,
  techUserId,
  defaultDue,
  categoryName,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  templates: SpecTemplateView[];
  values: Record<string, SpecValueView>;
  openItems: Record<string, UnresolvedDefaults>;
  users: UserOpt[];
  salesUserId: string;
  techUserId: string | null;
  defaultDue: string;
  categoryName: string | null;
}) {
  const common = templates.filter((t) => t.common);
  const specific = templates.filter((t) => !t.common);
  const row = (t: SpecTemplateView) => (
    <SpecRow key={t.id} t={t} v={values[t.id] ?? null} openItem={openItems[t.id] ?? null} users={users} salesUserId={salesUserId} techUserId={techUserId} defaultDue={defaultDue} />
  );
  return (
    <ActionForm action={action} className="flex flex-col gap-2">
      <p className="text-slate-600">
        各項目を「入力」「未確定」「該当なし」のいずれかにします。必須項目は空欄のままでは発令できません。未確定にした項目は、確認担当・担当者・回答期限を入れて未確定項目として登録します。
      </p>
      <h3 className="mt-2 text-base font-semibold">共通項目</h3>
      {common.map(row)}
      <h3 className="mt-4 text-base font-semibold">製品区分別項目{categoryName ? `（${categoryName}）` : ""}</h3>
      {specific.length ? specific.map(row) : <div className="py-2 text-slate-500">{categoryName ? "この製品区分の個別項目はありません。" : "製品区分を選ぶと表示されます。"}</div>}
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
