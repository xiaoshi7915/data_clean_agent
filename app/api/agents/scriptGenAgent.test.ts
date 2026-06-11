import { describe, expect, it } from "vitest";
import { rulesToSodaChecksYaml, runScriptGenAgent } from "./scriptGenAgent";
import type { CleaningRule } from "@contracts/types";

const sampleRules: CleaningRule[] = [
  {
    id: "r1",
    index: 1,
    name: "空值填充",
    field: "email",
    action: "fill_null",
    affectedRows: 10,
    affectedPercent: 5,
    parameters: { fillValue: "N/A" },
    status: "confirmed",
  },
];

describe("scriptGenAgent", () => {
  it("生成 Soda checks YAML", () => {
    const yaml = rulesToSodaChecksYaml({
      dataset: "datasource/mydb/default/users",
      rules: sampleRules,
      exploration: {
        sourceType: "mysql",
        sourceName: "users",
        totalRows: 100,
        totalCols: 2,
        schema: [{ name: "email", type: "varchar", nullable: true }],
        sampleData: [],
        columnStats: [{ columnName: "email", dataType: "varchar", nullRate: 0.1, nullCount: 10, uniqueCount: 90, sampleValues: [] }],
        sampleSize: 0,
        issues: [],
      },
    });
    expect(yaml).toContain("dataset:");
    expect(yaml).toContain("email");
    expect(yaml).toContain("checks:");
  });

  it("runScriptGenAgent 返回路径", () => {
    const result = runScriptGenAgent({
      dataset: "datasource/db/default/t",
      rules: sampleRules,
    });
    expect(result.success).toBe(true);
    expect(result.data?.sodaChecksPath).toBe("soda/checks.yml");
  });
});
