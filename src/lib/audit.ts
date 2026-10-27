// 監査ログ（SPEC §4.11）
import { prisma, type Tx } from "@/lib/db";

export type AuditInput = {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  targetLabel?: string | null;
  before?: unknown;
  after?: unknown;
};

/** 監査ログの操作名の日本語表示 */
export const auditActionLabel: Record<string, string> = {
  LOGIN: "ログイン",
  LOGIN_FAILED: "ログイン失敗",
  PASSWORD_CHANGE: "パスワード変更",
  PASSWORD_RESET: "パスワード再設定",
  USER_CREATE: "ユーザー登録",
  USER_UPDATE: "ユーザー変更",
  ORDER_CREATE: "オーダー作成（発番）",
  ORDER_UPDATE: "オーダー基本情報の変更",
  STATUS_CHANGE: "ステータス変更",
  TECH_ASSIGN: "技術担当の割当",
  SPEC_UPDATE: "要求仕様書の変更",
  DOCUMENT_UPDATE: "資料の変更",
  DOCUMENT_VERSION_ADD: "資料の版の登録",
  UNRESOLVED_CREATE: "未確定項目の登録",
  UNRESOLVED_UPDATE: "未確定項目の変更",
  MASTER_CREATE: "マスタ登録",
  MASTER_UPDATE: "マスタ変更",
  SETTING_UPDATE: "設定変更",
  AI_ADOPT: "AI下書きの採用",
};

function toJson(v: unknown) {
  if (v === undefined) return undefined;
  return JSON.parse(JSON.stringify(v));
}

export async function writeAudit(input: AuditInput, tx: Tx = prisma) {
  await tx.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      targetLabel: input.targetLabel ?? null,
      before: toJson(input.before),
      after: toJson(input.after),
    },
  });
}

/** 変更があった項目だけを取り出す（変更前後の記録用） */
export function diffFields<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const bv = before[key];
    const av = after[key];
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v === undefined ? null : JSON.stringify(v));
    if (norm(bv) !== norm(av)) {
      b[key] = bv ?? null;
      a[key] = av ?? null;
    }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}
