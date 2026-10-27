import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// 開発時のホットリロードで接続が増えないよう、プロセス内で1つだけ作る
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  // 接続数の上限（Cloud SQL の小さいインスタンスは同時接続数が少ないため、環境変数で絞る）
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_MAX ?? 10) });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** トランザクション内のクライアント型 */
export type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;
