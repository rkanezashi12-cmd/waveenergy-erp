import { describe, expect, it } from "vitest";
import {
  canTransition,
  checkIssuable,
  compareVersion,
  extractMentions,
  isShortLeadTime,
  isValidDocumentLocation,
  versionWarnings,
  type IssueCheckInput,
} from "@/lib/orders/rules";
import { parseDateOnly } from "@/lib/dates";

const d = (s: string) => parseDateOnly(s)!;

function baseInput(): IssueCheckInput {
  return {
    order: {
      productCategoryId: "cat",
      customerId: "cus",
      siteName: "テスト現場",
      endUser: null,
      title: "件名",
      quantity: "2",
      salesUserId: "u1",
      salesDepartmentId: "dep",
      contractDeliveryDate: d("2027-06-30"),
      deliveryType: "FIXED",
      deliveryFixDueDate: null,
      shortLeadTime: false,
      shortLeadConsulted: null,
      orderDocType: "PURCHASE_ORDER",
    },
    hasOpenDeliveryItem: false,
    specFields: [
      { templateId: "s1", label: "標準仕様からの変更点", required: true, inputType: "TEXTAREA_NONE", value: { value: "なし", state: "FILLED", naReason: null }, hasOpenUnresolved: false },
      { templateId: "s2", label: "特記事項", required: false, inputType: "TEXTAREA", value: null, hasOpenUnresolved: false },
    ],
    documents: [
      { templateId: "d1", name: "見積書", requirement: "REQUIRED", state: "ATTACHED", naReason: null, hasLatestVersion: true, hasOpenUnresolved: false },
      { templateId: "d2", name: "機器外形図", requirement: "OPTIONAL", state: null, naReason: null, hasLatestVersion: false, hasOpenUnresolved: false },
    ],
  };
}

describe("発令チェック", () => {
  it("すべて揃っていれば発令できる", () => {
    const r = checkIssuable(baseInput());
    expect(r.problems).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("必須項目が空欄なら発令できず、どこが足りないか分かる", () => {
    const i = baseInput();
    i.order.title = " ";
    i.specFields[0].value = null;
    i.documents[0].state = null;
    const r = checkIssuable(i);
    expect(r.problems.map((p) => [p.step, p.target])).toEqual([
      [1, "件名"],
      [3, "標準仕様からの変更点"],
      [4, "見積書"],
    ]);
  });

  it("任意の項目・任意の資料は空欄でもよい", () => {
    const r = checkIssuable(baseInput());
    expect(r.problems.find((p) => p.target === "特記事項")).toBeUndefined();
    expect(r.problems.find((p) => p.target === "機器外形図")).toBeUndefined();
  });

  it("条件付き資料は状態の選択が必要", () => {
    const i = baseInput();
    i.documents.push({ templateId: "d3", name: "単線結線図", requirement: "CONDITIONAL", state: null, naReason: null, hasLatestVersion: false, hasOpenUnresolved: false });
    expect(checkIssuable(i).problems.map((p) => p.target)).toContain("単線結線図");
  });

  it("該当なしは理由が必須", () => {
    const i = baseInput();
    i.specFields[0].value = { value: null, state: "NOT_APPLICABLE", naReason: "" };
    i.documents[0] = { ...i.documents[0], state: "NOT_APPLICABLE", naReason: null };
    const r = checkIssuable(i);
    expect(r.problems).toHaveLength(2);
  });

  it("未確定は未確定項目の登録が必要。登録済みなら発令できる", () => {
    const i = baseInput();
    i.specFields[0].value = { value: null, state: "UNRESOLVED", naReason: null };
    expect(checkIssuable(i).problems).toHaveLength(1);
    i.specFields[0].hasOpenUnresolved = true;
    expect(checkIssuable(i).problems).toHaveLength(0);
  });

  it("添付済みの資料は URL・版数・日付が必要", () => {
    const i = baseInput();
    i.documents[0].hasLatestVersion = false;
    expect(checkIssuable(i).problems[0].message).toContain("URL・版数・日付");
  });

  it("未入手の資料は未確定項目が必要", () => {
    const i = baseInput();
    i.documents[0] = { ...i.documents[0], state: "NOT_OBTAINED", hasLatestVersion: false };
    expect(checkIssuable(i).problems).toHaveLength(1);
    i.documents[0].hasOpenUnresolved = true;
    expect(checkIssuable(i).problems).toHaveLength(0);
  });

  it("納期区分が仮なら確定予定日が必須", () => {
    const i = baseInput();
    i.order.deliveryType = "TENTATIVE";
    expect(checkIssuable(i).problems.map((p) => p.target)).toContain("確定予定日");
    i.order.deliveryFixDueDate = d("2026-11-30");
    i.hasOpenDeliveryItem = true;
    expect(checkIssuable(i).problems).toHaveLength(0);
  });

  it("短納期は事前協議の入力が必須、内示書は警告", () => {
    const i = baseInput();
    i.order.shortLeadTime = true;
    i.order.orderDocType = "LETTER_OF_INTENT";
    const r = checkIssuable(i);
    expect(r.problems.map((p) => p.target)).toEqual(["事前協議"]);
    expect(r.warnings.some((w) => w.includes("内示書"))).toBe(true);
  });
});

describe("短納期の判定", () => {
  it("契約納期が標準納期より短ければ短納期", () => {
    expect(isShortLeadTime(d("2027-01-31"), 4, d("2026-10-27"))).toBe(true);
    expect(isShortLeadTime(d("2027-02-27"), 4, d("2026-10-27"))).toBe(false);
    expect(isShortLeadTime(d("2027-01-31"), null, d("2026-10-27"))).toBe(false);
  });
});

describe("資料", () => {
  it("URLとファイルサーバーのパスを受け付ける", () => {
    expect(isValidDocumentLocation("https://example.sharepoint.com/sites/a/b.pdf")).toBe(true);
    expect(isValidDocumentLocation("\\\\fileserver\\share\\見積書.pdf")).toBe(true);
    expect(isValidDocumentLocation("http://example.com/a.pdf")).toBe(false);
    expect(isValidDocumentLocation("C:\\temp\\a.pdf")).toBe(false);
  });

  it("版数の比較", () => {
    expect(compareVersion("Rev.2", "Rev.1")).toBeGreaterThan(0);
    expect(compareVersion("第3版", "第10版")).toBeLessThan(0);
    expect(compareVersion("1.2", "1.10")).toBeLessThan(0);
    expect(compareVersion("B", "A")).toBeGreaterThan(0);
  });

  it("版数・日付が前の版と同じ・古いときは警告", () => {
    const prev = { version: "2", docDate: d("2026-10-01") };
    expect(versionWarnings(prev, { version: "3", docDate: d("2026-10-10") })).toEqual([]);
    expect(versionWarnings(prev, { version: "2", docDate: d("2026-10-01") })).toHaveLength(2);
    expect(versionWarnings(prev, { version: "1", docDate: d("2026-09-01") })[0]).toContain("古く");
    expect(versionWarnings(null, { version: "1", docDate: d("2026-09-01") })).toEqual([]);
  });
});

describe("ステータス遷移", () => {
  it("仕様どおりの遷移だけを許す", () => {
    expect(canTransition("DRAFT", "ACCEPT_PENDING")).toBe(true);
    expect(canTransition("ACCEPT_PENDING", "RETURNED")).toBe(true);
    expect(canTransition("SPEC_PENDING", "CANCELLED")).toBe(false);
    expect(canTransition("COMPLETED", "DRAFT")).toBe(false);
  });
});

describe("メンション", () => {
  const users = [
    { id: "1", name: "山田 太郎" },
    { id: "2", name: "山田" },
    { id: "3", name: "佐藤花子" },
  ];
  it("名前の空白を無視して照合する", () => {
    expect(extractMentions("@山田太郎 さん確認お願いします", users).map((u) => u.id)).toEqual(["1"]);
    expect(extractMentions("＠佐藤花子、@山田 よろしく", users).map((u) => u.id).sort()).toEqual(["2", "3"]);
    expect(extractMentions("メンションなし", users)).toEqual([]);
  });
});
