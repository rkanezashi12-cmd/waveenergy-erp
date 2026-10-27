import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can, hasRole, isSales } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { businessDaysBetween, fmtDate, fmtDateTime, isOverdue } from "@/lib/dates";
import { OPEN_UNRESOLVED } from "@/lib/orders/rules";
import { getSystemSetting } from "@/lib/settings";
import { Card, cx, Empty, LinkButton, OverdueBadge, PageHeader, StatusBadge, TaskBadge, UnresolvedBadge } from "@/components/ui";

export const metadata: Metadata = { title: "ホーム" };

export default async function HomePage() {
  const user = await requireUser();
  const sales = isSales(user);
  const reception = hasRole(user, "TECH_RECEPTION");
  const tech = hasRole(user, "TECH");
  const [drafts, acceptPending, myItems, myTasks, techOrders, mentions, setting] = await Promise.all([
    sales
      ? prisma.order.findMany({
          where: { status: { in: ["DRAFT", "RETURNED"] }, OR: [{ salesUserId: user.id }, { createdById: user.id }] },
          include: { customer: true },
          orderBy: [{ status: "desc" }, { updatedAt: "desc" }],
        })
      : [],
    reception
      ? prisma.order.findMany({
          where: { status: "ACCEPT_PENDING" },
          include: { customer: true, productCategory: true, salesUser: { select: { name: true } }, unresolvedItems: { where: { status: { in: OPEN_UNRESOLVED } }, select: { id: true } } },
          orderBy: { issuedAt: "asc" },
        })
      : [],
    prisma.unresolvedItem.findMany({
      where: { assigneeId: user.id, status: { in: OPEN_UNRESOLVED }, order: { status: { not: "CANCELLED" } } },
      include: { order: { select: { id: true, orderNumber: true, title: true } } },
      orderBy: { dueDate: "asc" },
    }),
    prisma.task.findMany({
      where: { assigneeId: user.id, status: { not: "DONE" }, order: { status: { not: "CANCELLED" } } },
      include: { order: { select: { id: true, orderNumber: true } }, taskType: true, createdBy: { select: { name: true } } },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }],
    }),
    tech
      ? prisma.order.findMany({
          where: { techUserId: user.id, status: { in: ["SPEC_PENDING", "SPEC_FIXED"] } },
          include: { customer: true, unresolvedItems: { where: { status: { in: OPEN_UNRESOLVED } }, select: { id: true, dueDate: true } } },
          orderBy: { acceptedAt: "desc" },
          take: 20,
        })
      : [],
    prisma.notification.findMany({ where: { userId: user.id, type: "MENTION" }, orderBy: { createdAt: "desc" }, take: 5 }),
    getSystemSetting(),
  ]);
  const overdueItems = myItems.filter((i) => isOverdue(i.dueDate));
  const overdueTasks = myTasks.filter((t) => isOverdue(t.dueDate));

  return (
    <>
      <PageHeader title="ホーム" sub={`${user.name} さん`} actions={can.createOrder(user) ? <LinkButton href="/orders/new">オーダー作成</LinkButton> : null} />
      {(overdueItems.length > 0 || overdueTasks.length > 0) && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 font-medium text-red-800" role="alert">
          期限を過ぎている担当分があります：未確定項目 {overdueItems.length}件、タスク {overdueTasks.length}件
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {reception && (
          <Card title={`受入待ち（${acceptPending.length}件）`} className="xl:col-span-2">
            {!acceptPending.length ? (
              <Empty>受入待ちのオーダーはありません。</Empty>
            ) : (
              <ul className="divide-y divide-slate-100">
                {acceptPending.map((o) => {
                  const days = o.issuedAt ? businessDaysBetween(o.issuedAt, new Date()) : 0;
                  const late = days >= setting.acceptReminderBusinessDays;
                  return (
                    <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div>
                        <Link href={`/orders/${o.id}`} className="font-medium text-brand-700 underline">
                          {o.orderNumber}
                        </Link>{" "}
                        {o.productCategory?.name}／{o.customer?.name}／{o.title}
                        <div className="text-xs text-slate-500">
                          営業：{o.salesUser.name}　発令：{fmtDateTime(o.issuedAt)}　未確定 {o.unresolvedItems.length}件
                        </div>
                      </div>
                      <span className={cx("text-sm", late ? "font-bold text-red-700" : "text-slate-600")}>発令から{days}営業日{late && "（受入催促の対象）"}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}
        <Card title={`自分担当の未確定項目（${myItems.length}件）`}>
          {!myItems.length ? (
            <Empty>担当している未確定項目はありません。</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {myItems.map((i) => (
                <li key={i.id} className={cx("py-2", isOverdue(i.dueDate) && "bg-red-50 -mx-4 px-4")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <UnresolvedBadge status={i.status} />
                    {isOverdue(i.dueDate) && <OverdueBadge />}
                    <Link href={`/orders/${i.order.id}?tab=unresolved#unresolved-${i.id}`} className="font-medium text-brand-700 underline">
                      {i.title}
                    </Link>
                  </div>
                  <div className={cx("text-xs", isOverdue(i.dueDate) ? "font-bold text-red-700" : "text-slate-500")}>
                    {i.order.orderNumber} {i.order.title}　期限：{fmtDate(i.dueDate)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`自分担当のタスク（${myTasks.length}件）`}>
          {!myTasks.length ? (
            <Empty>担当しているタスクはありません。</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {myTasks.map((t) => (
                <li key={t.id} className={cx("py-2", isOverdue(t.dueDate) && "bg-red-50 -mx-4 px-4")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <TaskBadge status={t.status} />
                    {isOverdue(t.dueDate) && <OverdueBadge />}
                    <Link href={`/orders/${t.order.id}?tab=tasks`} className="font-medium text-brand-700 underline">
                      {t.taskType.name}
                    </Link>
                    <span className="truncate text-slate-700">{t.content}</span>
                  </div>
                  <div className={cx("text-xs", isOverdue(t.dueDate) ? "font-bold text-red-700" : "text-slate-500")}>
                    {t.order.orderNumber}　依頼：{t.createdBy.name}　期限：{t.dueDate ? fmtDate(t.dueDate) : "なし"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {sales && (
          <Card title={`自分の下書き・差戻し（${drafts.length}件）`}>
            {!drafts.length ? (
              <Empty>下書き・差戻しのオーダーはありません。</Empty>
            ) : (
              <ul className="divide-y divide-slate-100">
                {drafts.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={o.status} />
                      <Link href={o.status === "RETURNED" ? `/orders/${o.id}` : `/orders/${o.id}/edit?step=1`} className="font-medium text-brand-700 underline">
                        {o.orderNumber}
                      </Link>
                      <span>{o.title ?? "（件名未入力）"}</span>
                    </div>
                    <span className="text-xs text-slate-500">更新：{fmtDateTime(o.updatedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {tech && (
          <Card title={`担当オーダー（受入済み・${techOrders.length}件）`}>
            {!techOrders.length ? (
              <Empty>担当しているオーダーはありません。</Empty>
            ) : (
              <ul className="divide-y divide-slate-100">
                {techOrders.map((o) => {
                  const od = o.unresolvedItems.filter((i) => isOverdue(i.dueDate)).length;
                  return (
                    <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={o.status} />
                        <Link href={`/orders/${o.id}`} className="font-medium text-brand-700 underline">
                          {o.orderNumber}
                        </Link>
                        <span>{o.title}</span>
                      </div>
                      <span className={cx("text-xs", od ? "font-bold text-red-700" : "text-slate-500")}>
                        未確定 {o.unresolvedItems.length}件{od ? `（期限超過 ${od}件）` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}
        <Card title="最近のメンション" actions={<Link href="/notifications" className="text-brand-700 underline">通知一覧</Link>}>
          {!mentions.length ? (
            <Empty>メンションはありません。</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {mentions.map((n) => (
                <li key={n.id} className="py-2">
                  <Link href={`/notifications/open/${n.id}`} prefetch={false} className={cx("text-brand-700 underline", !n.readAt && "font-semibold")}>
                    {n.title}
                  </Link>
                  <div className="line-clamp-2 text-xs whitespace-pre-wrap text-slate-600">{n.body}</div>
                  <div className="text-xs text-slate-400">{fmtDateTime(n.createdAt)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
