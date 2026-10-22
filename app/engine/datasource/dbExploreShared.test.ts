import { describe, expect, it } from "vitest";
import { buildColumnIssues } from "./dbExploreShared";

describe("buildColumnIssues", () => {
  it("skips ID duplicate detection when stats are sample-based", () => {
    const issues = buildColumnIssues("user_id", "VARCHAR", 1_000_000, 0, 80, {
      sampleBasedStats: true,
    });
    expect(issues.some((i) => i.issueType === "唯一键重复")).toBe(false);
  });

  it("reports ID duplicates on full-table stats", () => {
    const issues = buildColumnIssues("user_id", "VARCHAR", 100, 0, 90, {
      sampleBasedStats: false,
    });
    expect(issues.some((i) => i.issueType === "唯一键重复")).toBe(true);
  });
});
