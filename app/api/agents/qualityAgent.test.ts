import { describe, expect, it } from "vitest";
import { diagnose } from "./qualityAgent";
import type { CleaningRule } from "@contracts/types";

const rules: CleaningRule[] = [
  {
    id: "r1",
    index: 1,
    name: "空值填充",
    field: "email",
    action: "fill_null",
    affectedRows: 5,
    affectedPercent: 2,
    parameters: { fillValue: "N/A" },
    status: "confirmed",
  },
];

describe("qualityAgent.diagnose", () => {
  it("根据校验失败详情建议规则修补", () => {
    const suggestions = diagnose(
      { status: "fail", details: "email column has null values" },
      rules
    );
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].field).toBe("email");
    expect(suggestions[0].suggestion).toMatch(/空值|fill/i);
  });

  it("无匹配字段时返回全局建议", () => {
    const suggestions = diagnose({ status: "fail", details: "unknown error" }, rules);
    expect(suggestions.some((s) => s.ruleId === "global")).toBe(true);
  });
});
