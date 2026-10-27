"use client";
// 未確定項目の入力欄（担当区分・担当者・期限など）。要求仕様書・資料・その他で共通に使う
import { useState } from "react";
import { FieldError } from "@/components/form";
import { Field } from "@/components/ui";
import { confirmTargetLabel, designImpactLabel, responsibleTypeLabel } from "@/lib/labels";

export type UserOpt = { id: string; name: string; roles: string[] };

export type UnresolvedDefaults = {
  title?: string;
  knownInfo?: string;
  confirmTarget?: string;
  responsibleType?: string;
  assigneeId?: string;
  dueDate?: string;
  designImpact?: string;
};

export function UnresolvedFields({
  prefix,
  users,
  defaults,
  salesUserId,
  techUserId,
  withTitle,
  errorKey,
}: {
  prefix: string;
  users: UserOpt[];
  defaults: UnresolvedDefaults;
  /** 確認担当区分から担当者の初期値を決めるための、オーダーの営業担当・技術担当 */
  salesUserId?: string | null;
  techUserId?: string | null;
  withTitle?: boolean;
  /** 全体のエラーを表示するキー */
  errorKey?: string;
}) {
  const [resp, setResp] = useState(defaults.responsibleType ?? "SALES");
  const [assignee, setAssignee] = useState(
    defaults.assigneeId ?? ((defaults.responsibleType ?? "SALES") === "SALES" ? salesUserId : techUserId) ?? "",
  );
  const n = (k: string) => `${prefix}${k}`;
  return (
    <div className="grid gap-3 rounded-md border border-amber-200 bg-amber-50/60 p-3 sm:grid-cols-2 lg:grid-cols-3">
      {errorKey && (
        <div className="sm:col-span-2 lg:col-span-3">
          <FieldError name={errorKey} />
        </div>
      )}
      {withTitle && (
        <Field label="対象（何が未確定か）" required className="sm:col-span-2 lg:col-span-3">
          <input name={n("title")} className="input" defaultValue={defaults.title} />
          <FieldError name={n("title")} />
        </Field>
      )}
      <Field label="現状わかっていること" className="sm:col-span-2 lg:col-span-3">
        <textarea name={n("knownInfo")} rows={2} className="input" defaultValue={defaults.knownInfo} />
      </Field>
      <Field label="確認先">
        <select name={n("confirmTarget")} className="input" defaultValue={defaults.confirmTarget ?? "CUSTOMER"}>
          {Object.entries(confirmTargetLabel).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <Field label="確認担当区分">
        <select
          name={n("responsibleType")}
          className="input"
          value={resp}
          onChange={(e) => {
            setResp(e.target.value);
            const def = e.target.value === "SALES" ? salesUserId : techUserId;
            if (def) setAssignee(def);
          }}
        >
          {Object.entries(responsibleTypeLabel).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <Field label="担当者" required>
        <select name={n("assigneeId")} className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">（選択してください）</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <FieldError name={n("assigneeId")} />
      </Field>
      <Field label="回答期限" required>
        <input type="date" name={n("dueDate")} className="input" defaultValue={defaults.dueDate} />
        <FieldError name={n("dueDate")} />
      </Field>
      <Field label="設計への影響">
        <select name={n("designImpact")} className="input" defaultValue={defaults.designImpact ?? "PARTIAL_START"}>
          {Object.entries(designImpactLabel).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}
