// オーダー一覧の CSV 出力（一覧と同じ絞り込み条件）
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { fmtDate, fmtDateTime, isOverdue, todayStr } from "@/lib/dates";
import { deliveryTypeLabel, orderDocTypeLabel, orderStatusLabel } from "@/lib/labels";
import { orderListInclude, orderWhere, parseOrderFilter } from "@/lib/orders/queries";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.mustChangePassword) return new Response("ログインしてください。", { status: 401 });
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const where = await orderWhere(user, parseOrderFilter(sp));
  const orders = await prisma.order.findMany({ where, include: orderListInclude, orderBy: { orderNumber: "asc" } });
  const csv = toCsv(
    ["オーダー番号", "ステータス", "製品区分", "顧客名", "件名", "現場名", "エンドユーザー", "数量", "単位", "営業担当", "営業部署", "技術担当", "契約納期", "納期区分", "短納期", "注文書／内示書", "見積番号", "引合番号", "発令日時", "受入日時", "仕様確定日時", "発令時点の未確定項目数", "未確定項目数", "期限超過の未確定項目数"],
    orders.map((o) => [
      o.orderNumber,
      orderStatusLabel[o.status],
      o.productCategory?.name,
      o.customer?.name,
      o.title,
      o.siteName,
      o.endUser,
      o.quantity?.toString(),
      o.quantityUnit,
      o.salesUser.name,
      o.salesDepartment?.name,
      o.techUser?.name,
      fmtDate(o.contractDeliveryDate),
      o.deliveryType ? deliveryTypeLabel[o.deliveryType] : "",
      o.shortLeadTime ? "短納期" : "",
      o.orderDocType ? orderDocTypeLabel[o.orderDocType] : "",
      o.quoteNumber,
      o.inquiryNumber,
      fmtDateTime(o.issuedAt),
      fmtDateTime(o.acceptedAt),
      fmtDateTime(o.specFixedAt),
      o.unresolvedCountAtIssue,
      o.unresolvedItems.length,
      o.unresolvedItems.filter((i) => isOverdue(i.dueDate)).length,
    ]),
  );
  return csvResponse(`オーダー一覧_${todayStr()}.csv`, csv);
}
