// 権限判定（SPEC §2.2）。ロールの判定はこのファイルに集約する（将来の Entra ID グループ対応のため）
import type { Role, OrderStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

export type Actor = { id: string; roles: Role[]; departmentId: string | null };

export function hasRole(actor: Actor, ...roles: Role[]) {
  return roles.some((r) => actor.roles.includes(r));
}

/** 営業として扱うか（営業・営業管理職） */
export const isSales = (a: Actor) => hasRole(a, "SALES", "SALES_MANAGER");
export const isAdmin = (a: Actor) => hasRole(a, "ADMIN");

// ── 画面単位の権限 ──
export const can = {
  createOrder: (a: Actor) => isSales(a),
  /** 既存番号の手入力登録（管理者・営業管理職のみ） */
  manualNumber: (a: Actor) => hasRole(a, "ADMIN", "SALES_MANAGER"),
  viewReports: (a: Actor) => hasRole(a, "SALES_MANAGER", "ADMIN"),
  admin: (a: Actor) => isAdmin(a),
  viewAuditLog: (a: Actor) => isAdmin(a),
  /** 全オーダー（下書きを除く）を閲覧できるか */
  viewAllOrders: (a: Actor) => hasRole(a, "ADMIN", "VIEWER", "TECH_RECEPTION"),
  acceptOrders: (a: Actor) => hasRole(a, "TECH_RECEPTION"),
  useAi: (a: Actor) => isSales(a),
};

/** 営業管理職が閲覧できる部署（自部署と配下部署）の ID 一覧 */
export async function managedDepartmentIds(actor: Actor): Promise<string[]> {
  if (!hasRole(actor, "SALES_MANAGER") || !actor.departmentId) return [];
  const all = await prisma.department.findMany({ select: { id: true, parentId: true } });
  const result = new Set<string>([actor.departmentId]);
  let added = true;
  while (added) {
    added = false;
    for (const d of all) {
      if (d.parentId && result.has(d.parentId) && !result.has(d.id)) {
        result.add(d.id);
        added = true;
      }
    }
  }
  return [...result];
}

/** オーダーの閲覧範囲（一覧・詳細・レポートで共通に使う） */
export async function orderVisibilityWhere(actor: Actor): Promise<Prisma.OrderWhereInput> {
  const or: Prisma.OrderWhereInput[] = [
    { salesUserId: actor.id },
    { createdById: actor.id },
    { techUserId: actor.id },
    { unresolvedItems: { some: { assigneeId: actor.id } } },
    { tasks: { some: { assigneeId: actor.id } } },
  ];
  if (can.viewAllOrders(actor)) or.push({ status: { not: "DRAFT" } });
  if (isAdmin(actor)) or.push({});
  const deptIds = await managedDepartmentIds(actor);
  if (deptIds.length) or.push({ salesDepartmentId: { in: deptIds } });
  return { OR: or };
}

const EDITABLE: OrderStatus[] = ["DRAFT", "RETURNED"];
const ACTIVE: OrderStatus[] = ["DRAFT", "ACCEPT_PENDING", "RETURNED", "SPEC_PENDING", "SPEC_FIXED"];
const AFTER_ACCEPT: OrderStatus[] = ["SPEC_PENDING", "SPEC_FIXED"];

export type OrderForAccess = {
  id: string;
  status: OrderStatus;
  salesUserId: string;
  createdById: string;
  techUserId: string | null;
  salesDepartmentId: string | null;
};

export type OrderAccess = ReturnType<typeof computeOrderAccess>;

/** オーダーに対する操作権限を計算する（DBアクセスなし） */
export function computeOrderAccess(
  actor: Actor,
  order: OrderForAccess,
  ctx: { managedDeptIds: string[]; visible: boolean },
) {
  const isOwner =
    isSales(actor) && (order.salesUserId === actor.id || order.createdById === actor.id);
  const isManager =
    hasRole(actor, "SALES_MANAGER") &&
    !!order.salesDepartmentId &&
    ctx.managedDeptIds.includes(order.salesDepartmentId);
  const salesSide = isOwner || isManager;
  const isTech = hasRole(actor, "TECH") && order.techUserId === actor.id;
  const isReception = hasRole(actor, "TECH_RECEPTION");
  const active = ACTIVE.includes(order.status);

  return {
    isOwner,
    isManager,
    isTech,
    isReception,
    view: ctx.visible,
    /** 作成手順（基本情報・要求仕様書・資料・未確定項目）の編集 */
    edit: salesSide && EDITABLE.includes(order.status),
    issue: salesSide && EDITABLE.includes(order.status),
    cancel: salesSide && (["DRAFT", "RETURNED", "SPEC_FIXED"] as OrderStatus[]).includes(order.status),
    complete: salesSide && order.status === "SPEC_FIXED",
    accept: isReception && order.status === "ACCEPT_PENDING",
    returnOrder: isReception && order.status === "ACCEPT_PENDING",
    assignTech: isReception && AFTER_ACCEPT.includes(order.status),
    /** 未確定項目の登録・全項目の更新 */
    manageUnresolved: active && (salesSide || isTech || (isReception && order.status !== "DRAFT")),
    /** タスクの登録 */
    createTask: active && (salesSide || isTech || (isReception && order.status !== "DRAFT")),
    /** 資料の新しい版の登録（発令後） */
    addDocumentVersion:
      active &&
      ((salesSide && !EDITABLE.includes(order.status)) || (isTech && AFTER_ACCEPT.includes(order.status))),
    postMessage: ctx.visible,
  };
}

/** 未確定項目を更新できるか（担当者本人、またはオーダーの管理側） */
export function canUpdateUnresolved(actor: Actor, access: OrderAccess, item: { assigneeId: string }) {
  return access.manageUnresolved || (access.view && item.assigneeId === actor.id);
}

/** タスクを更新できるか（担当者・起票者、またはオーダーの管理側） */
export function canUpdateTask(
  actor: Actor,
  access: OrderAccess,
  task: { assigneeId: string; createdById: string },
) {
  return access.createTask || (access.view && (task.assigneeId === actor.id || task.createdById === actor.id));
}

/** オーダーを読み込み、閲覧可否と操作権限を返す */
export async function loadOrderAccess(actor: Actor, orderId: string) {
  const where = await orderVisibilityWhere(actor);
  const [order, visibleCount, managedDeptIds] = await Promise.all([
    prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        salesUserId: true,
        createdById: true,
        techUserId: true,
        salesDepartmentId: true,
      },
    }),
    prisma.order.count({ where: { AND: [where, { id: orderId }] } }),
    managedDepartmentIds(actor),
  ]);
  if (!order) return null;
  return { order, access: computeOrderAccess(actor, order, { managedDeptIds, visible: visibleCount > 0 }) };
}
