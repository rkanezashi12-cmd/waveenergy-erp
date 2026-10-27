"use client";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Field } from "@/components/ui";
import { saveSettings } from "./actions";

type Setting = { aiEnabled: boolean; acceptReminderBusinessDays: number; digestDueSoonDays: number };

export function SettingsForm({ setting }: { setting: Setting }) {
  return (
    <ActionForm action={saveSettings} className="grid gap-5">
      <fieldset className="grid gap-2">
        <legend className="text-sm font-semibold text-slate-800">AI下書き</legend>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="aiEnabled" defaultChecked={setting.aiEnabled} className="mt-1" />
          <span>
            AIによる要求仕様書の下書きを使う
            <span className="block text-xs text-slate-500">オフにすると、オーダー作成画面の「AI下書き」の手順を使えなくなります。</span>
          </span>
        </label>
        <FieldError name="aiEnabled" />
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="受入催促までの営業日数" required hint="発令後、この営業日数たっても受入されないと、技術受付と営業担当に再通知します（1〜30。土日を除く）">
          <input name="acceptReminderBusinessDays" type="number" min={1} max={30} className="input" defaultValue={setting.acceptReminderBusinessDays} />
          <FieldError name="acceptReminderBusinessDays" />
        </Field>
        <Field label="毎朝のまとめで「期限が近い」とみなす日数" required hint="期限までこの日数以内の未確定項目・タスクを、毎朝のまとめに載せます（1〜14）">
          <input name="digestDueSoonDays" type="number" min={1} max={14} className="input" defaultValue={setting.digestDueSoonDays} />
          <FieldError name="digestDueSoonDays" />
        </Field>
      </div>
      <div>
        <SubmitButton>保存</SubmitButton>
      </div>
    </ActionForm>
  );
}
