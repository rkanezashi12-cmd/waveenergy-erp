// 管理画面のサーバーアクションで共通に使う入力チェック
import { UserError } from "@/lib/errors";
import { int, str } from "@/lib/form-data";

/** 整数の入力（範囲チェック付き）。空欄は null。不正なら UserError */
export function intField(fd: FormData, key: string, label: string, opts: { min: number; max: number; required?: boolean }): number | null {
  const v = int(fd, key);
  if (v === null) {
    if (opts.required) throw new UserError(`${label}を入力してください。`, { [key]: `${label}を入力してください。` });
    return null;
  }
  if (Number.isNaN(v) || v < opts.min || v > opts.max) {
    const msg = `${label}は${opts.min}〜${opts.max}の整数で入力してください。`;
    throw new UserError(msg, { [key]: msg });
  }
  return v;
}

/** 必須の文字列（最大文字数チェック付き） */
export function requiredStr(fd: FormData, key: string, label: string, max = 100): string {
  const v = str(fd, key);
  if (!v) throw new UserError(`${label}を入力してください。`, { [key]: `${label}を入力してください。` });
  if (v.length > max) throw new UserError(`${label}は${max}文字以内で入力してください。`, { [key]: `${max}文字以内で入力してください。` });
  return v;
}

/** 並び順の入力（空欄は 0） */
export function sortOrderField(fd: FormData): number {
  return intField(fd, "sortOrder", "並び順", { min: 0, max: 99999 }) ?? 0;
}

/**
 * 並べ替え：対象を1つ上／下の項目と入れ替え、並び順を 10, 20, 30… に振り直す。
 * 戻り値は振り直した後の並び順（変更があったものだけ）
 */
export function swapOrder<T extends { id: string; sortOrder: number }>(items: T[], id: string, dir: "up" | "down"): { id: string; sortOrder: number }[] | null {
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  const to = dir === "up" ? idx - 1 : idx + 1;
  if (to < 0 || to >= items.length) return [];
  const list = [...items];
  [list[idx], list[to]] = [list[to], list[idx]];
  return list
    .map((item, i) => ({ id: item.id, sortOrder: (i + 1) * 10, old: item.sortOrder }))
    .filter((x) => x.sortOrder !== x.old)
    .map(({ id: itemId, sortOrder }) => ({ id: itemId, sortOrder }));
}

/** 複数行テキストを1行1項目の配列にする（空行・重複は除く） */
export function lines(fd: FormData, key: string): string[] {
  const raw = typeof fd.get(key) === "string" ? (fd.get(key) as string) : "";
  return [
    ...new Set(
      raw
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
