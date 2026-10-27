"use server";
// AI下書きの採用（項目ごとの採用／修正／却下を反映する）
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { toActionError, type ActionResult } from "@/lib/errors";
import { all, date, enumVal, optStr, str } from "@/lib/form-data";
import { adoptAiDraft, type Decision } from "@/lib/ai/draft";
import { BASIC_FIELDS, type BasicKey } from "@/lib/ai/prompt";

const DECISIONS: Decision[] = ["adopt", "modify", "reject"];

export async function adoptAiDraftAction(orderId: string, runId: string, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireUser();
    const basic: Partial<Record<BasicKey, { decision: Decision; value: string }>> = {};
    for (const b of BASIC_FIELDS) {
      const decision = enumVal(fd, `d_basic_${b.key}`, DECISIONS);
      if (!decision) continue;
      basic[b.key] = { decision, value: decision === "modify" ? str(fd, `m_basic_${b.key}`) : str(fd, `c_basic_${b.key}`) };
    }
    const fields: Record<string, { decision: Decision; value: string }> = {};
    for (const id of all(fd, "fieldIds")) {
      const decision = enumVal(fd, `d_field_${id}`, DECISIONS);
      if (!decision) continue;
      let value: string;
      if (decision === "modify") {
        const multi = str(fd, `multi_${id}`) === "1";
        const vals = fd.getAll(`m_field_${id}`).filter((v): v is string => typeof v === "string" && v !== "");
        value = multi ? (vals.length ? JSON.stringify(vals) : "") : str(fd, `m_field_${id}`);
      } else value = str(fd, `c_field_${id}`);
      fields[id] = { decision, value };
    }
    const missing = all(fd, "missing");
    const assigneeId = str(fd, "miss_assigneeId");
    const dueDate = date(fd, "miss_dueDate");
    await adoptAiDraft(actor, orderId, {
      runId,
      productCategoryId: optStr(fd, "productCategoryId"),
      basic,
      fields,
      missing,
      missingUnresolved:
        assigneeId && dueDate
          ? { assigneeId, dueDate, confirmTarget: "CUSTOMER", responsibleType: "SALES", designImpact: "PARTIAL_START", knownInfo: "AI下書きで資料から読み取れなかった項目" }
          : null,
    });
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/orders/${orderId}/edit?step=3&adopted=1`);
}
