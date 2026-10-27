import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { fmtDate, isOverdue } from "@/lib/dates";
import { confirmTargetLabel, designImpactLabel, responsibleTypeLabel, unresolvedTargetLabel } from "@/lib/labels";
import { parseUnresolvedFilter, unresolvedReport, unresolvedSummary, type SummaryAxis } from "@/lib/reports";
import { OPEN_UNRESOLVED } from "@/lib/orders/rules";
import { Card, cx, Empty, ForbiddenView, LinkButton, OverdueBadge, PageHeader, Table, UnresolvedBadge } from "@/components/ui";

export const metadata: Metadata = { title: "未確定項目レポート" };

const AXES: [SummaryAxis, string][] = [
  ["month", "月別（登録月）"],
  ["category", "製品区分別"],
  ["department", "営業部署別"],
];

export default async function UnresolvedReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!can.viewReports(user)) return <ForbiddenView />;
  const sp = await searchParams;
  const view = sp.view === "summary" ? "summary" : "list";
  const axis = (AXES.map((a) => a[0]) as string[]).includes(String(sp.axis)) ? (sp.axis as SummaryAxis) : "month";
  const filter = parseUnresolvedFilter(sp);
  const qs = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"));

  const tabs = (
    <div className="mb-4 flex gap-1 border-b border-slate-200">
      {[
        ["list", "未確定項目一覧"],
        ["summary", "未確定項目の集計"],
      ].map(([k, l]) => (
        <Link key={k} href={`/reports/unresolved?view=${k}`} className={cx("-mb-px border-b-2 px-3 py-2", view === k ? "border-brand-600 font-semibold text-brand-700" : "border-transparent text-slate-600")}>
          {l}
        </Link>
      ))}
    </div>
  );

  if (view === "summary") {
    const rows = await unresolvedSummary(user, axis);
    return (
      <>
        <PageHeader title="未確定項目レポート" actions={<LinkButton href={`/reports/unresolved/export?type=summary&axis=${axis}`} variant="secondary" prefetch={false}>CSV出力</LinkButton>} />
        {tabs}
        <div className="mb-3 flex flex-wrap gap-2">
          {AXES.map(([k, l]) => (
            <Link key={k} href={`/reports/unresolved?view=summary&axis=${k}`} className={cx("rounded-full px-3 py-1", axis === k ? "bg-brand-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-300")}>
              {l}
            </Link>
          ))}
        </div>
        <Card>
          {!rows.length ? (
            <Empty>データがありません。</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{AXES.find((a) => a[0] === axis)![1]}</th>
                  <th className="text-right">登録件数</th>
                  <th className="text-right">未確定（現在）</th>
                  <th className="text-right">うち期限超過</th>
                  <th className="text-right">確定件数</th>
                  <th className="text-right">確定までの平均日数</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    <td className="text-right tabular-nums">{r.registered}</td>
                    <td className="text-right tabular-nums">{r.open}</td>
                    <td className={cx("text-right tabular-nums", r.overdue > 0 && "font-bold text-red-700")}>{r.overdue}</td>
                    <td className="text-right tabular-nums">{r.resolved}</td>
                    <td className="text-right tabular-nums">{r.avgDaysToResolve ?? "―"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <p className="mt-3 text-xs text-slate-500">確定までの平均日数は、未確定項目の登録日から確定日までの日数の平均です（取下げは含みません）。取消したオーダーは集計しません。</p>
        </Card>
      </>
    );
  }

  const [items, users, categories] = await Promise.all([
    unresolvedReport(user, filter),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.productCategory.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  const overdueCount = items.filter((i) => OPEN_UNRESOLVED.includes(i.status) && isOverdue(i.dueDate)).length;
  return (
    <>
      <PageHeader title="未確定項目レポート" actions={<LinkButton href={`/reports/unresolved/export?type=list&${qs}`} variant="secondary" prefetch={false}>CSV出力</LinkButton>} />
      {tabs}
      <Card className="mb-4">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="search">
          <input type="hidden" name="view" value="list" />
          <input name="q" className="input" placeholder="オーダー番号・件名・顧客名" defaultValue={filter.q} aria-label="オーダー" />
          <select name="assignee" className="input" defaultValue={filter.assigneeId} aria-label="担当者">
            <option value="">担当者（すべて）</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <select name="responsible" className="input" defaultValue={filter.responsibleType} aria-label="確認担当区分">
            <option value="">確認担当区分（すべて）</option>
            <option value="SALES">営業</option>
            <option value="TECH">技術</option>
          </select>
          <select name="category" className="input" defaultValue={filter.categoryId} aria-label="製品区分">
            <option value="">製品区分（すべて）</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select name="status" className="input" defaultValue={filter.status} aria-label="ステータス">
            <option value="open">未確定・確認中</option>
            <option value="closed">確定・取下げ</option>
            <option value="all">すべて</option>
          </select>
          <label className="flex items-center gap-1">
            <input type="checkbox" name="overdue" value="1" defaultChecked={filter.overdueOnly} /> 期限超過のみ
          </label>
          <div className="flex gap-2">
            <button type="submit" className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700">
              絞り込み
            </button>
            <Link href="/reports/unresolved" className="rounded-md px-3 py-2 text-brand-700 hover:bg-brand-50">
              クリア
            </Link>
          </div>
        </form>
      </Card>
      <Card title={`${items.length}件（期限超過 ${overdueCount}件）`}>
        {!items.length ? (
          <Empty>該当する未確定項目はありません。</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>回答期限</th>
                <th>状態</th>
                <th>オーダー</th>
                <th>製品区分</th>
                <th>対象</th>
                <th>担当者</th>
                <th>確認担当区分</th>
                <th>確認先</th>
                <th>設計への影響</th>
                <th>営業担当</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const od = OPEN_UNRESOLVED.includes(i.status) && isOverdue(i.dueDate);
                return (
                  <tr key={i.id} className={cx(od && "bg-red-50")}>
                    <td className={cx(od && "font-bold text-red-700")}>
                      {fmtDate(i.dueDate)}
                      {od && (
                        <div>
                          <OverdueBadge />
                        </div>
                      )}
                    </td>
                    <td>
                      <UnresolvedBadge status={i.status} />
                    </td>
                    <td>
                      <Link href={`/orders/${i.order.id}?tab=unresolved#unresolved-${i.id}`} className="text-brand-700 underline">
                        {i.order.orderNumber}
                      </Link>
                      <div className="max-w-48 truncate text-xs text-slate-500">{i.order.customer?.name}</div>
                    </td>
                    <td>{i.order.productCategory?.name}</td>
                    <td className="max-w-64 whitespace-normal">
                      <span className="text-xs text-slate-500">{unresolvedTargetLabel[i.targetType]}：</span>
                      {i.title}
                    </td>
                    <td>{i.assignee.name}</td>
                    <td>{responsibleTypeLabel[i.responsibleType]}</td>
                    <td>{confirmTargetLabel[i.confirmTarget]}</td>
                    <td>{designImpactLabel[i.designImpact]}</td>
                    <td>{i.order.salesUser.name}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
