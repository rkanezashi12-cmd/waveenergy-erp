// オーダー画面の表示用データへの変換（サーバー側）
import type { SpecFieldTemplate } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { addDays, dateOnlyStr, fmtDateTime, isOverdue, today } from "@/lib/dates";
import { canUpdateUnresolved, type Actor, type OrderAccess } from "@/lib/permissions";
import { OPEN_UNRESOLVED } from "@/lib/orders/rules";
import type { OrderDetail } from "@/lib/orders/queries";
import type { SpecTemplateView } from "../_components/spec-form";
import type { UnresolvedItemView } from "../_components/unresolved-list";
import type { UnresolvedDefaults, UserOpt } from "../_components/unresolved-fields";

export function specTemplateView(t: SpecFieldTemplate): SpecTemplateView {
  return {
    id: t.id,
    label: t.label,
    inputType: t.inputType,
    required: t.required,
    options: t.options,
    description: t.description,
    defaultResponsibleType: t.defaultResponsibleType,
    common: t.productCategoryId === null,
  };
}

export function unresolvedViews(order: OrderDetail, actor: Actor, access: OrderAccess): UnresolvedItemView[] {
  const valueBy = new Map(order.specValues.map((v) => [v.templateId, v.value]));
  return order.unresolvedItems.map((i) => ({
    id: i.id,
    targetType: i.targetType,
    title: i.title,
    knownInfo: i.knownInfo,
    confirmTarget: i.confirmTarget,
    responsibleType: i.responsibleType,
    assigneeId: i.assigneeId,
    assigneeName: i.assignee.name,
    dueDate: dateOnlyStr(i.dueDate),
    designImpact: i.designImpact,
    status: i.status,
    resolution: i.resolution,
    resolvedDate: i.resolvedDate ? dateOnlyStr(i.resolvedDate) : i.resolvedAt ? dateOnlyStr(today(i.resolvedAt)) : null,
    resolvedByName: i.resolvedBy?.name ?? null,
    createdByName: i.createdBy.name,
    createdAt: fmtDateTime(i.createdAt),
    overdue: OPEN_UNRESOLVED.includes(i.status) && isOverdue(i.dueDate),
    specTemplate: i.specTemplate ? specTemplateView(i.specTemplate) : null,
    specValue: i.specTemplateId ? valueBy.get(i.specTemplateId) ?? null : null,
    canUpdate: canUpdateUnresolved(actor, access, i),
  }));
}

/** 対象ごとの未確定項目（未確定・確認中）の入力初期値 */
export function openItemDefaults(order: OrderDetail, key: "spec" | "doc"): Record<string, UnresolvedDefaults> {
  const r: Record<string, UnresolvedDefaults> = {};
  for (const i of order.unresolvedItems) {
    if (!OPEN_UNRESOLVED.includes(i.status)) continue;
    const k = key === "spec" ? i.specTemplateId : i.document?.templateId;
    if (!k || r[k]) continue;
    r[k] = {
      knownInfo: i.knownInfo ?? "",
      confirmTarget: i.confirmTarget,
      responsibleType: i.responsibleType,
      assigneeId: i.assigneeId,
      dueDate: dateOnlyStr(i.dueDate),
      designImpact: i.designImpact,
    };
  }
  return r;
}

export async function userOptions(): Promise<UserOpt[]> {
  const users = await prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, roles: true } });
  return users;
}

/** 未確定項目の回答期限の初期値（1週間後） */
export const defaultDueStr = () => dateOnlyStr(addDays(today(), 7));

export async function basicFormOptions() {
  const [categories, customers, users, departments] = await Promise.all([
    prisma.productCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.customer.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { name: true } }),
    prisma.user.findMany({
      where: { active: true, roles: { hasSome: ["SALES", "SALES_MANAGER"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, departmentId: true },
    }),
    prisma.department.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);
  return {
    categories: categories.map((c) => ({ id: c.id, name: c.name, months: c.standardLeadTimeMonths })),
    customers: customers.map((c) => c.name),
    salesUsers: users,
    departments,
  };
}
