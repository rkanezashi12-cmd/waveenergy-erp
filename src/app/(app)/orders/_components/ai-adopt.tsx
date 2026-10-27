"use client";
// AI下書き：候補値ごとに採用／修正／却下を選ぶ。採用するまでは要求仕様書に反映しない
import { useState } from "react";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Alert, Badge, cx, Field } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import type { DraftCandidates } from "@/lib/ai/draft";
import { specValueText } from "@/lib/orders/format";
import { SpecInput } from "./spec-form";

type Opt = { id: string; name: string };

function DecisionRow({
  name,
  label,
  candidate,
  candidateText,
  evidence,
  current,
  editor,
  errorName,
}: {
  name: string;
  label: string;
  candidate: string;
  candidateText: string;
  evidence: string;
  current: string;
  editor: React.ReactNode;
  errorName: string;
}) {
  const [decision, setDecision] = useState("adopt");
  return (
    <div className={cx("rounded-md border p-3", decision === "reject" ? "border-slate-200 bg-slate-50 opacity-70" : "border-violet-200 bg-violet-50/40")}>
      <input type="hidden" name={`c_${name}`} value={candidate} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">{label}</div>
        <div className="flex gap-3" role="radiogroup" aria-label={`${label}の扱い`}>
          {[
            ["adopt", "採用"],
            ["modify", "修正して採用"],
            ["reject", "却下"],
          ].map(([v, l]) => (
            <label key={v} className="flex items-center gap-1">
              <input type="radio" name={`d_${name}`} value={v} checked={decision === v} onChange={() => setDecision(v)} /> {l}
            </label>
          ))}
        </div>
      </div>
      <div className="mt-1 whitespace-pre-wrap">
        候補：<span className="font-semibold">{candidateText}</span>
      </div>
      {evidence && <div className="mt-1 text-xs text-slate-600">根拠：{evidence}</div>}
      {current && <div className="mt-1 text-xs text-amber-800">現在の値：{current}（採用すると上書きします）</div>}
      {decision === "modify" && <div className="mt-2">{editor}</div>}
      <FieldError name={errorName} />
    </div>
  );
}

export function AiAdopt({
  data,
  action,
  users,
  salesUserId,
  defaultDue,
}: {
  data: DraftCandidates;
  action: (fd: FormData) => Promise<ActionResult>;
  users: Opt[];
  salesUserId: string;
  defaultDue: string;
}) {
  const [missing, setMissing] = useState<string[]>([]);
  const nothing = !data.basic.length && !data.fields.length && !data.category?.suggestedId;
  return (
    <ActionForm action={action} className="flex flex-col gap-4">
      {data.run.notes && <Alert kind="info">AIのメモ：{data.run.notes}</Alert>}
      {nothing && <Alert kind="warn">資料から読み取れた項目はありませんでした。手入力で進めてください。</Alert>}
      {data.category && (
        <div className="rounded-md border border-violet-200 bg-violet-50/40 p-3">
          <div className="font-medium">製品区分（AIの推定。確定してください）</div>
          {data.category.evidence && <div className="mt-1 text-xs text-slate-600">根拠：{data.category.evidence}</div>}
          <select name="productCategoryId" className="input mt-2 max-w-sm" defaultValue={data.category.suggestedId} aria-label="製品区分">
            <option value="">（未選択のまま）</option>
            {data.category.options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <div className="mt-1 text-xs text-slate-500">推定と異なる区分を選んだ場合、製品区分別項目の候補は反映されません（共通項目は反映されます）。</div>
        </div>
      )}
      {!!data.basic.length && (
        <section className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">基本情報</h3>
          {data.basic.map((b) => (
            <DecisionRow
              key={b.key}
              name={`basic_${b.key}`}
              label={b.label}
              candidate={b.candidate}
              candidateText={b.candidate}
              evidence={b.evidence}
              current={b.current !== b.candidate ? b.current : ""}
              errorName={`basic_${b.key}`}
              editor={<input name={`m_basic_${b.key}`} className="input" defaultValue={b.candidate} type={b.key === "contractDeliveryDate" ? "date" : "text"} aria-label={`${b.label}（修正）`} />}
            />
          ))}
        </section>
      )}
      {!!data.fields.length && (
        <section className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">要求仕様書の項目</h3>
          {data.fields.map((f) => (
            <div key={f.templateId}>
              <input type="hidden" name="fieldIds" value={f.templateId} />
              {f.inputType === "MULTISELECT" && <input type="hidden" name={`multi_${f.templateId}`} value="1" />}
              <DecisionRow
                name={`field_${f.templateId}`}
                label={f.label}
                candidate={f.candidate}
                candidateText={specValueText(f.inputType, f.candidate)}
                evidence={f.evidence}
                current={f.current && f.current !== f.candidate ? specValueText(f.inputType, f.current) : ""}
                errorName={`field_${f.templateId}`}
                editor={
                  <SpecInput
                    t={{ id: f.templateId, label: f.label, inputType: f.inputType, required: false, options: f.options, description: null, defaultResponsibleType: "SALES", common: true }}
                    name={`m_field_${f.templateId}`}
                    value={f.candidate}
                  />
                }
              />
            </div>
          ))}
        </section>
      )}
      {!!data.missing.length && (
        <section className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3">
          <h3 className="text-base font-semibold">資料から読み取れなかった必須項目（未確定項目の候補）</h3>
          <p className="text-slate-600">未確定項目として登録する項目にチェックを入れてください。登録しない項目は、次の「要求仕様書」で入力します。</p>
          {data.missing.map((m) => (
            <label key={m.templateId} className="flex items-center gap-2">
              <input
                type="checkbox"
                name="missing"
                value={m.templateId}
                checked={missing.includes(m.templateId)}
                onChange={(e) => setMissing(e.target.checked ? [...missing, m.templateId] : missing.filter((x) => x !== m.templateId))}
              />
              {m.label}
            </label>
          ))}
          {!!missing.length && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="担当者（チェックした項目すべて）" required>
                <select name="miss_assigneeId" className="input" defaultValue={salesUserId}>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="回答期限" required>
                <input type="date" name="miss_dueDate" className="input" defaultValue={defaultDue} />
              </Field>
              <FieldError name="missing" />
            </div>
          )}
        </section>
      )}
      {!!data.documents.length && (
        <section>
          <h3 className="text-base font-semibold">資料について（参考）</h3>
          <ul className="mt-1 list-disc pl-5 text-slate-700">
            {data.documents.map((d, i) => (
              <li key={i}>
                {d.name}：{d.found ? <Badge className="bg-emerald-50 text-emerald-800 ring-emerald-300">入力資料にあり</Badge> : <Badge className="bg-slate-100 text-slate-600 ring-slate-300">見当たらない</Badge>}
                {d.evidence && <span className="ml-1 text-xs text-slate-500">{d.evidence}</span>}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-slate-500">資料のURL・版数・日付は「資料チェックリスト」で登録してください。</p>
        </section>
      )}
      <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-slate-200 bg-white/95 py-3">
        <SubmitButton pendingText="反映しています…">選んだ内容を反映して次へ</SubmitButton>
      </div>
    </ActionForm>
  );
}
