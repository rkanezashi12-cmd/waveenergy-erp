// AI入力ファイルの一時保存（Cloud Storage。バケットのライフサイクル設定で30日後に自動削除）
// UPLOAD_BUCKET が未設定のときはローカルの LOCAL_UPLOAD_DIR に保存する（開発用）
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Storage } from "@google-cloud/storage";
import { env } from "@/lib/env";

let storage: Storage | null = null;

function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120) || "file";
}

/** ファイルを保存し、保存先（gs://… またはローカルパス）を返す */
export async function storeInput(orderId: string, runKey: string, file: { name: string; mimeType: string; bytes: Buffer }) {
  const objectPath = `ai-inputs/${orderId}/${runKey}/${safeName(file.name)}`;
  if (env.uploadBucket) {
    storage ??= new Storage();
    await storage.bucket(env.uploadBucket).file(objectPath).save(file.bytes, { contentType: file.mimeType, resumable: false });
    return `gs://${env.uploadBucket}/${objectPath}`;
  }
  const full = path.join(process.cwd(), env.localUploadDir, objectPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, file.bytes);
  return `local:${objectPath}`;
}
