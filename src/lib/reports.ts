// レポート（SPEC §4.9）。閲覧範囲はオーダー一覧と同じ（orderVisibilityWhere）
import type { Prisma } from "@/generated/prisma/client";
import type { ResponsibleType, UnresolvedStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { diffDays, isOverdue, monthKey, today, todayStr } from "@/lib/dates";
import { orderVisibilityWhere, type Actor } from "@/lib/permissions";
import { OPEN_UNRESOLVED } from "@/lib/orders/rules";

// ───────────── 未確定項目一覧 ─────────────

export type UnresolvedReportFilter = {
  q: string;
  assigneeId: string;
  responsibleType: ResponsibleType | "";
  categoryId: string;
  status: "open" | "all" | "closed";
  overdueOnly: boolean;
};

export function parseUnresolvedFilter(sp: Record<string, string | string[] | undefined>): UnresolvedReportFilter {
  const g = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const rt = g("responsible");
  const st = g("status");
  return {
    q: g("q"),
    assigneeId: g("assignee"),
    responsibleType: rt === "SALES" || rt === "TECH" ? rt : "",
    categoryId: g("category"),
    status: st === "all" || st === "closed" ? st : "open",
    overdueOnly: g("overdue") === "1",
  };
}

export async function unresolvedReport(actor: Actor, f: UnresolvedReportFilter) {
  const orderWhere: Prisma.OrderWhereInput = { AND: [await orderVisibilityWhere(actor), { status: { not: "CANCELLED" } }] };
  if (f.categoryId) (orderWhere.AND as Prisma.OrderWhereInput[]).push({ productCategoryId: f.categoryId });
  if (f.q)
    (orderWhere.AND as Prisma.OrderWhereInput[]).push({
      OR: [{ orderNumber: { contains: f.q, mode: "insensitive" } }, { title: { contains: f.q, mode: "insensitive" } }, { customer: { name: { contains: f.q, mode: "insensitive" } } }],
    });
  const statuses: UnresolvedStatus[] = f.status === "open" ? OPEN_UNRESOLVED : f.status === "closed" ? ["RESOLVED", "WITHDRAWN"] : ["OPEN", "CHECKING", "RESOLVED", "WITHDRAWN"];
  const where: Prisma.UnresolvedItemWhereInput = {
    order: orderWhere,
    status: { in: statuses },
    ...(f.assigneeId ? { assigneeId: f.assigneeId } : {}),
    ...(f.responsibleType ? { responsibleType: f.responsibleType } : {}),
    ...(f.overdueOnly ? { dueDate: { lt: today() }, status: { in: OPEN_UNRESOLVED } } : {}),
  };
  return prisma.unresolvedItem.findMany({
    where,
    include: {
      order: { select: { id: true, orderNumber: true, title: true, status: true, productCategory: { select: { name: true } }, customer: { select: { name: true } }, salesUser: { select: { name: true } }, salesDepartment: { select: { name: true } } } },
      assignee: { select: { name: true } },
      resolvedBy: { select: { name: true } },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    take: 2000,
  });
}

// ───────────── 未確定項目の集計 ─────────────

export type SummaryAxis = "month" | "category" | "department";

export type SummaryRow = {
  key: string;
  label: string;
  registered: number;
  open: number;
  overdue: number;
  resolved: number;
  /** 確定までの平均日数（登録日から確定日まで） */
  avgDaysToResolve: number | null;
};

export async function unresolvedSummary(actor: Actor, axis: SummaryAxis, fromMonth?: string): Promise<SummaryRow[]> {
  const items = await prisma.unresolvedItem.findMany({
    where: { order: { AND: [await orderVisibilityWhere(actor), { status: { not: "CANCELLED" } }] } },
    select: {
      status: true,
      dueDate: true,
      createdAt: true,
      resolvedAt: true,
      order: { select: { productCategory: { select: { id: true, name: true, sortOrder: true } }, salesDepartment: { select: { id: true, name: true, sortOrder: true } } } },
    },
  });
  const groups = new Map<string, SummaryRow & { sort: number | string; days: number[] }>();
  for (const i of items) {
    let key: string;
    let label: string;
    let sort: number | string;
    if (axis === "month") {
      key = monthKey(i.createdAt);
      if (fromMonth && key < fromMonth) continue;
      label = key.replace("-", "年") + "月";
      sort = key;
    } else if (axis === "category") {
      key = i.order.productCategory?.id ?? "-";
      label = i.order.productCategory?.name ?? "（未選択）";
      sort = i.order.productCategory?.sortOrder ?? 9999;
    } else {
      key = i.order.salesDepartment?.id ?? "-";
      label = i.order.salesDepartment?.name ?? "（未設定）";
      sort = i.order.salesDepartment?.sortOrder ?? 9999;
    }
    const g = groups.get(key) ?? { key, label, sort, registered: 0, open: 0, overdue: 0, resolved: 0, avgDaysToResolve: null, days: [] };
    g.registered++;
    if (OPEN_UNRESOLVED.includes(i.status)) {
      g.open++;
      if (isOverdue(i.dueDate)) g.overdue++;
    }
    if (i.status === "RESOLVED" && i.resolvedAt) {
      g.resolved++;
      g.days.push(Math.max(0, diffDays(today(i.createdAt), today(i.resolvedAt))));
    }
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, avgDaysToResolve: g.days.length ? Math.round((g.days.reduce((a, b) => a + b, 0) / g.days.length) * 10) / 10 : null }))
    .sort((a, b) => (axis === "month" ? String(b.sort).localeCompare(String(a.sort)) : Number(a.sort) - Number(b.sort)))
    .map(({ key, label, registered, open, overdue, resolved, avgDaysToResolve }) => ({ key, label, registered, open, overdue, resolved, avgDaysToResolve }));
}

// ───────────── 発令品質 ─────────────

export type QualityRow = {
  month: string;
  label: string;
  issued: number;
  withUnresolved: number;
  /** 発令時点で未確定項目があった割合（%） */
  withUnresolvedRate: number | null;
  returned: number;
  /** 受入までの平均日数（初回発令から受入まで） */
  avgDaysToAccept: number | null;
};

export async function issueQuality(actor: Actor, opts: { categoryId?: string; departmentId?: string; months?: number } = {}): Promise<QualityRow[]> {
  const and: Prisma.OrderWhereInput[] = [await orderVisibilityWhere(actor), { firstIssuedAt: { not: null } }];
  if (opts.categoryId) and.push({ productCategoryId: opts.categoryId });
  if (opts.departmentId) and.push({ salesDepartmentId: opts.departmentId });
  const orders = await prisma.order.findMany({
    where: { AND: and },
    select: { id: true, firstIssuedAt: true, acceptedAt: true, unresolvedCountAtIssue: true, statusHistories: { where: { toStatus: "RETURNED" }, select: { createdAt: true } } },
  });
  const rows = new Map<string, { issued: number; withUnresolved: number; returned: number; days: number[] }>();
  const get = (m: string) => rows.get(m) ?? rows.set(m, { issued: 0, withUnresolved: 0, returned: 0, days: [] }).get(m)!;
  for (const o of orders) {
    const g = get(monthKey(o.firstIssuedAt!));
    g.issued++;
    if ((o.unresolvedCountAtIssue ?? 0) > 0) g.withUnresolved++;
    if (o.acceptedAt) g.days.push(Math.max(0, (o.acceptedAt.getTime() - o.firstIssuedAt!.getTime()) / 86_400_000));
    // 差戻しは差し戻した月で数える
    for (const h of o.statusHistories) get(monthKey(h.createdAt)).returned++;
  }
  // 直近 N か月は件数ゼロでも行を出す
  const months = opts.months ?? 12;
  const [y, m] = todayStr().split("-").map(Number);
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    get(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return [...rows.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, g]) => ({
      month,
      label: month.replace("-", "年") + "月",
      issued: g.issued,
      withUnresolved: g.withUnresolved,
      withUnresolvedRate: g.issued ? Math.round((g.withUnresolved / g.issued) * 1000) / 10 : null,
      returned: g.returned,
      avgDaysToAccept: g.days.length ? Math.round((g.days.reduce((a, b) => a + b, 0) / g.days.length) * 10) / 10 : null,
    }));
}
