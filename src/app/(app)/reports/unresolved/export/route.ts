// 未確定項目レポートの CSV 出力
import { getCurrentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { csvResponse, toCsv } from "@/lib/csv";
import { fmtDate, fmtDay, isOverdue, todayStr } from "@/lib/dates";
import { confirmTargetLabel, designImpactLabel, orderStatusLabel, responsibleTypeLabel, unresolvedStatusLabel, unresolvedTargetLabel } from "@/lib/labels";
import { parseUnresolvedFilter, unresolvedReport, unresolvedSummary, type SummaryAxis } from "@/lib/reports";
import { OPEN_UNRESOLVED } from "@/lib/orders/rules";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.mustChangePassword) return new Response("ログインしてください。", { status: 401 });
  if (!can.viewReports(user)) return new Response("権限がありません。", { status: 403 });
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  if (sp.type === "summary") {
    const axis: SummaryAxis = sp.axis === "category" || sp.axis === "department" ? sp.axis : "month";
    const rows = await unresolvedSummary(user, axis);
    const head = { month: "登録月", category: "製品区分", department: "営業部署" }[axis];
    return csvResponse(
      `未確定項目の集計_${head}_${todayStr()}.csv`,
      toCsv([head, "登録件数", "未確定（現在）", "うち期限超過", "確定件数", "確定までの平均日数"], rows.map((r) => [r.label, r.registered, r.open, r.overdue, r.resolved, r.avgDaysToResolve])),
    );
  }
  const items = await unresolvedReport(user, parseUnresolvedFilter(sp));
  return csvResponse(
    `未確定項目一覧_${todayStr()}.csv`,
    toCsv(
      ["オーダー番号", "オーダーのステータス", "顧客名", "件名", "製品区分", "営業担当", "営業部署", "対象の種類", "対象", "現状わかっていること", "確認先", "確認担当区分", "担当者", "回答期限", "期限超過", "設計への影響", "状態", "確定内容・取下げ理由", "確定日", "記録者", "登録日"],
      items.map((i) => [
        i.order.orderNumber,
        orderStatusLabel[i.order.status],
        i.order.customer?.name,
        i.order.title,
        i.order.productCategory?.name,
        i.order.salesUser.name,
        i.order.salesDepartment?.name,
        unresolvedTargetLabel[i.targetType],
        i.title,
        i.knownInfo,
        confirmTargetLabel[i.confirmTarget],
        responsibleTypeLabel[i.responsibleType],
        i.assignee.name,
        fmtDate(i.dueDate),
        OPEN_UNRESOLVED.includes(i.status) && isOverdue(i.dueDate) ? "期限超過" : "",
        designImpactLabel[i.designImpact],
        unresolvedStatusLabel[i.status],
        i.resolution,
        i.resolvedDate ? fmtDate(i.resolvedDate) : fmtDay(i.resolvedAt),
        i.resolvedBy?.name,
        fmtDay(i.createdAt),
      ]),
    ),
  );
}
