"use client";
// 未確定項目の一覧と操作（確定・取下げ・更新）
import { ActionForm, Disclosure, FieldError, SubmitButton } from "@/components/form";
import { Badge, cx, Empty, Field, OverdueBadge, UnresolvedBadge } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import type { UnresolvedStatus } from "@/generated/prisma/enums";
import { confirmTargetLabel, designImpactLabel, responsibleTypeLabel, unresolvedTargetLabel } from "@/lib/labels";
import { UnresolvedFields, type UserOpt } from "./unresolved-fields";
import { SpecInput, type SpecTemplateView } from "./spec-form";

export type UnresolvedItemView = {
  id: string;
  targetType: keyof typeof unresolvedTargetLabel;
  title: string;
  knownInfo: string | null;
  confirmTarget: keyof typeof confirmTargetLabel;
  responsibleType: keyof typeof responsibleTypeLabel;
  assigneeId: string;
  assigneeName: string;
  dueDate: string;
  designImpact: keyof typeof designImpactLabel;
  status: UnresolvedStatus;
  resolution: string | null;
  resolvedDate: string | null;
  resolvedByName: string | null;
  createdByName: string;
  createdAt: string;
  overdue: boolean;
  /** 対象が仕様項目のときのテンプレートと現在の値 */
  specTemplate: SpecTemplateView | null;
  specValue: string | null;
  canUpdate: boolean;
};

type Actions = {
  update: (id: string, fd: FormData) => Promise<ActionResult>;
  resolve: (id: string, fd: FormData) => Promise<ActionResult>;
  withdraw: (id: string, fd: FormData) => Promise<ActionResult>;
};

function ResolveForm({ item, action, todayStr }: { item: UnresolvedItemView; action: Actions["resolve"]; todayStr: string }) {
  return (
    <ActionForm action={action.bind(null, item.id)} className="flex flex-col gap-3">
      <Field label="確定内容" required>
        <textarea name="resolution" rows={2} className="input" placeholder="誰に何を確認し、どう決まったか" />
        <FieldError name="resolution" />
      </Field>
      <Field label="確定日" required>
        <input type="date" name="resolvedDate" className="input max-w-xs" defaultValue={todayStr} />
      </Field>
      {item.targetType === "SPEC_FIELD" && item.specTemplate && (
        <div className="rounded-md border border-sky-200 bg-sky-50 p-3">
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" name="applySpec" value="1" defaultChecked /> 要求仕様書の「{item.specTemplate.label}」に反映する
          </label>
          <div className="mt-2">
            <SpecInput t={item.specTemplate} name="specValue" value={item.specValue} />
            <FieldError name="specValue" />
          </div>
        </div>
      )}
      {item.targetType === "DELIVERY" && (
        <Field label="確定した契約納期" required hint="基本情報の契約納期に反映し、納期区分を「確定」にします。">
          <input type="date" name="deliveryDate" className="input max-w-xs" />
          <FieldError name="deliveryDate" />
        </Field>
      )}
      {item.targetType === "DOCUMENT" && (
        <div className="rounded-md border border-sky-200 bg-sky-50 p-3">
          <div className="font-medium">資料を入手した場合は、URL・版数・日付を入力すると資料を登録して確定します（確定内容は自動で記録）。</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_8rem_10rem]">
            <input name="url" className="input" placeholder="https://… または \\サーバー\共有\…" aria-label="URL" />
            <input name="version" className="input" placeholder="版数" aria-label="版数" />
            <input type="date" name="docDate" className="input" aria-label="日付" />
          </div>
          <FieldError name="url" />
          <FieldError name="version" />
          <FieldError name="docDate" />
        </div>
      )}
      <div>
        <SubmitButton>確定する</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function UnresolvedList({
  items,
  users,
  actions,
  todayStr,
  salesUserId,
  techUserId,
  showClosed = true,
}: {
  items: UnresolvedItemView[];
  users: UserOpt[];
  actions: Actions;
  todayStr: string;
  salesUserId: string;
  techUserId: string | null;
  showClosed?: boolean;
}) {
  const list = showClosed ? items : items.filter((i) => i.status === "OPEN" || i.status === "CHECKING");
  if (!list.length) return <Empty>未確定項目はありません。</Empty>;
  const open = list.filter((i) => i.status === "OPEN" || i.status === "CHECKING").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const closed = list.filter((i) => !(i.status === "OPEN" || i.status === "CHECKING"));
  return (
    <div className="flex flex-col gap-3">
      {[...open, ...closed].map((it) => {
        const isOpen = it.status === "OPEN" || it.status === "CHECKING";
        return (
          <div key={it.id} id={`unresolved-${it.id}`} className={cx("rounded-md border p-3", it.overdue ? "border-red-300 bg-red-50/60" : isOpen ? "border-amber-200 bg-white" : "border-slate-200 bg-slate-50")}>
            <div className="flex flex-wrap items-center gap-2">
              <UnresolvedBadge status={it.status} />
              {it.overdue && <OverdueBadge />}
              <Badge className="bg-slate-100 text-slate-600 ring-slate-300">{unresolvedTargetLabel[it.targetType]}</Badge>
              <span className="font-semibold">{it.title}</span>
            </div>
            <div className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div>
                担当：<span className="font-medium">{it.assigneeName}</span>（{responsibleTypeLabel[it.responsibleType]}）
              </div>
              <div className={cx(it.overdue && "font-bold text-red-700")}>回答期限：{it.dueDate.replaceAll("-", "/")}</div>
              <div>確認先：{confirmTargetLabel[it.confirmTarget]}</div>
              <div>設計への影響：{designImpactLabel[it.designImpact]}</div>
              <div className="text-slate-500">
                登録：{it.createdByName}（{it.createdAt}）
              </div>
            </div>
            {it.knownInfo && <div className="mt-1 whitespace-pre-wrap text-slate-700">現状：{it.knownInfo}</div>}
            {!isOpen && (
              <div className="mt-2 rounded bg-white p-2 text-slate-700">
                {it.status === "RESOLVED" ? "確定内容" : "取下げ理由"}：<span className="whitespace-pre-wrap">{it.resolution}</span>
                <span className="ml-2 text-xs text-slate-500">
                  {it.resolvedDate ? it.resolvedDate.replaceAll("-", "/") : ""} {it.resolvedByName}
                </span>
              </div>
            )}
            {isOpen && it.canUpdate && (
              <div className="mt-3 flex flex-wrap items-start gap-2">
                <Disclosure label="確定する" variant="primary">
                  <ResolveForm item={it} action={actions.resolve} todayStr={todayStr} />
                </Disclosure>
                <Disclosure label="担当・期限などを変更">
                  <ActionForm action={actions.update.bind(null, it.id)} className="flex flex-col gap-3">
                    <Field label="ステータス">
                      <select name="status" className="input max-w-xs" defaultValue={it.status}>
                        <option value="OPEN">未確定</option>
                        <option value="CHECKING">確認中</option>
                      </select>
                    </Field>
                    <UnresolvedFields
                      prefix=""
                      users={users}
                      salesUserId={salesUserId}
                      techUserId={techUserId}
                      withTitle={it.targetType === "OTHER"}
                      defaults={{
                        title: it.title,
                        knownInfo: it.knownInfo ?? "",
                        confirmTarget: it.confirmTarget,
                        responsibleType: it.responsibleType,
                        assigneeId: it.assigneeId,
                        dueDate: it.dueDate,
                        designImpact: it.designImpact,
                      }}
                    />
                    <div>
                      <SubmitButton>変更を保存</SubmitButton>
                    </div>
                  </ActionForm>
                </Disclosure>
                <Disclosure label="取り下げる" variant="ghost">
                  <ActionForm action={actions.withdraw.bind(null, it.id)} className="flex flex-col gap-2">
                    <Field label="取下げの理由" required>
                      <input name="reason" className="input" />
                      <FieldError name="reason" />
                    </Field>
                    <div>
                      <SubmitButton variant="danger">取り下げる</SubmitButton>
                    </div>
                  </ActionForm>
                </Disclosure>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function NewUnresolvedForm({
  action,
  users,
  salesUserId,
  techUserId,
  defaultDue,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  users: UserOpt[];
  salesUserId: string;
  techUserId: string | null;
  defaultDue: string;
}) {
  return (
    <ActionForm action={action} resetOnSuccess className="flex flex-col gap-3">
      <UnresolvedFields prefix="" users={users} salesUserId={salesUserId} techUserId={techUserId} withTitle defaults={{ responsibleType: "SALES", dueDate: defaultDue }} />
      <div>
        <SubmitButton>未確定項目を登録</SubmitButton>
      </div>
    </ActionForm>
  );
}
