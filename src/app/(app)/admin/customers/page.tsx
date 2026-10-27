import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { Badge, Card, ForbiddenView, PageHeader, Table } from "@/components/ui";
import { Disclosure } from "@/components/form";
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
      <PageHeader title="顧客" sub={<Link href="/admin" className="text-brand-700 underline">管理</Link>} />
      <div className="flex flex-col gap-4">
        <Card title="顧客を追加">
          <CustomerForm />
        </Card>
        <Card title={`顧客一覧（${customers.length}件）`}>
          <Table>
            <thead>
              <tr>
                <th>顧客名</th>
                <th>備考</th>
                <th>オーダー数</th>
                <th>状態</th>
                <th className="w-1/2">編集</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.note}</td>
                  <td>{c._count.orders}</td>
                  <td>{c.active ? <Badge className="bg-emerald-50 text-emerald-800 ring-emerald-300">有効</Badge> : <Badge className="bg-slate-100 text-slate-500 ring-slate-300">無効</Badge>}</td>
                  <td>
                    <Disclosure label="編集"><CustomerForm customer={c} /></Disclosure>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
