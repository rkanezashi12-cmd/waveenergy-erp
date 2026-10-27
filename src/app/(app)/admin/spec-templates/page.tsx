import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { responsibleTypeLabel, specInputTypeLabel } from "@/lib/labels";
import { Alert, Badge, Card, Empty, ForbiddenView, Table } from "@/components/ui";
import { ActiveBadge, AdminHeader, LinkTabs } from "../_shared";
import { EditableRow, EditableTable } from "../_edit-row";
import { MoveButtons, SpecFieldForm } from "./forms";

export const metadata: Metadata = { title: "要求仕様書テンプレート" };

export default async function SpecTemplatesPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const user = await requireUser();
  if (!can.admin(user)) return <ForbiddenView />;
  const { category } = await searchParams;
  const categories = await prisma.productCategory.findMany({
    orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, active: true },
  });
  const current = categories.find((c) => c.id === category) ?? null;
  const fields = await prisma.specFieldTemplate.findMany({
    where: { productCategoryId: current?.id ?? null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: { _count: { select: { values: { where: { value: { not: null } } } } } },
  });
  const title = current ? `${current.name}の項目` : "共通項目";

  return (
    <>
      <AdminHeader title="要求仕様書テンプレート" />
      <div className="flex flex-col gap-4">
        <LinkTabs
          items={[
            { href: "/admin/spec-templates", label: "共通項目", active: !current },
            ...categories.map((c) => ({
              href: `/admin/spec-templates?category=${c.id}`,
              label: c.active ? c.name : `${c.name}（無効）`,
              active: current?.id === c.id,
            })),
          ]}
        />
        <Alert kind="info">
          要求仕様書は「共通項目」＋「製品区分別の項目」で構成します。<strong>顧客名〜注文書／内示書（基本情報）</strong>
          は作成手順①で入力する固定の項目のため、ここでは管理しません。項目は削除せず、使わなくなったら無効にしてください（入力済みのオーダーの値は残ります）。
        </Alert>
        <Card title={`${title}を追加`}>
          <SpecFieldForm key={current?.id ?? "common"} productCategoryId={current?.id ?? null} />
        </Card>
        <Card title={`${title}（${fields.length}件）`}>
          {fields.length === 0 ? (
            <Empty>項目がありません。</Empty>
          ) : (
            <EditableTable>
              <Table>
                <thead>
                  <tr>
                    <th>順序</th>
                    <th>項目名</th>
                    <th>入力形式</th>
                    <th>必須</th>
                    <th>確認担当の既定</th>
                    <th>状態</th>
                    <th>編集</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f, i) => (
                    <EditableRow
                      key={f.id}
                      className={f.active ? "" : "bg-slate-50 text-slate-500"}
                      colSpan={7}
                      panels={[
                        {
                          label: "編集",
                          content: (
                            <SpecFieldForm
                              field={{
                                id: f.id,
                                label: f.label,
                                inputType: f.inputType,
                                required: f.required,
                                options: f.options,
                                description: f.description,
                                defaultResponsibleType: f.defaultResponsibleType,
                                active: f.active,
                              }}
                              usedCount={f._count.values}
                            />
                          ),
                        },
                      ]}
                      cells={
                        <>
                          <td>
                            <MoveButtons id={f.id} label={f.label} isFirst={i === 0} isLast={i === fields.length - 1} />
                          </td>
                          <td className="max-w-xs">
                            <div className="font-medium">{f.label}</div>
                            {f.description && <div className="text-xs whitespace-pre-wrap text-slate-500">{f.description}</div>}
                          </td>
                          <td>
                            <div className="whitespace-nowrap">{specInputTypeLabel[f.inputType]}</div>
                            {f.options.length > 0 && <div className="max-w-xs text-xs text-slate-500">選択肢：{f.options.join("／")}</div>}
                          </td>
                          <td>
                            {f.required ? <Badge className="bg-red-50 text-red-700 ring-red-300">必須</Badge> : <span className="text-slate-500">任意</span>}
                          </td>
                          <td>{responsibleTypeLabel[f.defaultResponsibleType]}</td>
                          <td>
                            <ActiveBadge active={f.active} />
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
      </div>
    </>
  );
}
