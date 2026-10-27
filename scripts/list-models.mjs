// Vertex AI で、このプロジェクトから使える Gemini のモデル名を一覧にする（モデル名は推測しない。スキル gcp-bootstrap）
// GitHub Actions の models（infra/run_job.sh）から Cloud Run ジョブで実行する。
//   GOOGLE_CLOUD_PROJECT：プロジェクトID
//   MODEL_LOCATIONS：調べるリージョン（カンマ区切り。既定は asia-northeast1,global）
//   GEMINI_MODEL：試しに呼び出して、使えるかを確かめるモデル（任意）
import { GoogleGenAI } from "@google/genai";

const project = process.env.GOOGLE_CLOUD_PROJECT;
if (!project) {
  console.error("GOOGLE_CLOUD_PROJECT が設定されていません。");
  process.exit(1);
}
const locations = (process.env.MODEL_LOCATIONS ?? "asia-northeast1,global").split(",").map((s) => s.trim()).filter(Boolean);
const probe = process.env.GEMINI_MODEL;

for (const location of locations) {
  const ai = new GoogleGenAI({ vertexai: true, project, location });
  const names = [];
  try {
    const pager = await ai.models.list({ config: { queryBase: true, pageSize: 100 } });
    for await (const m of pager) {
      const name = (m.name ?? "").split("/").pop();
      if (/gemini/i.test(name)) names.push(name);
    }
    console.log(`== ${location}：Gemini のモデル ${names.length}件`);
    console.log([...new Set(names)].sort().join("\n"));
  } catch (e) {
    console.log(`== ${location}：一覧を取れませんでした（${e?.message?.slice(0, 200)}）`);
  }
  if (probe) {
    try {
      const r = await ai.models.generateContent({ model: probe, contents: "「OK」とだけ返してください。" });
      console.log(`-- ${location}：${probe} の呼び出し → 成功（${(r.text ?? "").trim().slice(0, 20)}）`);
    } catch (e) {
      console.log(`-- ${location}：${probe} の呼び出し → 失敗（${e?.message?.slice(0, 200)}）`);
    }
  }
}
