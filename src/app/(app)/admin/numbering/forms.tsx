"use client";
import { useRef, useState, useTransition } from "react";
import type { ResetUnit, YearFormat } from "@/generated/prisma/enums";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Field } from "@/components/ui";
import { resetUnitLabel, yearFormatLabel } from "@/lib/labels";
import { previewNumbering, saveNumbering } from "./actions";
import type { RulePreview } from "./preview";

type Rule = { prefix: string; yearFormat: YearFormat; separator: string; digits: number; resetUnit: ResetUnit; fiscalYearStartMonth: number };

const YEAR_FORMATS = Object.keys(yearFormatLabel) as YearFormat[];
const RESET_UNITS = Object.keys(resetUnitLabel) as ResetUnit[];

export function NumberingForm({ rule, initialPreview }: { rule: Rule; initialPreview: RulePreview }) {
  const [preview, setPreview] = useState<{ data?: RulePreview; error?: string }>({ data: initialPreview });
  const [resetUnit, setResetUnit] = useState<ResetUnit>(rule.resetUnit);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 入力を変えるたびに（少し待ってから）次の番号の見込みを取り直す
  const onChange = (e: React.FormEvent<HTMLDivElement>) => {
    const form = (e.target as HTMLElement).closest("form");
    if (!form) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const fd = new FormData(form);
      start(async () => {
        const r = await previewNumbering(fd);
        setPreview(r.ok ? { data: r.data } : { error: r.error });
      });
    }, 300);
  };

  return (
    <ActionForm
      action={saveNumbering}
      className="grid gap-4"
      confirmMessage="採番ルールを変更します。既に発番したオーダーの番号は変わりません。よろしいですか？"
    >
      <div className="grid gap-3 sm:grid-cols-3" onChange={onChange}>
        <Field label="接頭辞" hint="例：WE-（空白不可・10文字以内）">
          <input name="prefix" className="input font-mono" defaultValue={rule.prefix} autoComplete="off" />
          <FieldError name="prefix" />
        </Field>
        <Field label="年の表記" required>
          <select name="yearFormat" className="input" defaultValue={rule.yearFormat}>
            {YEAR_FORMATS.map((y) => (
              <option key={y} value={y}>
                {yearFormatLabel[y]}
              </option>
            ))}
          </select>
          <FieldError name="yearFormat" />
        </Field>
        <Field label="区切り文字" hint="年と連番の間（例：-）。年を含めない場合は使いません">
          <input name="separator" className="input font-mono" defaultValue={rule.separator} autoComplete="off" />
          <FieldError name="separator" />
        </Field>
        <Field label="連番の桁数" required hint="1〜8桁（足りない桁は0で埋めます）">
          <input name="digits" type="number" min={1} max={8} className="input" defaultValue={rule.digits} />
          <FieldError name="digits" />
        </Field>
        <Field label="リセット単位" required>
          <select name="resetUnit" className="input" defaultValue={rule.resetUnit} onChange={(e) => setResetUnit(e.target.value as ResetUnit)}>
            {RESET_UNITS.map((r) => (
              <option key={r} value={r}>
                {resetUnitLabel[r]}
              </option>
            ))}
          </select>
          <FieldError name="resetUnit" />
        </Field>
        <Field
          label="年度の開始月"
          required
          hint={resetUnit === "FISCAL_YEAR" ? "年度でリセットするときに使います。番号の年は年度になります" : "年度でリセットするときだけ使います"}
        >
          <select name="fiscalYearStartMonth" className="input" defaultValue={rule.fiscalYearStartMonth}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {m}月
              </option>
            ))}
          </select>
          <FieldError name="fiscalYearStartMonth" />
        </Field>
      </div>

      <div className="rounded-md border border-brand-100 bg-brand-50 p-3" aria-live="polite">
        <div className="text-sm font-medium text-slate-700">
          この設定で次に採番される番号{pending && <span className="ml-2 text-xs text-slate-500">確認中…</span>}
        </div>
        {preview.error ? (
          <div className="mt-1 text-sm font-medium text-red-700">{preview.error}</div>
        ) : preview.data ? (
          <>
            <div className="mt-1 font-mono text-2xl font-bold text-brand-800" data-testid="numbering-preview">
              {preview.data.next ?? "採番できません"}
            </div>
            <div className="mt-1 text-xs text-slate-600">
              リセット単位のキー：<span className="font-mono">{preview.data.periodKey}</span>／現在値：{preview.data.current}
              {preview.data.currentNumber && (
                <>
                  （最後に採番した番号：<span className="font-mono">{preview.data.currentNumber}</span>）
                </>
              )}
              {preview.data.skipped > 0 && <>／既存のオーダー番号と重なる{preview.data.skipped}件を飛ばします</>}
            </div>
          </>
        ) : null}
      </div>

      <div>
        <SubmitButton>保存</SubmitButton>
      </div>
    </ActionForm>
  );
}
