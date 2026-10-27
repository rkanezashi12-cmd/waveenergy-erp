"use client";
// ①基本情報・発番
import { useState } from "react";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Alert, Field } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";

export type BasicDefaults = {
  productCategoryId: string;
  customerName: string;
  siteName: string;
  endUser: string;
  title: string;
  quantity: string;
  quantityUnit: string;
  salesUserId: string;
  salesDepartmentId: string;
  contractDeliveryDate: string;
  deliveryType: string;
  deliveryFixDueDate: string;
  shortLeadConsulted: string;
  shortLeadNote: string;
  orderDocType: string;
  quoteNumber: string;
  inquiryNumber: string;
};

type Option = { id: string; name: string };

/** 短納期の見込み（サーバー側でも発令時に判定し直す） */
function isShort(contract: string, months: number | null, todayStr: string) {
  if (!contract || !months) return false;
  const base = new Date(todayStr + "T00:00:00Z");
  const day = base.getUTCDate();
  base.setUTCDate(1);
  base.setUTCMonth(base.getUTCMonth() + months);
  const last = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(day, last));
  return new Date(contract + "T00:00:00Z").getTime() < base.getTime();
}

export function BasicForm({
  action,
  mode,
  defaults,
  categories,
  customers,
  salesUsers,
  departments,
  canManualNumber,
  todayStr,
  orderNumber,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  mode: "create" | "edit";
  defaults: BasicDefaults;
  categories: (Option & { months: number | null })[];
  customers: string[];
  salesUsers: (Option & { departmentId: string | null })[];
  departments: Option[];
  canManualNumber: boolean;
  todayStr: string;
  orderNumber?: string;
}) {
  const [categoryId, setCategoryId] = useState(defaults.productCategoryId);
  const [contract, setContract] = useState(defaults.contractDeliveryDate);
  const [deliveryType, setDeliveryType] = useState(defaults.deliveryType);
  const [orderDocType, setOrderDocType] = useState(defaults.orderDocType);
  const [salesDept, setSalesDept] = useState(defaults.salesDepartmentId);
  const [useManual, setUseManual] = useState(false);
  const months = categories.find((c) => c.id === categoryId)?.months ?? null;
  const short = isShort(contract, months, todayStr);

  return (
    <ActionForm action={action} className="flex flex-col gap-5">
      {mode === "create" && (
        <div className="rounded-md border border-brand-100 bg-brand-50 p-3">
          <div className="font-medium">オーダー番号</div>
          <div className="mt-1 text-slate-600">「発番して保存」を押すと、採番ルールに従ってオーダー番号を自動で採番します。</div>
          {canManualNumber && (
            <div className="mt-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={useManual} onChange={(e) => setUseManual(e.target.checked)} />
                既存の番号で登録する（移行期間用。管理者・営業管理職のみ）
              </label>
              {useManual && (
                <div className="mt-2 max-w-xs">
                  <input name="manualNumber" className="input" placeholder="既存のオーダー番号" aria-label="既存のオーダー番号" />
                  <FieldError name="manualNumber" />
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {mode === "edit" && orderNumber && <div className="text-slate-600">オーダー番号：<span className="font-semibold text-slate-900">{orderNumber}</span></div>}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="製品区分" required htmlFor="productCategoryId" hint="区分により要求仕様書の製品別項目と資料チェックリストが切り替わります。AI下書きで推定することもできます。">
          <select id="productCategoryId" name="productCategoryId" className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">（未選択）</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="顧客名" required htmlFor="customerName" hint="一覧から選ぶか、新しい顧客名を入力します（新しい名前は顧客マスタに登録されます）。">
          <input id="customerName" name="customerName" className="input" list="customer-list" defaultValue={defaults.customerName} autoComplete="off" />
          <datalist id="customer-list">
            {customers.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="現場名" required htmlFor="siteName" hint="現場名またはエンドユーザーのどちらかは必須です。">
          <input id="siteName" name="siteName" className="input" defaultValue={defaults.siteName} />
        </Field>
        <Field label="エンドユーザー" htmlFor="endUser">
          <input id="endUser" name="endUser" className="input" defaultValue={defaults.endUser} />
        </Field>
        <Field label="件名" required htmlFor="title" className="md:col-span-2">
          <input id="title" name="title" className="input" defaultValue={defaults.title} />
        </Field>
        <Field label="数量（面数・台数）" required htmlFor="quantity">
          <div className="flex gap-2">
            <input id="quantity" name="quantity" type="number" min="0" step="any" className="input" defaultValue={defaults.quantity} />
            <input name="quantityUnit" className="input max-w-24" placeholder="単位" aria-label="単位" defaultValue={defaults.quantityUnit} list="unit-list" />
            <datalist id="unit-list">
              <option value="面" />
              <option value="台" />
              <option value="式" />
            </datalist>
          </div>
          <FieldError name="quantity" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="営業担当" required htmlFor="salesUserId">
            <select
              id="salesUserId"
              name="salesUserId"
              className="input"
              defaultValue={defaults.salesUserId}
              onChange={(e) => {
                const u = salesUsers.find((s) => s.id === e.target.value);
                if (u?.departmentId) setSalesDept(u.departmentId);
              }}
            >
              {salesUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <FieldError name="salesUserId" />
          </Field>
          <Field label="営業部署" required htmlFor="salesDepartmentId">
            <select id="salesDepartmentId" name="salesDepartmentId" className="input" value={salesDept} onChange={(e) => setSalesDept(e.target.value)}>
              <option value="">（未選択）</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="契約納期" required htmlFor="contractDeliveryDate">
          <input id="contractDeliveryDate" name="contractDeliveryDate" type="date" className="input" value={contract} onChange={(e) => setContract(e.target.value)} />
          <FieldError name="contractDeliveryDate" />
        </Field>
        <Field label="納期区分" required>
          <div className="flex gap-4 py-2">
            {[
              ["FIXED", "確定"],
              ["TENTATIVE", "仮"],
            ].map(([v, l]) => (
              <label key={v} className="flex items-center gap-1">
                <input type="radio" name="deliveryType" value={v} checked={deliveryType === v} onChange={() => setDeliveryType(v)} /> {l}
              </label>
            ))}
          </div>
        </Field>
        {deliveryType === "TENTATIVE" && (
          <Field label="確定予定日" required htmlFor="deliveryFixDueDate" hint="納期区分が「仮」のため、確定予定日を期限として納期の未確定項目を自動で作ります。" className="md:col-span-2">
            <input id="deliveryFixDueDate" name="deliveryFixDueDate" type="date" className="input max-w-xs" defaultValue={defaults.deliveryFixDueDate} />
            <FieldError name="deliveryFixDueDate" />
          </Field>
        )}
        {short && (
          <div className="flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 md:col-span-2">
            <div className="font-semibold text-amber-900">短納期：契約納期が標準納期（{months}か月）より短くなっています。</div>
            <Field label="関係部門と事前協議済みか" required>
              <div className="flex gap-4">
                <label className="flex items-center gap-1">
                  <input type="radio" name="shortLeadConsulted" value="true" defaultChecked={defaults.shortLeadConsulted === "true"} /> 協議済み
                </label>
                <label className="flex items-center gap-1">
                  <input type="radio" name="shortLeadConsulted" value="false" defaultChecked={defaults.shortLeadConsulted === "false"} /> 未協議
                </label>
              </div>
            </Field>
            <Field label="協議の内容（相手・日付など）" htmlFor="shortLeadNote">
              <input id="shortLeadNote" name="shortLeadNote" className="input" defaultValue={defaults.shortLeadNote} />
            </Field>
          </div>
        )}
        <Field label="注文書／内示書" required className="md:col-span-2">
          <div className="flex gap-4 py-2">
            {[
              ["PURCHASE_ORDER", "注文書で発令"],
              ["LETTER_OF_INTENT", "内示書で発令"],
            ].map(([v, l]) => (
              <label key={v} className="flex items-center gap-1">
                <input type="radio" name="orderDocType" value={v} checked={orderDocType === v} onChange={() => setOrderDocType(v)} /> {l}
              </label>
            ))}
          </div>
          {orderDocType === "LETTER_OF_INTENT" && (
            <Alert kind="warn">内示書での発令です。キャンセルされて在庫が残った事例があります。注文書の入手予定を確認してください。</Alert>
          )}
        </Field>
        <Field label="見積番号" htmlFor="quoteNumber">
          <input id="quoteNumber" name="quoteNumber" className="input" defaultValue={defaults.quoteNumber} />
        </Field>
        <Field label="引合番号" htmlFor="inquiryNumber">
          <input id="inquiryNumber" name="inquiryNumber" className="input" defaultValue={defaults.inquiryNumber} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        {mode === "create" ? (
          <SubmitButton pendingText="発番しています…">発番して保存</SubmitButton>
        ) : (
          <>
            <SubmitButton name="intent" value="save" variant="secondary">
              保存
            </SubmitButton>
            <SubmitButton name="intent" value="next">
              保存して次へ
            </SubmitButton>
          </>
        )}
      </div>
    </ActionForm>
  );
}
