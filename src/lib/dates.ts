// 日付の扱い：業務日付は日本時間（Asia/Tokyo）で判定し、
// DBの日付型（@db.Date）には UTC 0時の Date として保存する。

const TZ = "Asia/Tokyo";

/** 日本時間の今日を "YYYY-MM-DD" で返す */
export function todayStr(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(now);
}

/** "YYYY-MM-DD" を DB 日付型用の Date（UTC 0時）にする。不正なら null */
export function parseDateOnly(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCMonth() !== Number(m[2]) - 1) return null;
  return d;
}

/** DB 日付型の Date を "YYYY-MM-DD" にする */
export function dateOnlyStr(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

/** 日本時間の今日（DB 日付型と比較できる形） */
export function today(now: Date = new Date()): Date {
  return parseDateOnly(todayStr(now))!;
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

export function addMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + months);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}

/** 期限超過か（期限日の翌日から超過） */
export function isOverdue(due: Date | null | undefined, now: Date = new Date()): boolean {
  if (!due) return false;
  return due.getTime() < today(now).getTime();
}

/** 2つの日付（DB 日付型）の差（日数） */
export function diffDays(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/** 土日を除く営業日数の経過を判定する。祝日は考慮しない（HANDOVER 確認事項） */
export function businessDaysBetween(from: Date, to: Date): number {
  const start = parseDateOnly(todayStr(from))!;
  const end = parseDateOnly(todayStr(to))!;
  let count = 0;
  for (let d = addDays(start, 1); d.getTime() <= end.getTime(); d = addDays(d, 1)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) count++;
  }
  return count;
}

/** 日本時間で平日か */
export function isWeekday(now: Date = new Date()): boolean {
  const wd = today(now).getUTCDay();
  return wd !== 0 && wd !== 6;
}

/** 表示用：YYYY/MM/DD */
export function fmtDate(d: Date | null | undefined): string {
  if (!d) return "";
  return dateOnlyStr(d).replaceAll("-", "/");
}

/** 表示用：日本時間の YYYY/MM/DD HH:mm */
export function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return "";
  const s = new Intl.DateTimeFormat("ja-JP", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return s;
}

/** 日本時間の年月 "YYYY-MM" */
export function monthKey(d: Date): string {
  return todayStr(d).slice(0, 7);
}
