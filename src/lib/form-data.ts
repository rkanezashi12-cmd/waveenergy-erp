// FormData から値を取り出す補助関数
import { parseDateOnly } from "@/lib/dates";

export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
export const optStr = (fd: FormData, k: string) => str(fd, k) || null;
export const bool = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return v === "on" || v === "true" || v === "1";
};
/** "true" / "false" / 未選択（null） */
export const triBool = (fd: FormData, k: string): boolean | null => {
  const v = str(fd, k);
  return v === "true" ? true : v === "false" ? false : null;
};
export const int = (fd: FormData, k: string): number | null => {
  const v = str(fd, k);
  if (!v) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
};
export const date = (fd: FormData, k: string) => parseDateOnly(str(fd, k));
export const all = (fd: FormData, k: string) => fd.getAll(k).filter((v): v is string => typeof v === "string" && v !== "");
/** 列挙型の値として受け取る（不正な値は null） */
export function enumVal<T extends string>(fd: FormData, k: string, values: readonly T[]): T | null {
  const v = str(fd, k);
  return (values as readonly string[]).includes(v) ? (v as T) : null;
}
