"use server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import type { ActionResult } from "@/lib/errors";

export async function markAllReadAction(): Promise<ActionResult> {
  const user = await requireUser();
  const r = await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  return { ok: true, message: `${r.count}件を既読にしました。` };
}

export async function markReadAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  await prisma.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
  return { ok: true };
}
