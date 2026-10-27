// 画面に表示するエラー
export class UserError extends Error {
  fieldErrors?: Record<string, string>;
  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.fieldErrors = fieldErrors;
  }
}

export type ActionResult<T = unknown> =
  | { ok: true; message?: string; warnings?: string[]; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** サーバーアクションの例外を画面表示用の結果に変換する */
export function toActionError(e: unknown): { ok: false; error: string; fieldErrors?: Record<string, string> } {
  if (e instanceof UserError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
  // Next.js の redirect / notFound はそのまま投げ直す
  if (e && typeof e === "object" && "digest" in e && typeof (e as { digest: unknown }).digest === "string") {
    const d = (e as { digest: string }).digest;
    if (d.startsWith("NEXT_REDIRECT") || d.startsWith("NEXT_HTTP_ERROR_FALLBACK") || d === "NEXT_NOT_FOUND") throw e;
  }
  if (e instanceof ForbiddenError) return { ok: false, error: e.message };
  console.error(JSON.stringify({ severity: "ERROR", message: "処理中にエラーが発生しました", error: e instanceof Error ? e.stack : String(e) }));
  return { ok: false, error: "処理中にエラーが発生しました。時間をおいて再度お試しください。" };
}

/** 権限が無い操作 */
export class ForbiddenError extends Error {
  constructor(message = "この操作を行う権限がありません。") {
    super(message);
  }
}
