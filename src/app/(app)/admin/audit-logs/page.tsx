import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { auditActionLabel } from "@/lib/audit";
import { addDays, fmtDateTime, parseDateOnly } from "@/lib/dates";
import { Alert, Button, Card, Empty, Field, ForbiddenView, LinkButton, Table } from "@/components/ui";
import { AdminHeader } from "../_shared";
import { JsonView, collectIds, targetTypeLabel, type NameMaps } from "./format";

export const metadata: Metadata = { title: "監査ログ" };

const PAGE_SIZE = 50;

type Search = { action?: string; actor?: string; from?: string; to?: string; q?: string; page?: string };

/** 日本時間の日付 "YYYY-MM-DD" の0時（日本時間）を Date にする */
function jstStartOf(s: string | undefined): Date | null {
  const d = parseDateOnly(s);
  return d ? new Date(d.getTime() - 9 * 3_600_000) : null;
}

export default async function AuditLogsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (!can.viewAuditLog(user)) return <ForbiddenView />;
  const sp = await searchParams;
  const action = sp.action && sp.action in auditActionLabel ? sp.action : "";
  const actor = sp.actor ?? "";
  const q = (sp.q ?? "").trim();
  const from = jstStartOf(sp.from);
  const toStart = jstStartOf(sp.to);
  const to = toStart ? addDays(toStart, 1) : null; // 終了日の翌日0時より前
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const errors: string[] = [];
  if (sp.from && !from) errors.push("開始日の形式が正しくありません。");
  if (sp.to && !toStart) errors.push("終了日の形式が正しくありません。");
  if (from && to && from >= to) errors.push("開始日は終了日以前にしてください。");

  const where: Prisma.AuditLogWhereInput = {
    ...(action ? { action } : {}),
    ...(actor === "none" ? { actorId: null } : actor ? { actorId: actor } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
    ...(q ? { targetLabel: { contains: q, mode: "insensitive" } } : {}),
  };

  const [total, logs, users] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { actor: { select: { name: true, email: true } } },
    }),
    prisma.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], select: { id: true, name: true, active: true } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 変更前後に出てくる ID を名前に置き換える
  const ids = collectIds(logs.flatMap((l) => [l.before, l.after]));
  const [nUsers, nDepts, nCats] = await Promise.all([
    ids.user.size ? prisma.user.findMany({ where: { id: { in: [...ids.user] } }, select: { id: true, name: true } }) : [],
    ids.department.size ? prisma.department.findMany({ where: { id: { in: [...ids.department] } }, select: { id: true, name: true } }) : [],
    ids.category.size ? prisma.productCategory.findMany({ where: { id: { in: [...ids.category] } }, select: { id: true, name: true } }) : [],
  ]);
  const names: NameMaps = {
    user: new Map(nUsers.map((u) => [u.id, u.name])),
    department: new Map(nDepts.map((d) => [d.id, d.name])),
    category: new Map(nCats.map((c) => [c.id, c.name])),
  };

  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (action) params.set("action", action);
    if (actor) params.set("actor", actor);
    if (sp.from) params.set("from", sp.from);
    if (sp.to) params.set("to", sp.to);
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return `/admin/audit-logs${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <AdminHeader title="監査ログ" />
      <div className="flex flex-col gap-4">
        <Card title="絞り込み">
          <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_9.5rem_9.5rem_1fr_auto] lg:items-end">
            <Field label="操作" htmlFor="f-action">
              <select id="f-action" name="action" className="input" defaultValue={action}>
                <option value="">すべて</option>
                {Object.entries(auditActionLabel).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="操作者" htmlFor="f-actor">
              <select id="f-actor" name="actor" className="input" defaultValue={actor}>
                <option value="">すべて</option>
                <option value="none">（操作者なし：未登録のアドレスでのログイン失敗など）</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {u.active ? "" : "（無効）"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="開始日" htmlFor="f-from">
              <input id="f-from" type="date" name="from" className="input" defaultValue={sp.from ?? ""} />
            </Field>
            <Field label="終了日" htmlFor="f-to">
              <input id="f-to" type="date" name="to" className="input" defaultValue={sp.to ?? ""} />
            </Field>
            <Field label="対象（オーダー番号・名前など）" htmlFor="f-q">
              <input id="f-q" name="q" className="input" defaultValue={q} placeholder="部分一致" />
            </Field>
            <div className="flex gap-2">
              <Button type="submit">絞り込む</Button>
              <LinkButton href="/admin/audit-logs" variant="secondary">
                クリア
              </LinkButton>
            </div>
          </form>
          <p className="mt-2 text-xs text-slate-500">日付は日本時間です。</p>
        </Card>
        {errors.length > 0 && (
          <Alert kind="error">
            {errors.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </Alert>
        )}
        <Card
          title={`監査ログ（${total.toLocaleString()}件）`}
          actions={
            total > 0 && (
              <span className="text-sm text-slate-500">
                {page} / {pages} ページ
              </span>
            )
          }
        >
          {logs.length === 0 ? (
            <Empty>該当する記録はありません。</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>日時</th>
                  <th>操作者</th>
                  <th>操作</th>
                  <th>対象</th>
                  <th>変更前</th>
                  <th>変更後</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap">{fmtDateTime(l.createdAt)}</td>
                    <td className="whitespace-nowrap">{l.actor?.name ?? <span className="text-slate-400">―</span>}</td>
                    <td className="whitespace-nowrap">{auditActionLabel[l.action] ?? l.action}</td>
                    <td className="max-w-[16rem]">
                      <div className="text-xs text-slate-500">{targetTypeLabel[l.targetType] ?? l.targetType}</div>
                      <div className="break-all">{l.targetLabel}</div>
                    </td>
                    <td>
                      <JsonView value={l.before} names={names} />
                    </td>
                    <td>
                      <JsonView value={l.after} names={names} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {pages > 1 && (
            <nav className="mt-3 flex flex-wrap items-center justify-center gap-2" aria-label="ページ送り">
              {page > 1 ? (
                <Link href={pageHref(page - 1)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
                  ← 前へ
                </Link>
              ) : (
                <span className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-300">← 前へ</span>
              )}
              <span className="text-sm text-slate-600">
                {page} / {pages}
              </span>
              {page < pages ? (
                <Link href={pageHref(page + 1)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
                  次へ →
                </Link>
              ) : (
                <span className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-300">次へ →</span>
              )}
            </nav>
          )}
        </Card>
      </div>
    </>
  );
}
