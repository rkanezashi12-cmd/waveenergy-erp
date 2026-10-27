import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { Card, ForbiddenView, Table } from "@/components/ui";
import { ActiveBadge, AdminHeader } from "../_shared";
import { EditableRow, EditableTable } from "../_edit-row";
import { CategoryForm } from "./forms";

export const metadata: Metadata = { title: "製品区分" };

export default async function CategoriesPage() {
  const user = await requireUser();
  if (!can.admin(user)) return <ForbiddenView />;
  const [categories, receptionUsers, groups] = await Promise.all([
    prisma.productCategory.findMany({
      orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
      include: {
        receptionUsers: { select: { id: true, name: true, active: true, roles: true }, orderBy: { name: "asc" } },
        notificationGroups: { select: { id: true, name: true, active: true }, orderBy: { name: "asc" } },
        _count: { select: { orders: true, specFieldTemplates: true, documentTemplates: true } },
      },
    }),
    prisma.user.findMany({
      where: { active: true, roles: { has: "TECH_RECEPTION" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, department: { select: { name: true } } },
    }),
    prisma.notificationGroup.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], select: { id: true, name: true, active: true } }),
  ]);

  const receptionOptions = receptionUsers.map((u) => ({ value: u.id, label: u.name, note: u.department?.name }));
  const groupOptionsFor = (current: string[]) =>
    groups.filter((g) => g.active || current.includes(g.id)).map((g) => ({ value: g.id, label: g.name, note: g.active ? undefined : "（無効）" }));
  // 既に通知先になっているが、無効・ロールなしのユーザーも外せるように選択肢に残す
  const receptionOptionsFor = (current: { id: string; name: string; active: boolean; roles: string[] }[]) => [
    ...receptionOptions,
    ...current
      .filter((u) => !receptionOptions.some((o) => o.value === u.id))
      .map((u) => ({ value: u.id, label: u.name, note: !u.active ? "（無効なユーザー）" : "（技術受付ロールなし）" })),
  ];

  return (
    <>
      <AdminHeader title="製品区分" />
      <div className="flex flex-col gap-4">
        <Card title="製品区分を追加">
          <CategoryForm receptionOptions={receptionOptions} groupOptions={groupOptionsFor([])} />
        </Card>
        <Card title={`製品区分一覧（${categories.length}件）`}>
          <p className="mb-3 text-sm text-slate-600">
            標準納期より契約納期までの期間が短いオーダーは、自動で「短納期」になります。要求仕様書・資料の項目は
            <Link href="/admin/spec-templates" className="text-brand-700 underline">
              要求仕様書テンプレート
            </Link>
            ・
            <Link href="/admin/doc-templates" className="text-brand-700 underline">
              資料チェックリストテンプレート
            </Link>
            で設定します。
          </p>
          <EditableTable>
            <Table>
              <thead>
                <tr>
                  <th>コード</th>
                  <th>名称</th>
                  <th>標準納期</th>
                  <th>技術受付の通知先</th>
                  <th>通知グループ</th>
                  <th>並び順</th>
                  <th>状態</th>
                  <th>編集</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <EditableRow
                    key={c.id}
                    colSpan={8}
                    panels={[
                      {
                        label: "編集",
                        content: (
                          <CategoryForm
                            category={{
                              id: c.id,
                              code: c.code,
                              name: c.name,
                              standardLeadTimeMonths: c.standardLeadTimeMonths,
                              sortOrder: c.sortOrder,
                              active: c.active,
                              receptionUserIds: c.receptionUsers.map((u) => u.id),
                              notificationGroupIds: c.notificationGroups.map((g) => g.id),
                            }}
                            receptionOptions={receptionOptionsFor(c.receptionUsers)}
                            groupOptions={groupOptionsFor(c.notificationGroups.map((g) => g.id))}
                          />
                        ),
                      },
                    ]}
                    cells={
                      <>
                        <td className="font-mono">{c.code}</td>
                        <td className="whitespace-nowrap">
                          {c.name}
                          <div className="text-xs text-slate-500">
                            仕様項目 {c._count.specFieldTemplates}・資料 {c._count.documentTemplates}・オーダー {c._count.orders}
                          </div>
                        </td>
                        <td className="whitespace-nowrap">
                          {c.standardLeadTimeMonths ? `${c.standardLeadTimeMonths}か月` : <span className="text-slate-400">判定しない</span>}
                        </td>
                        <td>
                          {c.receptionUsers.length ? (
                            c.receptionUsers.map((u) => (
                              <div key={u.id} className={u.active ? "" : "text-slate-400 line-through"}>
                                {u.name}
                              </div>
                            ))
                          ) : (
                            <span className="text-xs text-slate-500">未設定（技術受付ロールの全員に通知）</span>
                          )}
                        </td>
                        <td>
                          {c.notificationGroups.length ? (
                            c.notificationGroups.map((g) => (
                              <div key={g.id} className={g.active ? "" : "text-slate-400 line-through"}>
                                {g.name}
                              </div>
                            ))
                          ) : (
                            <span className="text-slate-400">―</span>
                          )}
                        </td>
                        <td>{c.sortOrder}</td>
                        <td>
                          <ActiveBadge active={c.active} />
                        </td>
                      </>
                    }
                  />
                ))}
              </tbody>
            </Table>
          </EditableTable>
        </Card>
      </div>
    </>
  );
}
