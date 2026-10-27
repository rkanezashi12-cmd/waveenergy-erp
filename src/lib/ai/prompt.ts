// AI下書きのプロンプトと出力形式（SPEC §4.4）

export type TemplateForAi = {
  id: string;
  label: string;
  inputType: string;
  required: boolean;
  options: string[];
  description: string | null;
  categoryName: string | null;
};
export type DocTemplateForAi = { name: string; requirement: string; categoryName: string };
export type CategoryForAi = { code: string; name: string };

/** 基本情報のうちAIに読み取らせる項目 */
export const BASIC_FIELDS = [
  { key: "customerName", label: "顧客名", hint: "発注者（会社名・団体名）" },
  { key: "siteName", label: "現場名", hint: "設置場所・工事場所・発電所名など" },
  { key: "endUser", label: "エンドユーザー", hint: "最終的な使用者（顧客と異なる場合）" },
  { key: "title", label: "件名", hint: "工事名・品名" },
  { key: "quantity", label: "数量", hint: "数値のみ（例：3）" },
  { key: "quantityUnit", label: "数量の単位", hint: "面・台・式など" },
  { key: "contractDeliveryDate", label: "契約納期", hint: "YYYY-MM-DD 形式" },
  { key: "quoteNumber", label: "見積番号", hint: "" },
  { key: "inquiryNumber", label: "引合番号", hint: "" },
] as const;
export type BasicKey = (typeof BASIC_FIELDS)[number]["key"];

export const SYSTEM_INSTRUCTION = `あなたは受配電盤・太陽光発電用電気設備メーカーの営業アシスタントです。
見積書・顧客仕様書・メールなどの入力資料から、オーダー発令に使う「要求仕様書」の下書きを作ります。
次のルールを必ず守ってください。
- 入力資料に書かれている内容だけを使い、推測で値を作らない。読み取れない項目は value を空文字にする。
- evidence には、その値がどの資料のどこに書かれていたか（ファイル名・ページ・該当箇所の短い引用）を書く。value が空なら evidence も空文字にする。
- 選択肢がある項目は、選択肢の文字列と完全に一致する値だけを返す。複数選択は該当する選択肢を「、」で区切って返す。
- 日付は YYYY-MM-DD 形式で返す。
- 個人の電話番号やメールアドレスは、顧客側の窓口の項目以外には書かない。
- 出力は指定された JSON 形式のみ。`;

export function buildPrompt(input: {
  categories: CategoryForAi[];
  currentCategoryName: string | null;
  templates: TemplateForAi[];
  documents: DocTemplateForAi[];
  pastedText: string;
  fileNames: string[];
}) {
  const lines: string[] = [];
  if (input.currentCategoryName) {
    lines.push(`製品区分：${input.currentCategoryName}（確定済み）`);
  } else {
    lines.push("製品区分は未選択です。次の中から最も当てはまるものを productCategoryCode に返してください（判断できなければ空文字）。");
    for (const c of input.categories) lines.push(`- ${c.code}：${c.name}`);
  }
  lines.push("", "## 基本情報（basic）");
  for (const b of BASIC_FIELDS) lines.push(`- ${b.key}：${b.label}${b.hint ? `（${b.hint}）` : ""}`);
  lines.push("", "## 要求仕様書の項目（fields。fieldId を使って返す）");
  for (const t of input.templates) {
    const parts = [`fieldId=${t.id}`, `項目名=${t.label}`, t.categoryName ? `製品区分=${t.categoryName}` : "共通項目", t.required ? "必須" : "任意"];
    if (t.options.length) parts.push(`選択肢=${t.options.join("／")}${t.inputType === "MULTISELECT" ? "（複数選択可）" : ""}`);
    if (t.description) parts.push(`説明=${t.description}`);
    lines.push(`- ${parts.join("｜")}`);
  }
  lines.push("", "## 必要資料（documents。入力資料に含まれている・言及されているかを返す）");
  for (const d of input.documents) lines.push(`- ${d.name}（${d.categoryName}・${d.requirement}）`);
  lines.push("", "## 入力資料");
  if (input.fileNames.length) lines.push(`添付ファイル：${input.fileNames.join("、")}`);
  if (input.pastedText.trim()) lines.push("貼り付けテキスト：", "-----", input.pastedText.trim(), "-----");
  return lines.join("\n");
}

/** 出力の JSON Schema */
export function responseSchema(categoryCodes: string[]) {
  const vf = {
    type: "object",
    properties: { value: { type: "string" }, evidence: { type: "string" } },
    required: ["value", "evidence"],
  };
  return {
    type: "object",
    properties: {
      productCategoryCode: { type: "string", enum: [...categoryCodes, ""] },
      productCategoryEvidence: { type: "string" },
      basic: {
        type: "object",
        properties: Object.fromEntries(BASIC_FIELDS.map((b) => [b.key, vf])),
        required: BASIC_FIELDS.map((b) => b.key),
      },
      fields: {
        type: "array",
        items: {
          type: "object",
          properties: { fieldId: { type: "string" }, value: { type: "string" }, evidence: { type: "string" } },
          required: ["fieldId", "value", "evidence"],
        },
      },
      documents: {
        type: "array",
        items: {
          type: "object",
          properties: { name: { type: "string" }, found: { type: "boolean" }, evidence: { type: "string" } },
          required: ["name", "found", "evidence"],
        },
      },
      notes: { type: "string" },
    },
    required: ["productCategoryCode", "basic", "fields", "documents", "notes"],
  };
}

export type AiDraftOutput = {
  productCategoryCode: string;
  productCategoryEvidence?: string;
  basic: Record<BasicKey, { value: string; evidence: string }>;
  fields: { fieldId: string; value: string; evidence: string }[];
  documents: { name: string; found: boolean; evidence: string }[];
  notes: string;
};

/** 出力を検証・正規化する（不正な値は空にする） */
export function normalizeOutput(raw: unknown, templates: TemplateForAi[], categoryCodes: string[]): AiDraftOutput {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const basicRaw = (o.basic && typeof o.basic === "object" ? o.basic : {}) as Record<string, { value?: unknown; evidence?: unknown }>;
  const basic = Object.fromEntries(
    BASIC_FIELDS.map((b) => {
      let value = s(basicRaw[b.key]?.value);
      if (b.key === "contractDeliveryDate") {
        const m = /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/.exec(value);
        value = m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
      }
      if (b.key === "quantity") {
        const m = /[\d.]+/.exec(value.replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
        value = m ? m[0] : "";
      }
      return [b.key, { value, evidence: value ? s(basicRaw[b.key]?.evidence) : "" }];
    }),
  ) as AiDraftOutput["basic"];
  const byId = new Map(templates.map((t) => [t.id, t]));
  const fields: AiDraftOutput["fields"] = [];
  for (const f of Array.isArray(o.fields) ? o.fields : []) {
    const fieldId = s((f as Record<string, unknown>)?.fieldId);
    const t = byId.get(fieldId);
    let value = s((f as Record<string, unknown>)?.value);
    if (!t || !value || fields.some((x) => x.fieldId === fieldId)) continue;
    if (t.inputType === "SELECT" && t.options.length && !t.options.includes(value)) continue;
    if (t.inputType === "MULTISELECT") {
      const picked = value.split(/[、,，\n]/).map((x) => x.trim()).filter((x) => t.options.includes(x));
      if (!picked.length) continue;
      value = JSON.stringify(picked);
    }
    fields.push({ fieldId, value, evidence: s((f as Record<string, unknown>)?.evidence) });
  }
  const code = s(o.productCategoryCode);
  return {
    productCategoryCode: categoryCodes.includes(code) ? code : "",
    productCategoryEvidence: s(o.productCategoryEvidence),
    basic,
    fields,
    documents: (Array.isArray(o.documents) ? o.documents : [])
      .map((d) => ({ name: s((d as Record<string, unknown>)?.name), found: Boolean((d as Record<string, unknown>)?.found), evidence: s((d as Record<string, unknown>)?.evidence) }))
      .filter((d) => d.name),
    notes: s(o.notes),
  };
}
