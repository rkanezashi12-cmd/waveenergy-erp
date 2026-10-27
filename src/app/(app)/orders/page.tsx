import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { fmtDate, fmtDay, isOverdue } from "@/lib/dates";
import { orderStatusLabel } from "@/lib/labels";
import { ORDER_STATUSES, parseOrderFilter, searchOrders } from "@/lib/orders/queries";
import { Card, cx, Empty, LinkButton, PageHeader, StatusBadge, Table } from "@/components/ui";

export const metadata: Metadata = { title: "オーダー一覧" };

const PAGE_SIZE = 50;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const filter = parseOrderFilter(sp);
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ total, orders }, categories, salesUsers, techUsers] = await Promise.all([
    searchOrders(user, filter, page, PAGE_SIZE),
    prisma.productCategory.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.user.findMany({ where: { roles: { hasSome: ["SALES", "SALES_MANAGER"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { roles: { has: "TECH" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v && k !== "page") qs.set(k, v);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageLink = (p: number) => `/orders?${new URLSearchParams({ ...Object.fromEntries(qs), page: String(p) })}`;

  return (
    <>
      <PageHeader
        title="オーダー一覧"
        actions={
          <>
            <LinkButton href={`/orders/export?${qs}`} variant="secondary" prefetch={false}>
              CSV出力
            </LinkButton>
            {can.createOrder(user) && <LinkButton href="/orders/new">オーダー作成</LinkButton>}
          </>
        }
      />
      <Card className="mb-4">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="search">
          <input name="q" className="input lg:col-span-2" placeholder="オーダー番号・件名・現場名・顧客名・見積番号" defaultValue={filter.q} aria-label="キーワード" />
          <select name="status" className="input" defaultValue={filter.status} aria-label="ステータス">
            <option value="">すべてのステータス</option>
            <option value="ACTIVE">進行中（完了・取消以外）</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {orderStatusLabel[s]}
              </option>
            ))}
          </select>
          <select name="category" className="input" defaultValue={filter.categoryId} aria-label="製品区分">
            <option value="">すべての製品区分</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select name="sales" className="input" defaultValue={filter.salesUserId} aria-label="営業担当">
            <option value="">営業担当（すべて）</option>
            {salesUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <select name="tech" className="input" defaultValue={filter.techUserId} aria-label="技術担当">
            <option value="">技術担当（すべて）</option>
            {techUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1">
              <input type="checkbox" name="unresolved" value="1" defaultChecked={filter.hasUnresolved} /> 未確定あり
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" name="overdue" value="1" defaultChecked={filter.hasOverdue} /> 期限超過あり
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700">
              検索
            </button>
            <Link href="/orders" className="rounded-md px-3 py-2 text-brand-700 hover:bg-brand-50">
              条件をクリア
            </Link>
          </div>
        </form>
      </Card>
      <Card title={`${total}件`}>
        {orders.length === 0 ? (
          <Empty>該当するオーダーはありません。</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>オーダー番号</th>
                <th>ステータス</th>
                <th>製品区分</th>
                <th>顧客／件名・現場</th>
                <th>営業担当</th>
                <th>技術担当</th>
                <th>契約納期</th>
                <th>未確定</th>
                <th>発令日</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const overdue = o.unresolvedItems.filter((i) => isOverdue(i.dueDate)).length + o.tasks.filter((t) => isOverdue(t.dueDate)).length;
                return (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td>
                      <Link href={`/orders/${o.id}`} className="font-medium text-brand-700 underline">
                        {o.orderNumber}
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                    <td>{o.productCategory?.name}</td>
                    <td className="max-w-80 whitespace-normal">
                      <div className="text-xs text-slate-500">{o.customer?.name}</div>
                      <div>{o.title}</div>
                      <div className="text-xs text-slate-500">{o.siteName ?? o.endUser}</div>
                    </td>
                    <td>{o.salesUser.name}</td>
                    <td>{o.techUser?.name}</td>
                    <td>
                      {fmtDate(o.contractDeliveryDate)}
                      {o.deliveryType === "TENTATIVE" && <span className="ml-1 text-xs text-amber-700">（仮）</span>}
                    </td>
                    <td className={cx(overdue > 0 && "font-bold text-red-700")}>
                      {o.unresolvedItems.length ? `${o.unresolvedItems.length}件` : "―"}
                      {overdue > 0 && <div className="text-xs">期限超過{overdue}件</div>}
                    </td>
                    <td>{fmtDay(o.issuedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {pages > 1 && (
          <nav className="mt-3 flex items-center gap-2" aria-label="ページ">
            {page > 1 && <Link href={pageLink(page - 1)} className="text-brand-700 underline">前へ</Link>}
            <span>
              {page} / {pages}
            </span>
            {page < pages && <Link href={pageLink(page + 1)} className="text-brand-700 underline">次へ</Link>}
          </nav>
        )}
      </Card>
    </>
  );
}
