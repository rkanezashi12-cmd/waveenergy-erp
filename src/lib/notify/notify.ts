// 通知（アプリ内通知＋メール）。宛先は関係者だけに絞る（SPEC §4.8）
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import type { NotificationType } from "@/generated/prisma/enums";
import { sendMail } from "@/lib/notify/mail";

export type NotifyInput = {
  type: NotificationType;
  userIds: (string | null | undefined)[];
  orderId?: string | null;
  title: string;
  body: string;
  /** アプリ内のパス（例：/orders/xxx） */
  link?: string | null;
  /** 操作した本人には通知しない */
  actorId?: string | null;
};

/** 通知を作成し、ユーザーのメール設定に従ってメールを送る */
export async function notify(input: NotifyInput) {
  const ids = [...new Set(input.userIds.filter((v): v is string => !!v))].filter(
    (id) => id !== input.actorId,
  );
  if (!ids.length) return;
  const users = await prisma.user.findMany({ where: { id: { in: ids }, active: true } });
  const isDigest = input.type === "DAILY_DIGEST";
  for (const user of users) {
    const wantsMail = isDigest ? user.emailPreference !== "NONE" : user.emailPreference === "ALL";
    const notification = await prisma.notification.create({
      data: {
        userId: user.id,
        type: input.type,
        orderId: input.orderId ?? null,
        title: input.title,
        body: input.body,
        link: input.link ?? null,
      },
    });
    if (!wantsMail) continue;
    const url = input.link ? `${env.appBaseUrl}${input.link}` : env.appBaseUrl;
    const mail = await sendMail({
      to: user.email,
      subject: `【オーダー管理】${input.title}`,
      body: `${user.name} 様\n\n${input.body}\n\n${url}`,
    });
    await prisma.notification.update({
      where: { id: notification.id },
      data: { emailResult: mail.result, emailId: mail.id },
    });
  }
}

/** 製品区分の技術受付（未設定なら技術受付ロールの全員） */
export async function receptionUserIds(productCategoryId: string | null): Promise<string[]> {
  if (productCategoryId) {
    const cat = await prisma.productCategory.findUnique({
      where: { id: productCategoryId },
      include: { receptionUsers: { where: { active: true }, select: { id: true } } },
    });
    if (cat?.receptionUsers.length) return cat.receptionUsers.map((u) => u.id);
  }
  const users = await prisma.user.findMany({
    where: { active: true, roles: { has: "TECH_RECEPTION" } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** 製品区分に設定された通知グループ（関係部門）のユーザー */
export async function groupUserIds(productCategoryId: string | null): Promise<string[]> {
  if (!productCategoryId) return [];
  const cat = await prisma.productCategory.findUnique({
    where: { id: productCategoryId },
    include: {
      notificationGroups: {
        where: { active: true },
        include: {
          users: { where: { active: true }, select: { id: true } },
          departments: { include: { users: { where: { active: true }, select: { id: true } } } },
        },
      },
    },
  });
  const ids = new Set<string>();
  for (const g of cat?.notificationGroups ?? []) {
    g.users.forEach((u) => ids.add(u.id));
    g.departments.forEach((d) => d.users.forEach((u) => ids.add(u.id)));
  }
  return [...ids];
}
