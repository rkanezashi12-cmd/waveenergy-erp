// 管理画面の共通処理
import { requireUser, type CurrentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { ForbiddenError } from "@/lib/errors";

/** 管理者のみ（サーバーアクション用。権限が無ければ例外） */
export async function requireAdminAction(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can.admin(user)) throw new ForbiddenError();
  return user;
}
