// オーダーの検索・読み込み（画面・CSV 共通）
import type { OrderStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { today } from "@/lib/dates";
import { orderVisibilityWhere, type Actor } from "@/lib/permissions";
import { OPEN_UNRESOLVED } from "@/lib/orders/rules";

export type OrderFilter = {
  q?: string;
  status?: OrderStatus | "ACTIVE" | "";
  categoryId?: string;
  salesUserId?: string;
  techUserId?: string;
  hasUnresolved?: boolean;
  hasOverdue?: boolean;
};

export const ORDER_STATUSES: OrderStatus[] = ["DRAFT", "ACCEPT_PENDING", "RETURNED", "SPEC_PENDING", "SPEC_FIXED", "COMPLETED", "CANCELLED"];

export function parseOrderFilter(sp: Record<string, string | string[] | undefined>): OrderFilter {
  const g = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const status = g("status");
  return {
    q: g("q"),
    status: status === "ACTIVE" || (ORDER_STATUSES as string[]).includes(status) ? (status as OrderFilter["status"]) : "",
    categoryId: g("category"),
    salesUserId: g("sales"),
    techUserId: g("tech"),
    hasUnresolved: g("unresolved") === "1",
    hasOverdue: g("overdue") === "1",
  };
}

export async function orderWhere(actor: Actor, f: OrderFilter): Promise<Prisma.OrderWhereInput> {
  const and: Prisma.OrderWhereInput[] = [await orderVisibilityWhere(actor)];
  if (f.q) {
    const q = f.q.trim();
    and.push({
      OR: [
        { orderNumber: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
        { siteName: { contains: q, mode: "insensitive" } },
        { endUser: { contains: q, mode: "insensitive" } },
        { quoteNumber: { contains: q, mode: "insensitive" } },
        { inquiryNumber: { contains: q, mode: "insensitive" } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  if (f.status === "ACTIVE") and.push({ status: { notIn: ["COMPLETED", "CANCELLED"] } });
  else if (f.status) and.push({ status: f.status });
  if (f.categoryId) and.push({ productCategoryId: f.categoryId });
  if (f.salesUserId) and.push({ salesUserId: f.salesUserId });
  if (f.techUserId) and.push({ techUserId: f.techUserId });
  if (f.hasUnresolved) and.push({ unresolvedItems: { some: { status: { in: OPEN_UNRESOLVED } } } });
  if (f.hasOverdue) {
    const t = today();
    and.push({
      OR: [
        { unresolvedItems: { some: { status: { in: OPEN_UNRESOLVED }, dueDate: { lt: t } } } },
        { tasks: { some: { status: { not: "DONE" }, dueDate: { lt: t } } } },
      ],
    });
  }
  return { AND: and };
}

export const orderListInclude = {
  productCategory: true,
  customer: true,
  salesUser: { select: { id: true, name: true } },
  techUser: { select: { id: true, name: true } },
  salesDepartment: { select: { id: true, name: true } },
  unresolvedItems: { where: { status: { in: OPEN_UNRESOLVED } }, select: { id: true, dueDate: true } },
  tasks: { where: { status: { not: "DONE" } }, select: { id: true, dueDate: true } },
} satisfies Prisma.OrderInclude;

export async function searchOrders(actor: Actor, f: OrderFilter, page = 1, pageSize = 50) {
  const where = await orderWhere(actor, f);
  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      include: orderListInclude,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { total, orders };
}

/** オーダー詳細の読み込み */
export async function loadOrderDetail(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: {
      productCategory: true,
      customer: true,
      salesUser: { select: { id: true, name: true, email: true } },
      techUser: { select: { id: true, name: true, email: true } },
      salesDepartment: true,
      createdBy: { select: { id: true, name: true } },
      specValues: true,
      documents: {
        include: {
          template: true,
          versions: { orderBy: { registeredAt: "desc" }, include: { registeredBy: { select: { name: true } } } },
        },
      },
      unresolvedItems: {
        orderBy: [{ createdAt: "asc" }],
        include: {
          assignee: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          resolvedBy: { select: { id: true, name: true } },
          specTemplate: true,
          document: { include: { template: true } },
        },
      },
      tasks: {
        orderBy: [{ createdAt: "asc" }],
        include: {
          taskType: true,
          assignee: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          author: { select: { id: true, name: true } },
          mentions: { select: { id: true, name: true } },
          unresolvedItem: { select: { id: true, title: true } },
          task: { select: { id: true, content: true, taskType: { select: { name: true } } } },
        },
      },
      statusHistories: { orderBy: { createdAt: "asc" }, include: { actor: { select: { name: true } } } },
      aiRuns: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
}

export type OrderDetail = NonNullable<Awaited<ReturnType<typeof loadOrderDetail>>>;

/** 選択肢用のユーザー一覧 */
export async function activeUsers() {
  return prisma.user.findMany({
    where: { active: true },
    select: { id: true, name: true, roles: true, departmentId: true, department: { select: { name: true } } },
    orderBy: [{ name: "asc" }],
  });
}
export type UserOption = Awaited<ReturnType<typeof activeUsers>>[number];
