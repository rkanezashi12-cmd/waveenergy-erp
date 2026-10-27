"use server";
import { ResetUnit, YearFormat } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireAdminAction } from "@/lib/admin";
import { diffFields, writeAudit } from "@/lib/audit";
import { UserError, toActionError, type ActionResult } from "@/lib/errors";
import { enumVal } from "@/lib/form-data";
import { DEFAULT_RULE } from "@/lib/numbering";
import { previewRule, type RulePreview } from "./preview";
import { intField } from "../_util";

const YEAR_FORMATS = Object.values(YearFormat);
const RESET_UNITS = Object.values(ResetUnit);

/** 入力値の読み取り（空白は前後も含めてそのまま使うため trim しない） */
function raw(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function readRule(fd: FormData) {
  const prefix = raw(fd, "prefix");
  if (prefix.length > 10 || /\s/.test(prefix))
    throw new UserError("接頭辞は空白を含まない10文字以内にしてください。", { prefix: "空白を含まない10文字以内にしてください。" });
  const separator = raw(fd, "separator");
  if (separator.length > 3 || /\s/.test(separator))
    throw new UserError("区切り文字は空白を含まない3文字以内にしてください。", { separator: "空白を含まない3文字以内にしてください。" });
  const yearFormat = enumVal(fd, "yearFormat", YEAR_FORMATS);
  if (!yearFormat) throw new UserError("年の表記を選んでください。", { yearFormat: "年の表記を選んでください。" });
  const resetUnit = enumVal(fd, "resetUnit", RESET_UNITS);
  if (!resetUnit) throw new UserError("リセット単位を選んでください。", { resetUnit: "リセット単位を選んでください。" });
  const digits = intField(fd, "digits", "連番の桁数", { min: 1, max: 8, required: true })!;
  const fiscalYearStartMonth = intField(fd, "fiscalYearStartMonth", "年度の開始月", { min: 1, max: 12, required: true })!;
  // 年を含めずに毎年リセットすると、毎年同じ番号が作られてしまう
  if (yearFormat === "NONE" && resetUnit !== "NONE")
    throw new UserError("年を含めない場合は、リセット単位を「リセットしない」にしてください（毎年同じ番号になるため）。", {
      resetUnit: "年を含めない場合は「リセットしない」にしてください。",
    });
  if (!prefix && yearFormat === "NONE")
    throw new UserError("接頭辞も年も無いと番号が数字だけになります。接頭辞か年の表記を設定してください。", { prefix: "接頭辞を入力してください。" });
  return { prefix, separator, yearFormat, resetUnit, digits, fiscalYearStartMonth };
}

/** 画面の入力に合わせた見込み表示（保存はしない） */
export async function previewNumbering(fd: FormData): Promise<ActionResult<RulePreview>> {
  try {
    await requireAdminAction();
    const rule = readRule(fd);
    return { ok: true, data: await previewRule(rule) };
  } catch (e) {
    return toActionError(e);
  }
}

/** 採番ルールの保存 */
export async function saveNumbering(fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireAdminAction();
    const data = readRule(fd);
    const before = (await prisma.numberingRule.findUnique({ where: { id: "default" } })) ?? { id: "default", ...DEFAULT_RULE };
    const diff = diffFields(before, data);
    if (!diff.changed) return { ok: true, message: "変更はありません。" };
    await prisma.numberingRule.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });
    await writeAudit({
      actorId: actor.id,
      action: "SETTING_UPDATE",
      targetType: "NumberingRule",
      targetId: "default",
      targetLabel: "採番ルール",
      before: diff.before,
      after: diff.after,
    });
    const p = await previewRule(data);
    return { ok: true, message: `保存しました。次に採番される番号は ${p.next ?? "（採番できません）"} です。` };
  } catch (e) {
    return toActionError(e);
  }
}
