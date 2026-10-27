import { NextResponse } from "next/server";
import { runAcceptReminder, verifyCronRequest } from "@/lib/cron";

export const maxDuration = 300;

export async function POST(req: Request) {
  if (!(await verifyCronRequest(req))) return NextResponse.json({ ok: false, error: "認証できません。" }, { status: 401 });
  const result = await runAcceptReminder();
  console.info(JSON.stringify({ severity: "INFO", message: "受入催促を実行しました", ...result }));
  return NextResponse.json({ ok: true, ...result });
}
