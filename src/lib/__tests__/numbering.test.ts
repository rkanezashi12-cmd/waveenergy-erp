import { describe, expect, it } from "vitest";
import { DEFAULT_RULE, formatOrderNumber, periodKey } from "@/lib/numbering";

describe("採番", () => {
  const now = new Date("2026-10-27T03:00:00Z");
  it("初期値は WE-2026-0001 形式", () => {
    expect(formatOrderNumber(DEFAULT_RULE, 1, now)).toBe("WE-2026-0001");
    expect(periodKey(DEFAULT_RULE, now)).toBe("2026");
  });
  it("年度でリセットする場合は年度を使う", () => {
    const rule = { ...DEFAULT_RULE, resetUnit: "FISCAL_YEAR" as const };
    const feb = new Date("2027-02-10T03:00:00Z");
    expect(periodKey(rule, feb)).toBe("FY2026");
    expect(formatOrderNumber(rule, 12, feb)).toBe("WE-2026-0012");
  });
  it("年を含めない・下2桁", () => {
    expect(formatOrderNumber({ ...DEFAULT_RULE, yearFormat: "NONE", resetUnit: "NONE", digits: 6 }, 35, now)).toBe("WE-000035");
    expect(formatOrderNumber({ ...DEFAULT_RULE, yearFormat: "YY", prefix: "" }, 7, now)).toBe("26-0007");
  });
  it("日本時間で年が変わる", () => {
    expect(periodKey(DEFAULT_RULE, new Date("2026-12-31T16:00:00Z"))).toBe("2027");
  });
});
