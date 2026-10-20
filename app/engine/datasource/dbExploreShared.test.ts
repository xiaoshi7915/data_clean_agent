import { describe, expect, it } from "vitest";
import { buildColumnIssues } from "./dbExploreShared";

describe("buildColumnIssues", () => {
  it("skips ID duplicate detection when stats are sample-based", () => {
    const issues = buildColumnIssues("user_id", "int", 1_000_000, 0, 50, true);
    expect(issues.some((i) => i.issueType === "唯一键重复")).toBe(false);
  });

  it("flags ID duplicates on full-table stats", () => {
    const issues = buildColumnIssues("user_id", "int", 100, 0, 90, false);
    expect(issues.some((i) => i.issueType === "唯一键重复")).toBe(true);
  });
});
