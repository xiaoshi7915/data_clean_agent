import { describe, expect, it } from "vitest";
import { buildColumnIssues } from "./dbExploreShared";

describe("buildColumnIssues", () => {
  it("does not flag ID duplicates when stats are sample-based", () => {
    const issues = buildColumnIssues("user_id", "bigint", 1_000_000, 0, 100, {
      useSampleStats: true,
      statsRowCount: 100,
    });

    expect(issues.some((issue) => issue.issueType === "唯一键重复")).toBe(false);
  });

  it("flags ID duplicates on full-table stats", () => {
    const issues = buildColumnIssues("user_id", "bigint", 1000, 0, 900);

    const dup = issues.find((issue) => issue.issueType === "唯一键重复");
    expect(dup).toBeDefined();
    expect(dup?.affectedRows).toBe(100);
  });
});
