import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { Alert, Card, ForbiddenView, Table } from "@/components/ui";
import { ActiveBadge, AdminHeader } from "../_shared";
import { EditableRow, EditableTable } from "../_edit-row";
import { NotificationGroupForm } from "./forms";

export const metadata: Metadata = { title: "通知グループ" };

export default async function NotificationGroupsPage() {
  const user = await requireUser();
  if (!can.admin(user)) return <ForbiddenView />;
  const [groups, users, departments] = await Promise.all([
    prisma.notificationGroup.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: {
        users: { select: { id: true, name: true, active: true }, orderBy: { name: "asc" } },
        departments: {
          select: { id: true, name: true, active: true, users: { where: { active: true }, select: { id: true } } },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
        categories: { select: { id: true, name: true, active: true }, orderBy: { sortOrder: "asc" } },
      },
    }),
    prisma.user.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: { id: true, name: true, active: true, department: { select: { name: true } } },
    }),
    prisma.department.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, active: true } }),
  ]);

  // 無効なユーザー・部署は、既にメンバーになっている場合だけ選択肢に出す（外せるようにするため）
  const userOptionsFor = (current: string[]) =>
    users.filter((u) => u.active || current.includes(u.id)).map((u) => ({ value: u.id, label: u.name, note: u.active ? u.department?.name : "（無効）" }));
  const departmentOptionsFor = (current: string[]) =>
    departments.filter((d) => d.active || current.includes(d.id)).map((d) => ({ value: d.id, label: d.name, note: d.active ? undefined : "（無効）" }));

  return (
    <>
      <AdminHeader title="通知グループ" />
      <div className="flex flex-col gap-4">
        <Alert kind="info">
          通知グループは、発令・資料の新しい版・仕様確定を知らせる関係部門です。製品区分ごとに、どのグループへ通知するかを
          製品区分の画面で設定します。部署をメンバーにすると、その部署の有効なユーザー全員に通知します。
        </Alert>
        <Card title="通知グループを追加">
          <NotificationGroupForm userOptions={userOptionsFor([])} departmentOptions={departmentOptionsFor([])} />
        </Card>
        <Card title={`通知グループ一覧（${groups.length}件）`}>
          <EditableTable>
            <Table>
              <thead>
                <tr>
                  <th>グループ名</th>
                  <th>メンバー（部署）</th>
                  <th>メンバー（個人）</th>
                  <th>通知する人数</th>
                  <th>使っている製品区分</th>
                  <th>状態</th>
                  <th>編集</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const recipients = new Set([...g.users.filter((u) => u.active).map((u) => u.id), ...g.departments.flatMap((d) => d.users.map((u) => u.id))]);
                  return (
                    <EditableRow
                      key={g.id}
                      colSpan={7}
                      panels={[
                        {
                          label: "編集",
                          content: (
                            <NotificationGroupForm
                              group={{
                                id: g.id,
                                name: g.name,
                                description: g.description,
                                active: g.active,
                                userIds: g.users.map((u) => u.id),
                                departmentIds: g.departments.map((d) => d.id),
                              }}
                              userOptions={userOptionsFor(g.users.map((u) => u.id))}
                              departmentOptions={departmentOptionsFor(g.departments.map((d) => d.id))}
                            />
                          ),
                        },
                      ]}
                      cells={
                        <>
                          <td className="max-w-xs">
                            <div className="font-medium whitespace-nowrap">{g.name}</div>
                            {g.description && <div className="text-xs text-slate-500">{g.description}</div>}
                          </td>
                          <td className="whitespace-nowrap">
                            {g.departments.length ? (
                              g.departments.map((d) => (
                                <div key={d.id}>
                                  {d.name}
                                  <span className="ml-1 text-xs text-slate-500">
                                    （{d.users.length}人{d.active ? "" : "・無効な部署"}）
                                  </span>
                                </div>
                              ))
                            ) : (
                              <span className="text-slate-400">―</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap">
                            {g.users.length ? (
                              g.users.map((u) => (
                                <div key={u.id} className={u.active ? "" : "text-slate-400 line-through"}>
                                  {u.name}
                                </div>
                              ))
                            ) : (
                              <span className="text-slate-400">―</span>
                            )}
                          </td>
                          <td>{recipients.size}人</td>
                          <td className="whitespace-nowrap">
                            {g.categories.length ? (
                              g.categories.map((c) => (
                                <div key={c.id} className={c.active ? "" : "text-slate-400"}>
                                  {c.name}
                                </div>
                              ))
                            ) : (
                              <span className="text-slate-400">未使用</span>
                            )}
                          </td>
                          <td>
                            <ActiveBadge active={g.active} />
                          </td>
                        </>
                      }
                    />
                  );
                })}
              </tbody>
            </Table>
          </EditableTable>
        </Card>
      </div>
    </>
  );
}
