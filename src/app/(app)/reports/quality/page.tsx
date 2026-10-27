import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { issueQuality } from "@/lib/reports";
import { Card, cx, ForbiddenView, LinkButton, PageHeader, Table } from "@/components/ui";

export const metadata: Metadata = { title: "発令品質レポート" };

export default async function QualityReportPage({ searchParams }: { searchParams: Promise<{ category?: string; department?: string }> }) {
  const user = await requireUser();
  if (!can.viewReports(user)) return <ForbiddenView />;
  const sp = await searchParams;
  const [rows, categories, departments] = await Promise.all([
    issueQuality(user, { categoryId: sp.category || undefined, departmentId: sp.department || undefined }),
    prisma.productCategory.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.department.findMany({ where: { orders: { some: {} } }, orderBy: { sortOrder: "asc" } }),
  ]);
  const total = rows.reduce((a, r) => ({ issued: a.issued + r.issued, withUnresolved: a.withUnresolved + r.withUnresolved, returned: a.returned + r.returned }), { issued: 0, withUnresolved: 0, returned: 0 });
  const qs = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string" && !!e[1]));
  return (
    <>
      <PageHeader title="発令品質レポート" actions={<LinkButton href={`/reports/quality/export?${qs}`} variant="secondary" prefetch={false}>CSV出力</LinkButton>} />
      <Card className="mb-4">
        <form className="flex flex-wrap gap-3" role="search">
          <select name="category" className="input max-w-xs" defaultValue={sp.category ?? ""} aria-label="製品区分">
            <option value="">製品区分（すべて）</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select name="department" className="input max-w-xs" defaultValue={sp.department ?? ""} aria-label="営業部署">
            <option value="">営業部署（すべて）</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700">
            絞り込み
          </button>
        </form>
      </Card>
      <Card title="月別の発令品質">
        <Table>
          <thead>
            <tr>
              <th>発令月</th>
              <th className="text-right">発令件数</th>
              <th className="text-right">発令時点で未確定ありの件数</th>
              <th className="text-right">割合</th>
              <th className="text-right">差戻し件数</th>
              <th className="text-right">受入までの平均日数</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month}>
                <td>{r.label}</td>
                <td className="text-right tabular-nums">{r.issued}</td>
                <td className="text-right tabular-nums">{r.withUnresolved}</td>
                <td className={cx("text-right tabular-nums", (r.withUnresolvedRate ?? 0) >= 30 && "font-bold text-amber-800")}>{r.withUnresolvedRate === null ? "―" : `${r.withUnresolvedRate}%`}</td>
                <td className={cx("text-right tabular-nums", r.returned > 0 && "font-bold text-red-700")}>{r.returned}</td>
                <td className="text-right tabular-nums">{r.avgDaysToAccept ?? "―"}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td>合計</td>
              <td className="text-right tabular-nums">{total.issued}</td>
              <td className="text-right tabular-nums">{total.withUnresolved}</td>
              <td className="text-right tabular-nums">{total.issued ? `${Math.round((total.withUnresolved / total.issued) * 1000) / 10}%` : "―"}</td>
              <td className="text-right tabular-nums">{total.returned}</td>
              <td />
            </tr>
          </tbody>
        </Table>
        <ul className="mt-3 list-disc pl-5 text-xs text-slate-500">
          <li>発令月は初回発令の月です。差戻し件数は差し戻した月で数えます。</li>
          <li>「発令時点で未確定あり」は、初回発令の時点で未確定項目が1件以上あったオーダーです（ヒアリングでは太陽光案件で約2〜3割）。割合が30%以上の月を強調しています。</li>
          <li>受入までの平均日数は、初回発令から受入までの日数（暦日）の平均です。</li>
        </ul>
      </Card>
    </>
  );
}
