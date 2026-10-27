import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { emailPreferenceLabel, roleLabel } from "@/lib/labels";
import { fmtDateTime } from "@/lib/dates";
import { Alert, Badge, Card, ForbiddenView, Table } from "@/components/ui";
import { ActiveBadge, AdminHeader } from "../_shared";
import { EditableRow, EditableTable } from "../_edit-row";
import { ResetPasswordForm, UserForm } from "./forms";

export const metadata: Metadata = { title: "ユーザー" };

export default async function UsersPage() {
  const user = await requireUser();
  if (!can.admin(user)) return <ForbiddenView />;
  const [users, departments] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ active: "desc" }, { department: { sortOrder: "asc" } }, { name: "asc" }],
      include: { department: { select: { name: true } } },
    }),
    prisma.department.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, active: true } }),
  ]);
  return (
    <>
      <AdminHeader title="ユーザー" />
      <div className="flex flex-col gap-4">
        <Card title="ユーザーを登録（招待制）">
          <div className="mb-3">
            <Alert kind="info">
              登録したメールアドレスの人だけがログインできます。登録すると初期パスワードを発行し、この画面に一度だけ表示します。本人に伝えてください（初回ログイン時に変更を求めます）。
            </Alert>
          </div>
          <UserForm departments={departments} />
        </Card>
        <Card title={`ユーザー一覧（${users.length}人）`}>
          <EditableTable>
            <Table>
              <thead>
                <tr>
                  <th>氏名・メールアドレス</th>
                  <th>部署</th>
                  <th>ロール</th>
                  <th>状態・メール通知</th>
                  <th>最終ログイン</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <EditableRow
                    key={u.id}
                    className={u.active ? "" : "bg-slate-50 text-slate-500"}
                    colSpan={6}
                    panels={[
                      {
                        label: "編集",
                        content: (
                          <UserForm
                            user={{
                              id: u.id,
                              name: u.name,
                              email: u.email,
                              departmentId: u.departmentId,
                              roles: u.roles,
                              active: u.active,
                              emailPreference: u.emailPreference,
                            }}
                            departments={departments}
                            isSelf={u.id === user.id}
                          />
                        ),
                      },
                      { label: "パスワード再設定", content: <ResetPasswordForm user={{ id: u.id, name: u.name }} /> },
                    ]}
                    cells={
                      <>
                        <td className="whitespace-nowrap">
                          <div className="font-medium text-slate-900">
                            {u.name}
                            {u.id === user.id && <span className="ml-1 text-xs font-normal text-slate-500">（自分）</span>}
                          </div>
                          <div className="text-xs text-slate-600">{u.email}</div>
                          {u.mustChangePassword && <Badge className="mt-1 bg-amber-50 text-amber-800 ring-amber-300">初回パスワード変更待ち</Badge>}
                        </td>
                        <td className="whitespace-nowrap">{u.department?.name ?? <span className="text-slate-400">―</span>}</td>
                        <td>
                          <div className="flex max-w-xs flex-wrap gap-1">
                            {u.roles.map((r) => (
                              <Badge key={r} className="bg-brand-50 text-brand-800 ring-brand-100">
                                {roleLabel[r]}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="whitespace-nowrap">
                          <ActiveBadge active={u.active} />
                          <div className="mt-1 text-xs text-slate-600">メール：{emailPreferenceLabel[u.emailPreference]}</div>
                        </td>
                        <td className="whitespace-nowrap">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : <span className="text-slate-400">未ログイン</span>}</td>
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
