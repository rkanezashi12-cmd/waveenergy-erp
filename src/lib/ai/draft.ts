// AIによる要求仕様書の下書き（SPEC §4.4）
//   1. 入力ファイルを一時保存（Cloud Storage、30日で自動削除）
//   2. 製品区分のテンプレートを渡して Gemini に候補値と根拠を JSON で返させる
//   3. 実行記録（入力ファイル名・モデル名・トークン数・出力JSON）を保存する
//   4. 営業が項目ごとに採用／修正／却下を選び、採用したものだけを要求仕様書に反映する
import { randomUUID } from "node:crypto";
import { simpleParser } from "mailparser";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { dateOnlyStr, parseDateOnly } from "@/lib/dates";
import { ForbiddenError, UserError } from "@/lib/errors";
import { can, type Actor } from "@/lib/permissions";
import { getSystemSetting } from "@/lib/settings";
import { requireOrderAccess } from "@/lib/orders/common";
import { saveSpecValues, updateBasic, type BasicInput, type SpecEntry } from "@/lib/orders/service";
import type { UnresolvedInput } from "@/lib/orders/unresolved";
import { BASIC_FIELDS, buildPrompt, normalizeOutput, responseSchema, SYSTEM_INSTRUCTION, type AiDraftOutput, type BasicKey, type TemplateForAi } from "@/lib/ai/prompt";
import { callAi, type AiPart } from "@/lib/ai/providers";
import { storeInput } from "@/lib/ai/storage";

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  "application/pdf": "PDF",
  "image/png": "画像",
  "image/jpeg": "画像",
  "message/rfc822": "メール",
};

export type InputFile = { name: string; mimeType: string; bytes: Buffer };

function detectType(f: InputFile) {
  const lower = f.name.toLowerCase();
  if (lower.endsWith(".eml")) return "message/rfc822";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return f.mimeType;
}

/** AIに渡すテンプレート（製品区分が未選択なら全区分） */
async function templatesFor(productCategoryId: string | null) {
  const [categories, specTemplates, docTemplates] = await Promise.all([
    prisma.productCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.specFieldTemplate.findMany({
      where: { active: true, ...(productCategoryId ? { OR: [{ productCategoryId: null }, { productCategoryId }] } : {}) },
      include: { productCategory: true },
      orderBy: [{ productCategoryId: { sort: "asc", nulls: "first" } }, { sortOrder: "asc" }],
    }),
    prisma.documentTemplate.findMany({
      where: { active: true, ...(productCategoryId ? { productCategoryId } : {}) },
      include: { productCategory: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);
  const templates: TemplateForAi[] = specTemplates.map((t) => ({
    id: t.id,
    label: t.label,
    inputType: t.inputType,
    required: t.required,
    options: t.options,
    description: t.description,
    categoryName: t.productCategory?.name ?? null,
  }));
  return { categories, templates, docTemplates };
}

/** .eml を本文テキストと添付ファイルに分ける */
async function expandEml(f: InputFile): Promise<AiPart[]> {
  const mail = await simpleParser(f.bytes);
  const parts: AiPart[] = [
    {
      kind: "text",
      text: [
        `（メール：${f.name}）`,
        `件名：${mail.subject ?? ""}`,
        `差出人：${mail.from?.text ?? ""}`,
        `日付：${mail.date?.toISOString() ?? ""}`,
        "本文：",
        (mail.text ?? "").slice(0, 30000),
      ].join("\n"),
    },
  ];
  for (const a of mail.attachments ?? []) {
    const type = a.contentType === "image/jpg" ? "image/jpeg" : a.contentType;
    if (["application/pdf", "image/png", "image/jpeg"].includes(type) && a.size <= MAX_FILE_BYTES)
      parts.push({ kind: "file", mimeType: type, data: a.content, name: `${f.name} の添付：${a.filename ?? "無題"}` });
  }
  return parts;
}

/** AI下書きを実行し、実行記録の ID を返す */
export async function runAiDraft(actor: Actor, orderId: string, input: { files: InputFile[]; text: string }) {
  await requireOrderAccess(actor, orderId, (a) => a.edit, "このオーダーは編集できません。");
  if (!can.useAi(actor)) throw new ForbiddenError("AI下書きを使う権限がありません。");
  if (!(await getSystemSetting()).aiEnabled) throw new UserError("AI機能は管理者によって無効にされています。");
  const text = input.text.trim();
  if (!input.files.length && !text) throw new UserError("ファイルを選ぶか、メール本文などのテキストを貼り付けてください。");
  if (input.files.length > MAX_FILES) throw new UserError(`ファイルは${MAX_FILES}個までです。`);
  let total = 0;
  for (const f of input.files) {
    const type = detectType(f);
    if (!ALLOWED[type]) throw new UserError(`「${f.name}」は読み取れない形式です。PDF・画像（PNG/JPEG）・メール（.eml）を選んでください。`);
    if (f.bytes.length > MAX_FILE_BYTES) throw new UserError(`「${f.name}」が大きすぎます（1ファイル10MBまで）。`);
    total += f.bytes.length;
  }
  if (total > MAX_TOTAL_BYTES) throw new UserError("ファイルの合計が大きすぎます（合計20MBまで）。");

  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { productCategory: true } });
  const { categories, templates, docTemplates } = await templatesFor(order.productCategoryId);
  const runKey = randomUUID();
  const started = Date.now();

  const inputFiles: { name: string; mimeType: string; size: number; location: string }[] = [];
  const parts: AiPart[] = [];
  for (const f of input.files) {
    const mimeType = detectType(f);
    const location = await storeInput(orderId, runKey, { ...f, mimeType });
    inputFiles.push({ name: f.name, mimeType, size: f.bytes.length, location });
    if (mimeType === "message/rfc822") parts.push(...(await expandEml(f)));
    else parts.push({ kind: "file", mimeType, data: f.bytes, name: f.name });
  }

  const prompt = buildPrompt({
    categories: categories.map((c) => ({ code: c.code, name: c.name })),
    currentCategoryName: order.productCategory?.name ?? null,
    templates,
    documents: docTemplates.map((d) => ({ name: d.name, requirement: d.requirement, categoryName: d.productCategory.name })),
    pastedText: text,
    fileNames: input.files.map((f) => f.name),
  });
  const codes = categories.map((c) => c.code);
  try {
    const r = await callAi(SYSTEM_INSTRUCTION, prompt, parts, responseSchema(codes), {
      templates,
      categories: categories.map((c) => ({ code: c.code, name: c.name })),
    });
    const output = normalizeOutput(r.json, templates, codes);
    const run = await prisma.aiRun.create({
      data: {
        orderId,
        createdById: actor.id,
        inputFiles,
        inputTextChars: text.length,
        model: r.model,
        location: r.location,
        promptTokens: r.promptTokens,
        outputTokens: r.outputTokens,
        outputJson: output as unknown as Prisma.InputJsonValue,
        status: "SUCCEEDED",
        durationMs: Date.now() - started,
      },
    });
    console.info(JSON.stringify({ severity: "INFO", message: "AI下書きを実行しました", orderId, runId: run.id, model: r.model, promptTokens: r.promptTokens, outputTokens: r.outputTokens, durationMs: Date.now() - started }));
    return run.id;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.aiRun.create({
      data: {
        orderId,
        createdById: actor.id,
        inputFiles,
        inputTextChars: text.length,
        model: process.env.AI_PROVIDER === "mock" ? "mock" : process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
        location: process.env.VERTEX_LOCATION ?? "asia-northeast1",
        status: "FAILED",
        error: message.slice(0, 1000),
        durationMs: Date.now() - started,
      },
    });
    // 資料の本文はログに出さない（SPEC §8）
    console.error(JSON.stringify({ severity: "ERROR", message: "AI下書きに失敗しました", orderId, error: message.slice(0, 500) }));
    throw new UserError("AIによる読み取りに失敗しました。時間をおいて再度お試しいただくか、手入力で進めてください。");
  }
}

// ───────────── 採用 ─────────────

export type Decision = "adopt" | "modify" | "reject";

export type AdoptInput = {
  runId: string;
  /** 製品区分（未選択のオーダーで、AIの推定を営業が確定したもの） */
  productCategoryId: string | null;
  basic: Partial<Record<BasicKey, { decision: Decision; value: string }>>;
  fields: Record<string, { decision: Decision; value: string }>;
  /** 未確定項目として登録する必須項目（テンプレートID） */
  missing: string[];
  missingUnresolved: UnresolvedInput | null;
};

/** 採用した候補だけを要求仕様書に反映する */
export async function adoptAiDraft(actor: Actor, orderId: string, input: AdoptInput) {
  await requireOrderAccess(actor, orderId, (a) => a.edit, "このオーダーは編集できません。");
  const run = await prisma.aiRun.findUnique({ where: { id: input.runId } });
  if (!run || run.orderId !== orderId || run.status !== "SUCCEEDED") throw new UserError("AI下書きの結果が見つかりません。");
  if (run.adoptedAt) throw new UserError("このAI下書きはすでに反映済みです。");
  const output = run.outputJson as unknown as AiDraftOutput;
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { customer: true } });

  // 基本情報：現在の値に、採用・修正した値を重ねる
  const final = (k: BasicKey) => {
    const d = input.basic[k];
    if (!d || d.decision === "reject") return undefined;
    return d.value.trim();
  };
  const errors: Record<string, string> = {};
  const deliveryStr = final("contractDeliveryDate");
  const delivery = deliveryStr ? parseDateOnly(deliveryStr) : undefined;
  if (deliveryStr && !delivery) errors["basic_contractDeliveryDate"] = "日付は YYYY-MM-DD 形式で入力してください。";
  const qty = final("quantity");
  if (qty && Number.isNaN(Number(qty))) errors["basic_quantity"] = "数量は数値で入力してください。";
  for (const [id, d] of Object.entries(input.fields)) if (d.decision !== "reject" && !d.value.trim()) errors[`field_${id}`] = "値を入力するか、却下を選んでください。";
  if (Object.keys(errors).length) throw new UserError("入力内容を確認してください。", errors);

  const basic: BasicInput = {
    productCategoryId: input.productCategoryId ?? order.productCategoryId,
    customerId: order.customerId,
    newCustomerName: final("customerName") || order.customer?.name || null,
    siteName: final("siteName") ?? order.siteName,
    endUser: final("endUser") ?? order.endUser,
    title: final("title") ?? order.title,
    quantity: qty ?? order.quantity?.toString() ?? null,
    quantityUnit: final("quantityUnit") ?? order.quantityUnit,
    salesUserId: order.salesUserId,
    salesDepartmentId: order.salesDepartmentId,
    contractDeliveryDate: delivery ?? order.contractDeliveryDate,
    deliveryType: order.deliveryType,
    deliveryFixDueDate: order.deliveryFixDueDate,
    shortLeadConsulted: order.shortLeadConsulted,
    shortLeadNote: order.shortLeadNote,
    orderDocType: order.orderDocType,
    quoteNumber: final("quoteNumber") ?? order.quoteNumber,
    inquiryNumber: final("inquiryNumber") ?? order.inquiryNumber,
  };
  await updateBasic(actor, orderId, basic);

  const entries: SpecEntry[] = [];
  for (const [templateId, d] of Object.entries(input.fields)) {
    if (d.decision === "reject") continue;
    entries.push({ templateId, state: "FILLED", value: d.value.trim(), naReason: null, aiDerived: d.decision === "adopt" });
  }
  if (input.missing.length) {
    if (!input.missingUnresolved) throw new UserError("未確定項目として登録する場合は、担当者と回答期限を入力してください。", { missing: "担当者と回答期限を入力してください。" });
    for (const templateId of input.missing) {
      if (entries.some((e) => e.templateId === templateId)) continue;
      entries.push({ templateId, state: "UNRESOLVED", value: null, naReason: null, unresolved: input.missingUnresolved });
    }
  }
  if (entries.length) await saveSpecValues(actor, orderId, entries);

  const adoption = {
    productCategory: input.productCategoryId ? { suggested: output.productCategoryCode, chosenId: input.productCategoryId } : null,
    basic: Object.fromEntries(
      BASIC_FIELDS.filter((b) => output.basic[b.key]?.value).map((b) => [
        b.key,
        { candidate: output.basic[b.key].value, decision: input.basic[b.key]?.decision ?? "reject", final: input.basic[b.key]?.decision === "reject" ? null : input.basic[b.key]?.value ?? null },
      ]),
    ),
    fields: Object.fromEntries(
      output.fields.map((f) => [
        f.fieldId,
        { candidate: f.value, decision: input.fields[f.fieldId]?.decision ?? "reject", final: input.fields[f.fieldId]?.decision === "reject" ? null : input.fields[f.fieldId]?.value ?? null },
      ]),
    ),
    missingRegistered: input.missing,
  };
  await prisma.aiRun.update({ where: { id: run.id }, data: { adoption, adoptedAt: new Date() } });
  const counts = { adopt: 0, modify: 0, reject: 0 };
  for (const v of [...Object.values(adoption.basic), ...Object.values(adoption.fields)]) counts[v.decision as Decision]++;
  await writeAudit({ actorId: actor.id, action: "AI_ADOPT", targetType: "Order", targetId: orderId, targetLabel: order.orderNumber, after: { runId: run.id, ...counts, missingRegistered: input.missing.length } });
  return counts;
}

/** 採用画面に出す候補の一覧 */
export async function draftCandidates(orderId: string, runId: string) {
  const [run, order] = await Promise.all([
    prisma.aiRun.findUnique({ where: { id: runId } }),
    prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { customer: true, specValues: true, productCategory: true } }),
  ]);
  if (!run || run.status !== "SUCCEEDED") return null;
  const output = run.outputJson as unknown as AiDraftOutput;
  const { categories, templates } = await templatesFor(order.productCategoryId);
  const current: Record<BasicKey, string> = {
    customerName: order.customer?.name ?? "",
    siteName: order.siteName ?? "",
    endUser: order.endUser ?? "",
    title: order.title ?? "",
    quantity: order.quantity?.toString() ?? "",
    quantityUnit: order.quantityUnit ?? "",
    contractDeliveryDate: dateOnlyStr(order.contractDeliveryDate),
    quoteNumber: order.quoteNumber ?? "",
    inquiryNumber: order.inquiryNumber ?? "",
  };
  const valueBy = new Map(order.specValues.map((v) => [v.templateId, v]));
  const suggestedCategory = categories.find((c) => c.code === output.productCategoryCode) ?? null;
  // 製品区分が決まっていればその区分の項目、未選択ならAIが推定した区分の項目を対象にする
  const targetCategoryName = order.productCategory?.name ?? suggestedCategory?.name ?? null;
  const relevant = templates.filter((t) => t.categoryName === null || t.categoryName === targetCategoryName);
  const fieldBy = new Map(output.fields.map((f) => [f.fieldId, f]));
  return {
    run: { id: run.id, model: run.model, createdAt: run.createdAt, promptTokens: run.promptTokens, outputTokens: run.outputTokens, notes: output.notes, adoptedAt: run.adoptedAt, inputFiles: run.inputFiles as { name: string }[] },
    category: order.productCategoryId
      ? null
      : {
          suggestedId: suggestedCategory?.id ?? "",
          evidence: output.productCategoryEvidence ?? "",
          options: categories.map((c) => ({ id: c.id, name: c.name })),
        },
    basic: BASIC_FIELDS.filter((b) => output.basic[b.key]?.value).map((b) => ({
      key: b.key,
      label: b.label,
      candidate: output.basic[b.key].value,
      evidence: output.basic[b.key].evidence,
      current: current[b.key],
    })),
    fields: relevant
      .filter((t) => fieldBy.has(t.id))
      .map((t) => ({
        templateId: t.id,
        label: t.label,
        inputType: t.inputType,
        options: t.options,
        candidate: fieldBy.get(t.id)!.value,
        evidence: fieldBy.get(t.id)!.evidence,
        current: valueBy.get(t.id)?.value ?? "",
      })),
    // 読み取れなかった必須項目（まだ値も状態も無いもの）
    missing: relevant
      .filter((t) => t.required && !fieldBy.has(t.id) && !valueBy.get(t.id)?.state)
      .map((t) => ({ templateId: t.id, label: t.label })),
    documents: output.documents,
  };
}
export type DraftCandidates = NonNullable<Awaited<ReturnType<typeof draftCandidates>>>;
