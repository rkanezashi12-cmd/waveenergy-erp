// システム設定（AI機能のオン／オフ、受入催促の日数など）
import { prisma } from "@/lib/db";

export async function getSystemSetting() {
  return (
    (await prisma.systemSetting.findUnique({ where: { id: "default" } })) ??
    (await prisma.systemSetting.create({ data: { id: "default" } }))
  );
}
