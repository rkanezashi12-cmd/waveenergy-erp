// AIの呼び出し先：Vertex AI（Gemini）と、GCPなしで動かすためのモック
import { GoogleGenAI, type Part } from "@google/genai";
import { env } from "@/lib/env";
import { BASIC_FIELDS, type TemplateForAi } from "@/lib/ai/prompt";

export type AiPart = { kind: "text"; text: string } | { kind: "file"; mimeType: string; data: Buffer; name: string };

export type AiCallResult = { json: unknown; promptTokens: number | null; outputTokens: number | null; model: string; location: string };

let client: GoogleGenAI | null = null;

async function callVertex(system: string, prompt: string, parts: AiPart[], schema: unknown): Promise<AiCallResult> {
  if (!env.gcpProject) throw new Error("GOOGLE_CLOUD_PROJECT が設定されていません。");
  client ??= new GoogleGenAI({ vertexai: true, project: env.gcpProject, location: env.vertexLocation });
  const contents: Part[] = [{ text: prompt }];
  for (const p of parts) {
    if (p.kind === "text") contents.push({ text: p.text });
    else {
      contents.push({ text: `（添付ファイル：${p.name}）` });
      contents.push({ inlineData: { mimeType: p.mimeType, data: p.data.toString("base64") } });
    }
  }
  const thinkingBudget = process.env.GEMINI_THINKING_BUDGET;
  const res = await client.models.generateContent({
    model: env.geminiModel,
    contents: [{ role: "user", parts: contents }],
    config: {
      systemInstruction: system,
      temperature: 0.1,
      responseMimeType: "application/json",
      responseJsonSchema: schema,
      ...(thinkingBudget ? { thinkingConfig: { thinkingBudget: Number(thinkingBudget) } } : {}),
    },
  });
  const text = res.text ?? "";
  const usage = res.usageMetadata;
  return {
    json: JSON.parse(text),
    promptTokens: usage?.promptTokenCount ?? null,
    outputTokens: usage ? (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) : null,
    model: res.modelVersion || env.geminiModel,
    location: env.vertexLocation,
  };
}

/** モック：テキストから「件名：」「顧客：」などを読み取るだけの簡易版（開発・デモ用） */
function callMock(prompt: string, parts: AiPart[], templates: TemplateForAi[], categories: { code: string; name: string }[]): AiCallResult {
  const text = [prompt.split("## 入力資料")[1] ?? "", ...parts.filter((p) => p.kind === "text").map((p) => (p as { text: string }).text)].join("\n");
  const pick = (re: RegExp) => re.exec(text)?.[1]?.trim() ?? "";
  const basicVal: Record<string, string> = {
    customerName: pick(/(?:顧客|お客様|発注者)[名]?[：:]\s*(.+)/),
    siteName: pick(/(?:現場|現場名|設置場所)[：:]\s*(.+)/),
    endUser: pick(/エンドユーザー[：:]\s*(.+)/),
    title: pick(/(?:件名|工事名|品名)[：:]\s*(.+)/),
    quantity: pick(/数量[：:]\s*([\d.]+)/),
    quantityUnit: pick(/数量[：:]\s*[\d.]+\s*([面台式])/),
    contractDeliveryDate: pick(/納期[：:]\s*(\d{4}[-/年]\d{1,2}[-/月]\d{1,2})/),
    quoteNumber: pick(/見積番号[：:]\s*(\S+)/),
    inquiryNumber: pick(/引合番号[：:]\s*(\S+)/),
  };
  const basic = Object.fromEntries(
    BASIC_FIELDS.map((b) => [b.key, { value: basicVal[b.key] ?? "", evidence: basicVal[b.key] ? "貼り付けテキスト（モックによる読み取り）" : "" }]),
  );
  const fields = templates
    .map((t) => {
      const v = pick(new RegExp(`${t.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[：:]\\s*(.+)`));
      return v ? { fieldId: t.id, value: v, evidence: "貼り付けテキスト（モックによる読み取り）" } : null;
    })
    .filter(Boolean);
  const cat = categories.find((c) => text.includes(c.name) || (c.code === "SOLAR" && /太陽光|SPEC-M/.test(text)));
  return {
    json: {
      productCategoryCode: cat?.code ?? "",
      productCategoryEvidence: cat ? "貼り付けテキストに製品区分の記載あり（モック）" : "",
      basic,
      fields,
      documents: [],
      notes: "モックによる読み取りです（AI_PROVIDER=mock）。Vertex AI は使っていません。",
    },
    promptTokens: Math.ceil(prompt.length / 2),
    outputTokens: 200,
    model: "mock",
    location: "local",
  };
}

export async function callAi(
  system: string,
  prompt: string,
  parts: AiPart[],
  schema: unknown,
  ctx: { templates: TemplateForAi[]; categories: { code: string; name: string }[] },
): Promise<AiCallResult> {
  if (env.aiProvider === "mock") return callMock(prompt, parts, ctx.templates, ctx.categories);
  return callVertex(system, prompt, parts, schema);
}
