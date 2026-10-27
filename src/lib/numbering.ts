// オーダー番号の採番（SPEC §4.1）
import type { NumberingRule } from "@/generated/prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { todayStr } from "@/lib/dates";

type RuleLike = Pick<
  NumberingRule,
  "prefix" | "yearFormat" | "separator" | "digits" | "resetUnit" | "fiscalYearStartMonth"
>;

export const DEFAULT_RULE: RuleLike = {
  prefix: "WE-",
  yearFormat: "YYYY",
  separator: "-",
  digits: 4,
  resetUnit: "YEAR",
  fiscalYearStartMonth: 4,
};

/** 番号に使う年（年度リセットのときは年度） */
function numberYear(rule: RuleLike, now: Date) {
  const [y, m] = todayStr(now).split("-").map(Number);
  if (rule.resetUnit === "FISCAL_YEAR" && m < rule.fiscalYearStartMonth) return y - 1;
  return y;
}

/** リセット単位のキー */
export function periodKey(rule: RuleLike, now: Date = new Date()) {
  if (rule.resetUnit === "NONE") return "ALL";
  const y = numberYear(rule, now);
  return rule.resetUnit === "FISCAL_YEAR" ? `FY${y}` : String(y);
}

/** 連番からオーダー番号の文字列を作る */
export function formatOrderNumber(rule: RuleLike, seq: number, now: Date = new Date()) {
  const y = numberYear(rule, now);
  const yearPart =
    rule.yearFormat === "YYYY" ? String(y) : rule.yearFormat === "YY" ? String(y).slice(-2) : "";
  const seqPart = String(seq).padStart(rule.digits, "0");
  return `${rule.prefix}${yearPart}${yearPart ? rule.separator : ""}${seqPart}`;
}

/** 次の番号を採番する（同時実行でも重複しないよう DB で加算する）。手入力済みの番号とは重ならないようにする */
export async function issueOrderNumber(tx: Tx, now: Date = new Date()): Promise<string> {
  const rule =
    (await tx.numberingRule.findUnique({ where: { id: "default" } })) ??
    (await tx.numberingRule.create({ data: { id: "default", ...DEFAULT_RULE } }));
  const key = periodKey(rule, now);
  for (let i = 0; i < 1000; i++) {
    const rows = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO "NumberingCounter" ("ruleId", "periodKey", "value", "updatedAt")
      VALUES (${rule.id}, ${key}, 1, NOW())
      ON CONFLICT ("ruleId", "periodKey")
      DO UPDATE SET "value" = "NumberingCounter"."value" + 1, "updatedAt" = NOW()
      RETURNING "value"`;
    const number = formatOrderNumber(rule, rows[0].value, now);
    const exists = await tx.order.findUnique({ where: { orderNumber: number }, select: { id: true } });
    if (!exists) return number;
  }
  throw new Error("オーダー番号を採番できませんでした。採番ルールを確認してください。");
}

/** 次に採番される番号の見込み（管理画面の表示用） */
export async function previewNextNumber(now: Date = new Date()) {
  const rule = (await prisma.numberingRule.findUnique({ where: { id: "default" } })) ?? {
    id: "default",
    ...DEFAULT_RULE,
  };
  const key = periodKey(rule, now);
  const counter = await prisma.numberingCounter.findUnique({
    where: { ruleId_periodKey: { ruleId: rule.id, periodKey: key } },
  });
  return { rule, periodKey: key, current: counter?.value ?? 0, next: formatOrderNumber(rule, (counter?.value ?? 0) + 1, now) };
}
