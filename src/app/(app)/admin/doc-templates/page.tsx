import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { docRequirementLabel, responsibleTypeLabel } from "@/lib/labels";
import type { DocRequirement } from "@/generated/prisma/client";
import { Alert, Badge, Card, Empty, ForbiddenView, Table } from "@/components/ui";
import { ActiveBadge, AdminHeader, LinkTabs } from "../_shared";
import { EditableRow, EditableTable } from "../_edit-row";
import { DocTemplateForm, MoveButtons } from "./forms";

export const metadata: Metadata = { title: "資料チェックリストテンプレート" };

const requirementColor: Record<DocRequirement, string> = {
  REQUIRED: "bg-red-50 text-red-700 ring-red-300",
  CONDITIONAL: "bg-amber-50 text-amber-800 ring-amber-300",
  OPTIONAL: "bg-slate-100 text-slate-600 ring-slate-300",
};

export default async function DocTemplatesPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const user = await requireUser();
  if (!can.admin(user)) return <ForbiddenView />;
  const { category } = await searchParams;
  const categories = await prisma.productCategory.findMany({
    orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, active: true },
  });
  const current = categories.find((c) => c.id === category) ?? categories[0] ?? null;
  const docs = current
    ? await prisma.documentTemplate.findMany({
        where: { productCategoryId: current.id },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      })
    : [];

  return (
    <>
      <AdminHeader title="資料チェックリストテンプレート" />
      <div className="flex flex-col gap-4">
        {!current ? (
          <Alert kind="warn">製品区分がありません。先に製品区分を登録してください。</Alert>
        ) : (
          <>
            <LinkTabs
              items={categories.map((c) => ({
                href: `/admin/doc-templates?category=${c.id}`,
                label: c.active ? c.name : `${c.name}（無効）`,
                active: current.id === c.id,
              }))}
            />
            <Alert kind="info">
              製品区分ごとに発令時に必要な資料を設定します。「必須」の資料は、添付・未入手（未確定項目に登録）・該当なしのいずれかにしないと発令できません。資料は削除せず、使わなくなったら無効にしてください。
            </Alert>
            <Card title={`${current.name}の資料を追加`}>
              <DocTemplateForm key={current.id} productCategoryId={current.id} />
            </Card>
            <Card title={`${current.name}の資料（${docs.length}件）`}>
              {docs.length === 0 ? (
                <Empty>資料がありません。</Empty>
              ) : (
                <EditableTable>
                  <Table>
                    <thead>
                      <tr>
                        <th>順序</th>
                        <th>資料名</th>
                        <th>必須区分</th>
                        <th>確認担当の既定</th>
                        <th>状態</th>
                        <th>編集</th>
                      </tr>
                    </thead>
                    <tbody>
                      {docs.map((d, i) => (
                        <EditableRow
                          key={d.id}
                          className={d.active ? "" : "bg-slate-50 text-slate-500"}
                          colSpan={6}
                          panels={[
                            {
                              label: "編集",
                              content: (
                                <DocTemplateForm
                                  doc={{
                                    id: d.id,
                                    name: d.name,
                                    requirement: d.requirement,
                                    description: d.description,
                                    defaultResponsibleType: d.defaultResponsibleType,
                                    active: d.active,
                                  }}
                                />
                              ),
                            },
                          ]}
                          cells={
                            <>
                              <td>
                                <MoveButtons id={d.id} label={d.name} isFirst={i === 0} isLast={i === docs.length - 1} />
                              </td>
                              <td className="max-w-xs">
                                <div className="font-medium">{d.name}</div>
                                {d.description && <div className="text-xs whitespace-pre-wrap text-slate-500">{d.description}</div>}
                              </td>
                              <td>
                                <Badge className={requirementColor[d.requirement]}>{docRequirementLabel[d.requirement]}</Badge>
                              </td>
                              <td>{responsibleTypeLabel[d.defaultResponsibleType]}</td>
                              <td>
                                <ActiveBadge active={d.active} />
                              </td>
                            </>
                          }
                        />
                      ))}
                    </tbody>
                  </Table>
                </EditableTable>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  );
}
