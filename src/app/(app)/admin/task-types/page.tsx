import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { taskDefaultAssigneeLabel } from "@/lib/labels";
import { Alert, Card, ForbiddenView, Table } from "@/components/ui";
import { ActiveBadge, AdminHeader } from "../_shared";
import { EditableRow, EditableTable } from "../_edit-row";
import { TaskTypeForm } from "./forms";

export const metadata: Metadata = { title: "タスク種別" };

export default async function TaskTypesPage() {
  const user = await requireUser();
  if (!can.admin(user)) return <ForbiddenView />;
  const taskTypes = await prisma.taskType.findMany({
    orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { tasks: true } } },
  });
  return (
    <>
      <AdminHeader title="タスク種別" />
      <div className="flex flex-col gap-4">
        <Alert kind="info">
          既定担当は、タスクを登録するときの担当者の初期表示に使います（役割分担）。例：入構申請・日程調整・装備品確認は「営業」。種別は削除せず、使わなくなったら無効にしてください。
        </Alert>
        <Card title="タスク種別を追加">
          <TaskTypeForm />
        </Card>
        <Card title={`タスク種別一覧（${taskTypes.length}件）`}>
          <EditableTable>
            <Table>
              <thead>
                <tr>
                  <th>種別名</th>
                  <th>既定担当</th>
                  <th>説明</th>
                  <th>並び順</th>
                  <th>タスク数</th>
                  <th>状態</th>
                  <th>編集</th>
                </tr>
              </thead>
              <tbody>
                {taskTypes.map((t) => (
                  <EditableRow
                    key={t.id}
                    colSpan={7}
                    panels={[
                      {
                        label: "編集",
                        content: (
                          <TaskTypeForm
                            taskType={{
                              id: t.id,
                              name: t.name,
                              defaultAssignee: t.defaultAssignee,
                              description: t.description,
                              sortOrder: t.sortOrder,
                              active: t.active,
                            }}
                          />
                        ),
                      },
                    ]}
                    cells={
                      <>
                        <td className="whitespace-nowrap">{t.name}</td>
                        <td className="whitespace-nowrap">{taskDefaultAssigneeLabel[t.defaultAssignee]}</td>
                        <td className="max-w-xs">{t.description}</td>
                        <td>{t.sortOrder}</td>
                        <td>{t._count.tasks}</td>
                        <td>
                          <ActiveBadge active={t.active} />
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
