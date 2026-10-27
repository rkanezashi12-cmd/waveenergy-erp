import { NextResponse } from "next/server";
import { runDailyDigest, verifyCronRequest } from "@/lib/cron";

export const maxDuration = 300;

export async function POST(req: Request) {
  if (!(await verifyCronRequest(req))) return NextResponse.json({ ok: false, error: "認証できません。" }, { status: 401 });
  const result = await runDailyDigest();
  console.info(JSON.stringify({ severity: "INFO", message: "毎朝のまとめ通知を実行しました", ...result }));
  return NextResponse.json({ ok: true, ...result });
}
