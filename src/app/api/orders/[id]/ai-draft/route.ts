// AI下書きの実行（ファイルのアップロードを伴うため、サーバーアクションではなく API で受ける）
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { runAiDraft, type InputFile } from "@/lib/ai/draft";
import { toActionError } from "@/lib/errors";

export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || user.mustChangePassword) return NextResponse.json({ ok: false, error: "ログインしてください。" }, { status: 401 });
  try {
    const fd = await req.formData();
    const files: InputFile[] = [];
    for (const v of fd.getAll("files")) {
      if (typeof v === "string" || !v.size) continue;
      files.push({ name: v.name, mimeType: v.type, bytes: Buffer.from(await v.arrayBuffer()) });
    }
    const text = typeof fd.get("text") === "string" ? (fd.get("text") as string) : "";
    const runId = await runAiDraft(user, id, { files, text });
    return NextResponse.json({ ok: true, runId });
  } catch (e) {
    const r = toActionError(e);
    return NextResponse.json(r, { status: 400 });
  }
}
