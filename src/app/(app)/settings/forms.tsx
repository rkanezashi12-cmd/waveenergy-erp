"use client";
import { ActionForm, SubmitButton } from "@/components/form";
import { saveEmailPreferenceAction } from "./actions";

const OPTIONS = [
  ["ALL", "すべて受け取る", "発令・受入・割当・メンションなどをその都度メールで受け取り、毎朝のまとめも受け取ります。"],
  ["DIGEST_ONLY", "毎朝のまとめのみ", "その都度のメールは送らず、平日朝のまとめメールだけを受け取ります（アプリ内通知は届きます）。"],
  ["NONE", "受け取らない", "メールは受け取りません（アプリ内通知のみ）。"],
] as const;

export function EmailPreferenceForm({ current }: { current: string }) {
  return (
    <ActionForm action={saveEmailPreferenceAction} className="flex flex-col gap-3">
      {OPTIONS.map(([v, l, d]) => (
        <label key={v} className="flex items-start gap-2">
          <input type="radio" name="emailPreference" value={v} defaultChecked={current === v} className="mt-1" />
          <span>
            <span className="font-medium">{l}</span>
            <span className="block text-slate-500">{d}</span>
          </span>
        </label>
      ))}
      <div>
        <SubmitButton>保存</SubmitButton>
      </div>
    </ActionForm>
  );
}
