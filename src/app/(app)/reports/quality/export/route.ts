// 発令品質レポートの CSV 出力
import { getCurrentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { csvResponse, toCsv } from "@/lib/csv";
import { todayStr } from "@/lib/dates";
import { issueQuality } from "@/lib/reports";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.mustChangePassword) return new Response("ログインしてください。", { status: 401 });
  if (!can.viewReports(user)) return new Response("権限がありません。", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const rows = await issueQuality(user, { categoryId: sp.get("category") || undefined, departmentId: sp.get("department") || undefined });
  return csvResponse(
    `発令品質_${todayStr()}.csv`,
    toCsv(
      ["発令月", "発令件数", "発令時点で未確定ありの件数", "割合（%）", "差戻し件数", "受入までの平均日数"],
      rows.map((r) => [r.month, r.issued, r.withUnresolved, r.withUnresolvedRate, r.returned, r.avgDaysToAccept]),
    ),
  );
}
