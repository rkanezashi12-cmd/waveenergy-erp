/** パスワードの条件：8文字以上、英字と数字を含む */
export function validatePassword(p: string): string | null {
  if (p.length < 8) return "パスワードは8文字以上にしてください。";
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return "パスワードには英字と数字を含めてください。";
  return null;
}

/** 初期パスワードの生成（管理者がユーザーを登録・再設定するとき） */
export function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let s = Array.from(bytes, (b) => chars[b % chars.length]).join("");
  if (!/\d/.test(s)) s = s.slice(0, -1) + "7";
  if (!/[A-Za-z]/.test(s)) s = "a" + s.slice(1);
  return s;
}
