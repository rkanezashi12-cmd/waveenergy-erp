// 予算を使い切ったら、プロジェクトの請求先のリンクを外して止める（デモ環境の費用の安全策）。
// 予算アラート → Pub/Sub（budget-alerts）→ push → この Cloud Run サービス（<APP>-budget-stop）の /pubsub/budget。
// 請求先を外すとプロジェクトの有料サービス（Cloud Run・Cloud SQL など）はすべて止まる。
// 戻すときはコンソールの「お支払い」で請求先をつなぎ直す。本番では AUTO_STOP_ENABLED=false にする（メールだけ）。
//
// - 認証は Cloud Run（非公開のサービス）と Pub/Sub の OIDC トークンに任せる
// - AUTO_STOP_ENABLED=false なら、判定してログを出すだけ
import http from "node:http";

const BILLING_API = "https://cloudbilling.googleapis.com/v1";
const METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

function log(severity, message, extra = {}) {
  console.log(JSON.stringify({ severity, message, ...extra }));
}

export function parseNotification(envelope) {
  const data = envelope?.message?.data;
  if (!data) throw new Error("message.data がない");
  return JSON.parse(Buffer.from(data, "base64").toString("utf8"));
}

export function shouldStop(n) {
  const cost = Number(n.costAmount ?? 0);
  const budget = Number(n.budgetAmount ?? 0);
  return budget > 0 && cost >= budget;
}

async function token() {
  const r = await fetch(METADATA_TOKEN_URL, { headers: { "Metadata-Flavor": "Google" } });
  if (!r.ok) throw new Error(`トークンを取れない（HTTP ${r.status}）`);
  return (await r.json()).access_token;
}

/** 請求先のリンクを外す。すでに外れていれば何もしない */
async function disableBilling(projectId) {
  const headers = { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" };
  const url = `${BILLING_API}/projects/${projectId}/billingInfo`;
  const info = await fetch(url, { headers });
  if (!info.ok) throw new Error(`請求先の情報を取れない（HTTP ${info.status}）`);
  if (!(await info.json()).billingEnabled) return "already-disabled";
  const r = await fetch(url, { method: "PUT", headers, body: JSON.stringify({ billingAccountName: "" }) });
  if (!r.ok) throw new Error(`請求先を外せない（HTTP ${r.status}）`);
  return "disabled";
}

async function handleBudget(body) {
  let n;
  try {
    n = parseNotification(JSON.parse(body));
  } catch (e) {
    // 形が合わない通知は再送しても直らないので、受け取ったことにする
    log("WARNING", "予算の通知を読めない", { error: e.name });
    return [200, { action: "ignored" }];
  }
  log("INFO", "予算の通知", { cost: n.costAmount, budget: n.budgetAmount, currency: n.currencyCode ?? "" });
  if (!shouldStop(n)) return [200, { action: "none" }];
  const projectId = process.env.GCP_PROJECT_ID ?? "";
  if ((process.env.AUTO_STOP_ENABLED ?? "true").toLowerCase() !== "true") {
    log("WARNING", "予算を超えたが AUTO_STOP_ENABLED=false なので止めない", { projectId });
    return [200, { action: "would-stop" }];
  }
  if (!projectId) return [500, { error: "GCP_PROJECT_ID が未設定" }];
  try {
    const result = await disableBilling(projectId);
    log("WARNING", "予算を超えたため請求先を外した", { projectId, result });
    return [200, { action: result }];
  } catch (e) {
    // 失敗は 500 で返し、Pub/Sub に再送させる
    log("ERROR", "請求先を外せない", { projectId, error: e.message });
    return [500, { error: "請求先を外せない" }];
  }
}

const server = http.createServer((req, res) => {
  const send = (status, json) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(json));
  };
  if (req.method === "GET" && req.url === "/healthz") return send(200, { ok: true });
  if (req.method !== "POST" || req.url !== "/pubsub/budget") return send(404, { error: "not found" });
  let body = "";
  req.on("data", (c) => {
    body += c;
    if (body.length > 1_000_000) req.destroy();
  });
  req.on("end", () => {
    handleBudget(body).then(([s, j]) => send(s, j), () => send(500, { error: "error" }));
  });
});

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8080);
  server.listen(port, () => log("INFO", "予算超過の停止サービスを起動しました", { port }));
}
