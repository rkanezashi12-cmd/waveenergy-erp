// 採番の見込み（管理画面の表示用）
import type { NumberingRule } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { formatOrderNumber, periodKey } from "@/lib/numbering";

type RuleLike = Pick<NumberingRule, "prefix" | "yearFormat" | "separator" | "digits" | "resetUnit" | "fiscalYearStartMonth">;

/**
 * 指定したルールで次に採番される番号の見込み。
 * 採番は既存のオーダー番号（手入力・ルール変更前の番号）と重なる番号を飛ばすため、ここでも同じように飛ばす
 */
export async function previewRule(rule: RuleLike, now: Date = new Date()) {
  const key = periodKey(rule, now);
  const counter = await prisma.numberingCounter.findUnique({ where: { ruleId_periodKey: { ruleId: "default", periodKey: key } } });
  const current = counter?.value ?? 0;
  const candidates = Array.from({ length: 1000 }, (_, i) => formatOrderNumber(rule, current + 1 + i, now));
  const used = new Set((await prisma.order.findMany({ where: { orderNumber: { in: candidates } }, select: { orderNumber: true } })).map((o) => o.orderNumber));
  const next = candidates.find((c) => !used.has(c)) ?? null;
  return {
    periodKey: key,
    current,
    currentNumber: current > 0 ? formatOrderNumber(rule, current, now) : null,
    next,
    /** 既存の番号と重なるため飛ばす番号の数 */
    skipped: next ? candidates.indexOf(next) : candidates.length,
  };
}

export type RulePreview = Awaited<ReturnType<typeof previewRule>>;
