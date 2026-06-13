import { describe, expect, it } from "vitest";
import { buildColumnIssues } from "./dbExploreShared";

describe("buildColumnIssues", () => {
  it("does not flag duplicate IDs when sample distinct count is below full table rows", () => {
    const issues = buildColumnIssues("user_id", "BIGINT", 1_000_000, 0, 100, {
      statsRowCount: 100,
    });

    expect(issues.find((issue) => issue.issueType === "唯一键重复")).toBeUndefined();
  });

  it("flags duplicate IDs within a sample when distinct count is below sample size", () => {
    const issues = buildColumnIssues("user_id", "BIGINT", 1_000_000, 0, 95, {
      statsRowCount: 100,
    });

    const dupIssue = issues.find((issue) => issue.issueType === "唯一键重复");
    expect(dupIssue).toBeDefined();
    expect(dupIssue?.affectedRows).toBeGreaterThan(0);
  });

  it("flags duplicate IDs on full-table scans", () => {
    const issues = buildColumnIssues("id", "INT", 1_000, 0, 990);

    const dupIssue = issues.find((issue) => issue.issueType === "唯一键重复");
    expect(dupIssue).toBeDefined();
    expect(dupIssue?.affectedRows).toBe(10);
  });
});
