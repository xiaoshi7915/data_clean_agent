import { describe, expect, it } from "vitest";
import { buildColumnIssues } from "./dbExploreShared";

describe("buildColumnIssues", () => {
  it("skips duplicate-id detection when stats are sample-based", () => {
    const issues = buildColumnIssues("user_id", "bigint", 1_000_000, 0, 500, {
      sampleBasedStats: true,
    });
    expect(issues.some((i) => i.issueType === "唯一键重复")).toBe(false);
  });

  it("reports duplicate ids on full-table stats", () => {
    const issues = buildColumnIssues("user_id", "bigint", 100, 0, 90, {
      sampleBasedStats: false,
    });
    expect(issues.some((i) => i.issueType === "唯一键重复")).toBe(true);
  });
});
