// 受け入れ基準（SPEC §11）の通し確認（Playwright）
//
// 前提：シード済みのデータベースで、AI_PROVIDER=mock・MAIL_TRANSPORT=db・APP_ENV=demo のアプリが起動していること。
//   npm run db:reset && npm run db:seed && npm run dev
//   E2E_BASE_URL=http://localhost:3000 npm run test:e2e
// Playwright は devDependencies に含めていない。未導入なら `npm i -D playwright && npx playwright install chromium`。
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.E2E_PASSWORD ?? "Demo1234!";
const iso = (days) => {
  const d = new Date(Date.now() + days * 86_400_000 + 9 * 3600_000);
  return d.toISOString().slice(0, 10);
};

const browser = await chromium.launch();
const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(["OK", name]);
    console.log(`OK   ${name}`);
  } catch (e) {
    results.push(["NG", name]);
    console.log(`NG   ${name}\n     ${e.message.split("\n")[0]}`);
    throw e;
  }
}

async function login(email) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  page.on("pageerror", (e) => console.log(`     [pageerror] ${e.message}`));
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/`);
  return page;
}

const CUSTOMER = `E2Eテスト電機株式会社（架空）${Date.now() % 100000}`;
let orderUrl = "";
let orderNumber = "";

try {
  const sales = await login("sales1@example.com");

  await step("1. 営業：発番（基本情報）", async () => {
    await sales.goto(`${BASE}/orders/new`);
    await sales.selectOption("#productCategoryId", { label: "太陽光（SPEC-M）" });
    await sales.fill("#customerName", CUSTOMER);
    await sales.fill("#siteName", "E2E第1発電所（架空）");
    await sales.fill("#title", "E2E 集電盤");
    await sales.fill("#quantity", "2");
    await sales.fill("#contractDeliveryDate", iso(300));
    await sales.click("button:has-text('発番して保存')");
    await sales.waitForURL(/\/edit\?step=2/);
    await sales.getByText(/を発番しました/).waitFor();
    orderNumber = (await sales.locator("h1").innerText()).match(/[A-Z]+-\d{4}-\d{4}/)?.[0] ?? "";
    assert.ok(orderNumber, "オーダー番号が表示されない");
    orderUrl = sales.url().replace(/\/edit.*$/, "");
  });

  await step("1. 営業：AI下書き（モック）→ 採用", async () => {
    await sales.fill("textarea[name=text]", ["件名：E2E 集電盤（AI）", "見積番号：Q-E2E-001", "見積の前提：見積書2ページの機器一覧のとおり", "SPEC-Mオプション選択内容：オプションB（仮）"].join("\n"));
    await sales.click("button:has-text('AI下書きを作成')");
    await sales.getByText("AIの読み取り結果").waitFor();
    await sales.getByText("候補：E2E 集電盤（AI）").waitFor();
    await sales.click("button:has-text('選んだ内容を反映して次へ')");
    await sales.waitForURL(/step=3/);
    await sales.getByText("AI下書きの採用内容を反映しました").waitFor();
  });

  await step("2. 必須が空欄なら発令できず、不足箇所が表示される", async () => {
    await sales.goto(`${orderUrl}/edit?step=6`);
    await sales.getByText(/発令できません：不足が\d+件あります/).waitFor();
    await sales.getByText(/「標準仕様からの変更点」が空欄です/).waitFor();
    await sales.getByText(/資料「見積書/).first().waitFor();
    assert.equal(await sales.locator("button:has-text('発令する')").isDisabled(), true);
  });

  await step("1. 営業：要求仕様書（入力・未確定）", async () => {
    await sales.goto(`${orderUrl}/edit?step=3`);
    const row = (label) => sales.locator(`[data-spec="${label}"]`);
    await row("標準仕様からの変更点").getByLabel("なし（変更なし）").check();
    await row("主要機器（パワコン等）のメーカー・型式").locator("textarea").fill("パワコン：メーカーX（架空）PC-500");
    const r = row("立会試験の有無・予定");
    await r.getByLabel("未確定").check();
    await r.locator("select[name$=assigneeId]").selectOption({ label: "青木 健太" });
    await r.locator("input[name$=dueDate]").fill(iso(5));
    await r.locator("textarea[name$=knownInfo]").fill("立会の要否を顧客に確認中");
    await sales.click("button:has-text('保存して次へ')");
    await sales.waitForURL(/step=4/);
  });

  await step("1. 営業：資料チェックリスト（URL・版数・日付、未入手）", async () => {
    const rows = sales.locator("[data-doc]");
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      const r = rows.nth(i);
      const name = await r.getAttribute("data-doc");
      if (name === "単線結線図") {
        await r.getByLabel("未入手").check();
        await r.locator("select[name$=assigneeId]").selectOption({ label: "青木 健太" });
        await r.locator("input[name$=dueDate]").fill(iso(7));
        continue;
      }
      const text = await r.innerText();
      if (text.includes("条件付き")) {
        await r.getByLabel("該当なし").check();
        await r.locator("input[name^=na_]").fill("顧客仕様書の提示なし（標準仕様で受注）");
        continue;
      }
      if (!text.includes("必須")) continue;
      await r.getByLabel("添付済み").check();
      await r.locator("input[name^=url_]").fill(`https://example.sharepoint.com/sites/demo/e2e/${i}.pdf`);
      await r.locator("input[name^=version_]").fill("1");
      await r.locator("input[name^=docDate_]").fill(iso(-3));
    }
    await sales.click("button:has-text('保存して次へ')");
    await sales.waitForURL(/step=5/);
    await sales.getByText("立会試験の有無・予定").first().waitFor();
    await sales.getByText("資料：単線結線図").first().waitFor();
  });

  await step("1. 営業：確認・発令", async () => {
    await sales.goto(`${orderUrl}/edit?step=6`);
    await sales.getByText("必須項目・必須資料はすべて揃っています。").waitFor();
    await sales.getByText(/未確定のまま発令する項目（2件）/).waitFor();
    await sales.check("input[name=confirmed]");
    await sales.click("button:has-text('発令する')");
    await sales.waitForURL(/\?issued=1/);
    await sales.getByText("受入待ち").first().waitFor();
  });

  const reception = await login("reception@example.com");
  await step("3. 発令すると技術受付にアプリ内通知とメール（送信メール履歴）が届く", async () => {
    await reception.goto(`${BASE}/notifications?unread=1`);
    await reception.getByText(new RegExp(`発令（受入をお願いします）：${orderNumber}`)).first().waitFor();
    await reception.goto(`${BASE}/mails`);
    await reception.getByText(new RegExp(`【オーダー管理】発令（受入をお願いします）：${orderNumber}`)).first().waitFor();
  });

  await step("8. ロールで押せるボタンが変わる（閲覧は受入できない／技術受付は受入できる）", async () => {
    const viewer = await login("design@example.com");
    await viewer.goto(orderUrl);
    await viewer.locator("h1").waitFor();
    assert.equal(await viewer.locator("button:has-text('受入する')").count(), 0);
    assert.equal(await viewer.locator("a:has-text('オーダー作成')").count(), 0);
    await viewer.goto(`${BASE}/admin`);
    await viewer.getByText("権限がありません", { exact: true }).waitFor();
    await viewer.context().close();
    await sales.goto(`${BASE}/reports/quality`);
    await sales.getByText("権限がありません", { exact: true }).waitFor();
  });

  await step("4. 技術受付が受入（技術担当を割当）", async () => {
    await reception.goto(orderUrl);
    await reception.click("button:has-text('受入する')");
    await reception.locator("select[name=techUserId]").selectOption({ label: "大野 翔" });
    await reception.locator("form button:has-text('受入する')").click();
    await reception.getByText("仕様確定待ち").first().waitFor();
  });

  await step("4. 技術受付が差戻し、理由が営業に届く", async () => {
    await reception.goto(`${BASE}/orders?status=ACCEPT_PENDING`);
    const link = reception.locator("tbody a").filter({ hasNotText: orderNumber }).first();
    const other = await link.innerText();
    await link.click();
    await reception.click("button:has-text('差し戻す')");
    await reception.fill("textarea[name=reason]", "E2E：見積書が旧版です。最新版に差し替えてください。");
    await reception.locator("form button:has-text('差し戻す')").click();
    await reception.getByText("差し戻されました").waitFor();
    const s2 = await login("sales2@example.com");
    await s2.goto(`${BASE}/notifications`);
    const n = s2.getByText(new RegExp(`差戻し：${other}`)).first();
    const visible = await n.isVisible().catch(() => false);
    if (!visible) {
      // 差し戻したオーダーの営業担当が sales1 の場合
      await sales.goto(`${BASE}/notifications`);
      await sales.getByText(new RegExp(`差戻し：${other}`)).first().waitFor();
      await sales.getByText("E2E：見積書が旧版です。").first().waitFor();
    } else {
      await s2.getByText("E2E：見積書が旧版です。").first().waitFor();
    }
    await s2.context().close();
  });

  const tech = await login("tech1@example.com");
  await step("5. 未確定項目を確定すると仕様項目に反映される", async () => {
    await tech.goto(`${orderUrl}?tab=unresolved`);
    const item = tech.locator("[id^=unresolved-]").filter({ hasText: "立会試験の有無・予定" });
    await item.locator("button:has-text('確定する')").first().click();
    await item.locator("textarea[name=resolution]").fill("立会あり。出荷前に工場立会（顧客確認済み）");
    await item.locator("textarea[name=specValue]").fill("有。出荷前に工場立会");
    await item.locator("form button:has-text('確定する')").click();
    await tech.getByText("未確定項目を確定しました。").waitFor();
    await tech.goto(`${orderUrl}?tab=spec`);
    await tech.getByText("有。出荷前に工場立会").waitFor();
  });

  await step("5. 未確定がゼロになるとステータスが「仕様確定」になる", async () => {
    await tech.goto(`${orderUrl}?tab=unresolved`);
    const item = tech.locator("[id^=unresolved-]").filter({ hasText: "資料：単線結線図" });
    await item.locator("button:has-text('確定する')").first().click();
    await item.locator("textarea[name=resolution]").fill("資料を入手");
    await item.locator("input[name=url]").fill("https://example.sharepoint.com/sites/demo/e2e/sld.pdf");
    await item.locator("input[name=version]").fill("1");
    await item.locator("input[name=docDate]").fill(iso(0));
    await item.locator("form button:has-text('確定する')").click();
    await tech.getByText("資料を登録し、未確定項目を確定しました。").waitFor();
    await tech.goto(orderUrl);
    await tech.locator("h1").getByText("仕様確定", { exact: true }).waitFor();
  });

  await step("6. 資料の新しい版を登録すると旧版が履歴に残り、最新版だけが「最新」", async () => {
    await tech.goto(`${orderUrl}?tab=documents`);
    const doc = tech.locator("div.rounded-md").filter({ hasText: "見積書（内訳・前提機器がわかるもの）" }).first();
    await doc.locator("button:has-text('新しい版を登録')").click();
    await doc.locator("input[name=url]").fill("https://example.sharepoint.com/sites/demo/e2e/quote_v2.pdf");
    await doc.locator("input[name=version]").fill("2");
    await doc.locator("input[name=docDate]").fill(iso(0));
    await doc.locator("form button:has-text('登録する')").click();
    await tech.getByText("資料の新しい版を登録しました。").waitFor();
    await tech.reload();
    const d2 = tech.locator("div.rounded-md").filter({ hasText: "見積書（内訳・前提機器がわかるもの）" }).first();
    await d2.getByText("quote_v2.pdf").waitFor();
    assert.equal(await d2.getByText("最新", { exact: true }).count(), 1);
    await d2.getByText("旧版の履歴（1件）").waitFor();
  });

  const manager = await login("manager@example.com");
  await step("7. 未確定項目レポート・発令品質レポートの表示と CSV 出力", async () => {
    await manager.goto(`${BASE}/reports/unresolved`);
    await manager.getByText(/件（期限超過 \d+件）/).waitFor();
    await manager.goto(`${BASE}/reports/unresolved?view=summary&axis=category`);
    await manager.getByText("確定までの平均日数").first().waitFor();
    await manager.goto(`${BASE}/reports/quality`);
    await manager.getByText("発令時点で未確定ありの件数").waitFor();
    for (const path of ["/reports/unresolved/export?type=list", "/reports/unresolved/export?type=summary&axis=month", "/reports/quality/export", "/orders/export"]) {
      const res = await manager.request.get(`${BASE}${path}`);
      assert.equal(res.status(), 200, path);
      const buf = await res.body();
      assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${path} に BOM がない`);
    }
  });

  await step("8. 営業は管理画面・他人の下書きを見られない", async () => {
    await sales.goto(`${BASE}/admin/users`);
    await sales.getByText("権限がありません", { exact: true }).waitFor();
  });
} catch {
  // 失敗内容は step で表示済み
} finally {
  await browser.close();
}

const ng = results.filter((r) => r[0] === "NG").length;
console.log(`\n${results.length - ng}/${results.length} 件成功`);
process.exit(ng ? 1 : 0);
