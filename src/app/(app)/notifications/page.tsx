import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/dates";
import { emailResultLabel, notificationTypeLabel } from "@/lib/labels";
import { Badge, Card, cx, Empty, PageHeader } from "@/components/ui";
import { MarkAllRead } from "./forms";

export const metadata: Metadata = { title: "通知" };
const PAGE_SIZE = 50;

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ unread?: string; page?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const unreadOnly = sp.unread === "1";
  const page = Math.max(1, Number(sp.page) || 1);
  const where = { userId: user.id, ...(unreadOnly ? { readAt: null } : {}) };
  const [total, unread, list] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <>
      <PageHeader title="通知" sub={`未読 ${unread}件`} actions={unread > 0 ? <MarkAllRead /> : null} />
      <div className="mb-3 flex gap-3">
        <Link href="/notifications" className={cx("rounded-full px-3 py-1", !unreadOnly ? "bg-brand-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-300")}>
          すべて
        </Link>
        <Link href="/notifications?unread=1" className={cx("rounded-full px-3 py-1", unreadOnly ? "bg-brand-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-300")}>
          未読のみ
        </Link>
      </div>
      <Card>
        {!list.length ? (
          <Empty>通知はありません。</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.map((n) => (
              <li key={n.id} className={cx("py-3", !n.readAt && "bg-brand-50/60 -mx-4 px-4")}>
                <Link href={`/notifications/open/${n.id}`} prefetch={false} className="block">
                  <div className="flex flex-wrap items-center gap-2">
                    {!n.readAt && <span className="h-2 w-2 rounded-full bg-brand-600" aria-label="未読" />}
                    <Badge className="bg-slate-100 text-slate-700 ring-slate-300">{notificationTypeLabel[n.type]}</Badge>
                    <span className={cx("text-slate-900", !n.readAt && "font-semibold")}>{n.title}</span>
                  </div>
                  <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-slate-600">{n.body}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    {fmtDateTime(n.createdAt)}　メール：{emailResultLabel[n.emailResult]}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {pages > 1 && (
          <nav className="mt-3 flex gap-3" aria-label="ページ">
            {page > 1 && <Link className="text-brand-700 underline" href={`/notifications?${unreadOnly ? "unread=1&" : ""}page=${page - 1}`}>前へ</Link>}
            <span>{page} / {pages}</span>
            {page < pages && <Link className="text-brand-700 underline" href={`/notifications?${unreadOnly ? "unread=1&" : ""}page=${page + 1}`}>次へ</Link>}
          </nav>
        )}
      </Card>
    </>
  );
}
