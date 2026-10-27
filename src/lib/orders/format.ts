// 仕様項目の値の表示（サーバー・ブラウザ共通）

/** 複数選択の値（JSON配列）を配列にする */
export function parseMulti(v: string | null): string[] {
  if (!v) return [];
  try {
    const a = JSON.parse(v);
    return Array.isArray(a) ? a.map(String) : [v];
  } catch {
    return [v];
  }
}

/** 仕様項目の値を表示用の文字列にする */
export function specValueText(inputType: string, v: string | null): string {
  if (!v) return "";
  return inputType === "MULTISELECT" ? parseMulti(v).join("、") : v;
}
