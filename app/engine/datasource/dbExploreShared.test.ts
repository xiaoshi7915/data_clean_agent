import { describe, expect, it } from "vitest";
import { buildColumnIssues } from "./dbExploreShared";

describe("buildColumnIssues", () => {
  it("样本统计模式下不报告 ID 列重复（避免样本 distinct 与全表行数误比）", () => {
    const issues = buildColumnIssues("user_id", "bigint", 1_000_000, 0, 100, true);
    expect(issues.some((i) => i.issueType === "唯一键重复")).toBe(false);
  });

  it("全表统计模式下仍检测 ID 列重复", () => {
    const issues = buildColumnIssues("user_id", "bigint", 100, 0, 50, false);
    expect(issues.some((i) => i.issueType === "唯一键重复")).toBe(true);
  });
});
