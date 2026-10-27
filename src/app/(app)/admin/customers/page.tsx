import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { Card, ForbiddenView, Table } from "@/components/ui";
import { ActiveBadge, AdminHeader } from "../_shared";
import { EditableRow, EditableTable } from "../_edit-row";
import { CustomerForm } from "./forms";

export const metadata: Metadata = { title: "顧客" };

export default async function CustomersPage() {
  const user = await requireUser();
  if (!can.admin(user)) return <ForbiddenView />;
  const customers = await prisma.customer.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { _count: { select: { orders: true } } },
  });
  return (
    <>
      <AdminHeader title="顧客" />
      <div className="flex flex-col gap-4">
        <Card title="顧客を追加">
          <CustomerForm />
        </Card>
        <Card title={`顧客一覧（${customers.length}件）`}>
          <EditableTable>
          <Table>
            <thead>
              <tr>
                <th>顧客名</th>
                <th>備考</th>
                <th>オーダー数</th>
                <th>状態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <EditableRow
                  key={c.id}
                  colSpan={5}
                  cells={
                    <>
                      <td>{c.name}</td>
                      <td>{c.note}</td>
                      <td>{c._count.orders}</td>
                      <td>
                        <ActiveBadge active={c.active} />
                      </td>
                    </>
                  }
                  panels={[{ label: "編集", content: <CustomerForm customer={c} /> }]}
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
