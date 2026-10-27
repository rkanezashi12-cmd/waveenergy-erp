// 定期処理（Cloud Scheduler から呼ばれる。SPEC §4.8）
//   毎朝のまとめ：平日朝、各ユーザーに期限超過・期限が近い未確定項目とタスク、受入待ち（技術受付のみ）を通知
//   受入催促：発令後、受入されないまま設定日数（営業日）たったら技術受付と営業担当に再通知
import { OAuth2Client } from "google-auth-library";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { addDays, businessDaysBetween, fmtDate, isOverdue, isWeekday, today, todayStr } from "@/lib/dates";
import { notify, receptionUserIds } from "@/lib/notify/notify";
import { OPEN_UNRESOLVED } from "@/lib/orders/rules";
import { getSystemSetting } from "@/lib/settings";
import { orderLabel, orderLink } from "@/lib/orders/common";

let oauth: OAuth2Client | null = null;

/** 定期処理の呼び出し元を確認する（OIDC トークン、またはローカル用の共有シークレット） */
export async function verifyCronRequest(req: Request): Promise<boolean> {
  const secret = req.headers.get("x-cron-secret");
  if (env.cronSecret && secret && secret === env.cronSecret) return true;
  const authz = req.headers.get("authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
  if (!token || !env.cronOidcAudience || !env.cronServiceAccount) return false;
  try {
    oauth ??= new OAuth2Client();
    const ticket = await oauth.verifyIdToken({ idToken: token, audience: env.cronOidcAudience });
    const p = ticket.getPayload();
    return !!p && p.email === env.cronServiceAccount && p.email_verified === true;
  } catch {
    return false;
  }
}

/** 毎朝のまとめ通知。同じ日に2回呼ばれても重複して送らない */
export async function runDailyDigest(now: Date = new Date()) {
  if (!isWeekday(now)) return { skipped: "休日のため送信しません。", sent: 0 };
  const setting = await getSystemSetting();
  const t = today(now);
  const soon = addDays(t, setting.digestDueSoonDays);
  const startOfDayJst = new Date(`${todayStr(now)}T00:00:00+09:00`);
  const users = await prisma.user.findMany({ where: { active: true } });
  const acceptPending = await prisma.order.findMany({ where: { status: "ACCEPT_PENDING" }, orderBy: { issuedAt: "asc" } });
  let sent = 0;
  for (const u of users) {
    const already = await prisma.notification.count({ where: { userId: u.id, type: "DAILY_DIGEST", createdAt: { gte: startOfDayJst } } });
    if (already) continue;
    const [items, tasks] = await Promise.all([
      prisma.unresolvedItem.findMany({
        where: { assigneeId: u.id, status: { in: OPEN_UNRESOLVED }, dueDate: { lte: soon }, order: { status: { not: "CANCELLED" } } },
        include: { order: { select: { orderNumber: true, title: true } } },
        orderBy: { dueDate: "asc" },
      }),
      prisma.task.findMany({
        where: { assigneeId: u.id, status: { not: "DONE" }, dueDate: { lte: soon }, order: { status: { not: "CANCELLED" } } },
        include: { order: { select: { orderNumber: true } }, taskType: true },
        orderBy: { dueDate: "asc" },
      }),
    ]);
    const pending = u.roles.includes("TECH_RECEPTION") ? acceptPending : [];
    if (!items.length && !tasks.length && !pending.length) continue;
    const lines: string[] = [];
    const overdueItems = items.filter((i) => isOverdue(i.dueDate, now));
    const soonItems = items.filter((i) => !isOverdue(i.dueDate, now));
    if (overdueItems.length) {
      lines.push(`■ 期限超過の未確定項目（${overdueItems.length}件）`);
      overdueItems.forEach((i) => lines.push(`・${i.order.orderNumber} ${i.title}（期限 ${fmtDate(i.dueDate)}）`));
    }
    if (soonItems.length) {
      lines.push(`■ 期限が${setting.digestDueSoonDays}日以内の未確定項目（${soonItems.length}件）`);
      soonItems.forEach((i) => lines.push(`・${i.order.orderNumber} ${i.title}（期限 ${fmtDate(i.dueDate)}）`));
    }
    if (tasks.length) {
      lines.push(`■ 期限超過・期限が近いタスク（${tasks.length}件）`);
      tasks.forEach((k) => lines.push(`・${k.order.orderNumber} ${k.taskType.name}：${k.content.slice(0, 40)}（期限 ${fmtDate(k.dueDate)}${isOverdue(k.dueDate, now) ? "・期限超過" : ""}）`));
    }
    if (pending.length) {
      lines.push(`■ 受入待ちのオーダー（${pending.length}件）`);
      pending.forEach((o) => lines.push(`・${orderLabel(o)}（発令から${o.issuedAt ? businessDaysBetween(o.issuedAt, now) : 0}営業日）`));
    }
    await notify({
      type: "DAILY_DIGEST",
      userIds: [u.id],
      title: `毎朝のまとめ（${todayStr(now).replaceAll("-", "/")}）${overdueItems.length ? `期限超過 ${overdueItems.length}件` : ""}`,
      body: lines.join("\n"),
      link: "/",
    });
    sent++;
  }
  return { sent };
}

/** 受入催促。1件のオーダーにつき1日1回まで */
export async function runAcceptReminder(now: Date = new Date()) {
  if (!isWeekday(now)) return { skipped: "休日のため送信しません。", reminded: 0 };
  const setting = await getSystemSetting();
  const startOfDayJst = new Date(`${todayStr(now)}T00:00:00+09:00`);
  const orders = await prisma.order.findMany({ where: { status: "ACCEPT_PENDING", issuedAt: { not: null } } });
  let reminded = 0;
  for (const o of orders) {
    const days = businessDaysBetween(o.issuedAt!, now);
    if (days < setting.acceptReminderBusinessDays) continue;
    if (o.lastAcceptReminderAt && o.lastAcceptReminderAt >= startOfDayJst) continue;
    await notify({
      type: "ACCEPT_REMINDER",
      userIds: [...(await receptionUserIds(o.productCategoryId)), o.salesUserId],
      orderId: o.id,
      title: `受入催促：${orderLabel(o)}`,
      body: `オーダー ${orderLabel(o)} は発令から${days}営業日、受入されていません。内容を確認し、受入または差戻しをしてください。`,
      link: orderLink(o.id),
    });
    await prisma.order.update({ where: { id: o.id }, data: { lastAcceptReminderAt: now } });
    reminded++;
  }
  return { reminded };
}
