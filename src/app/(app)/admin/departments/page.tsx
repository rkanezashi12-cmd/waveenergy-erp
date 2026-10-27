import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { Alert, Card, ForbiddenView, Table } from "@/components/ui";
import { ActiveBadge, AdminHeader } from "../_shared";
import { EditableRow, EditableTable } from "../_edit-row";
import { DepartmentForm } from "./forms";

export const metadata: Metadata = { title: "部署" };

type Dept = {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  active: boolean;
  _count: { users: number };
};

/** 部署を階層順（上位→配下）に並べ、階層の深さを付ける */
function flattenTree(depts: Dept[]) {
  const children = new Map<string | null, Dept[]>();
  const ids = new Set(depts.map((d) => d.id));
  for (const d of depts) {
    // 上位部署が見つからない場合は最上位として扱う
    const key = d.parentId && ids.has(d.parentId) ? d.parentId : null;
    children.set(key, [...(children.get(key) ?? []), d]);
  }
  const result: (Dept & { depth: number })[] = [];
  const visited = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const d of children.get(parent) ?? []) {
      if (visited.has(d.id)) continue;
      visited.add(d.id);
      result.push({ ...d, depth });
      walk(d.id, depth + 1);
    }
  };
  walk(null, 0);
  // 循環などで辿れなかった部署も末尾に出す
  for (const d of depts) if (!visited.has(d.id)) result.push({ ...d, depth: 0 });
  return result;
}

/** 部署とその配下の ID */
function descendantsOf(id: string, depts: Dept[]) {
  const result = new Set([id]);
  let added = true;
  while (added) {
    added = false;
    for (const d of depts) {
      if (d.parentId && result.has(d.parentId) && !result.has(d.id)) {
        result.add(d.id);
        added = true;
      }
    }
  }
  return result;
}

export default async function DepartmentsPage() {
  const user = await requireUser();
  if (!can.admin(user)) return <ForbiddenView />;
  const depts = await prisma.department.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, parentId: true, sortOrder: true, active: true, _count: { select: { users: true } } },
  });
  const tree = flattenTree(depts);
  const nameOf = new Map(depts.map((d) => [d.id, d.name]));
  const optionsExcluding = (exclude: Set<string>, currentParent?: string | null) =>
    tree
      .filter((d) => !exclude.has(d.id) && (d.active || d.id === currentParent))
      .map((d) => ({ id: d.id, label: `${"　".repeat(d.depth)}${d.name}${d.active ? "" : "（無効）"}` }));

  return (
    <>
      <AdminHeader title="部署" />
      <div className="flex flex-col gap-4">
        <Alert kind="info">
          上位部署を設定すると、営業管理職は<strong>自分の部署とその配下の部署</strong>
          のオーダーを閲覧できます（例：営業本部の営業管理職は営業一部〜三部のオーダーも閲覧できます）。部署は削除せず、使わなくなったら無効にしてください。
        </Alert>
        <Card title="部署を追加">
          <DepartmentForm parents={optionsExcluding(new Set())} />
        </Card>
        <Card title={`部署一覧（${depts.length}件）`}>
          <EditableTable>
            <Table>
              <thead>
                <tr>
                  <th>部署名</th>
                  <th>上位部署</th>
                  <th>並び順</th>
                  <th>所属人数</th>
                  <th>状態</th>
                  <th>編集</th>
                </tr>
              </thead>
              <tbody>
                {tree.map((d) => (
                  <EditableRow
                    key={d.id}
                    colSpan={6}
                    panels={[{ label: "編集", content: <DepartmentForm department={d} parents={optionsExcluding(descendantsOf(d.id, depts), d.parentId)} /> }]}
                    cells={
                      <>
                        <td className="whitespace-nowrap">
                          <span style={{ paddingLeft: `${d.depth * 1.25}rem` }}>
                            {d.depth > 0 && <span className="mr-1 text-slate-400">└</span>}
                            {d.name}
                          </span>
                        </td>
                        <td className="whitespace-nowrap">{d.parentId ? nameOf.get(d.parentId) : <span className="text-slate-400">―</span>}</td>
                        <td>{d.sortOrder}</td>
                        <td>{d._count.users}</td>
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
        </Card>
      </div>
    </>
  );
}
