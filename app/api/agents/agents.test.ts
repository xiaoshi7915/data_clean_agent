import { describe, expect, it, vi } from "vitest";
import { runQualityAgent } from "./qualityAgent";
import type { ExplorationResult } from "@contracts/types";

const exploration: ExplorationResult = {
  sourceType: "mysql",
  sourceName: "users",
  totalRows: 10,
  totalCols: 2,
  schema: [{ name: "email", type: "varchar", nullable: true }],
  sampleData: [{ email: "a@b.com" }],
  columnStats: [
    {
      columnName: "email",
      dataType: "varchar",
      nullRate: 0,
      nullCount: 0,
      uniqueCount: 10,
      sampleValues: ["a@b.com"],
    },
  ],
  sampleSize: 1,
  issues: [],
};

describe("qualityAgent", () => {
  it("生成质量报告与规则", () => {
    const result = runQualityAgent({ sessionId: "s1", exploration });
    expect(result.success).toBe(true);
    expect(result.data?.report.score.overall).toBeGreaterThan(0);
    expect(Array.isArray(result.data?.rules)).toBe(true);
  });
});

describe("schemaAgent", () => {
  it("缺少 dbConfig 时失败", async () => {
    const { runSchemaAgent } = await import("./schemaAgent");
    const result = await runSchemaAgent({
      sessionId: "s1",
      dataSource: { type: "mysql", name: "db" },
      tableName: "users",
    });
    expect(result.success).toBe(false);
  });
});

describe("repairAgent", () => {
  it("根据规则生成 SQL", async () => {
    const { runRepairAgent } = await import("./repairAgent");
    const result = runRepairAgent({
      sessionId: "s1",
      rules: [
        {
          id: "r1",
          index: 1,
          name: "fill",
          field: "name",
          action: "fill_null",
          affectedRows: 1,
          affectedPercent: 1,
          parameters: { fillValue: "X" },
          status: "confirmed",
        },
      ],
      dialect: "mysql",
      tableName: "users",
      databaseName: "mydb",
      columns: ["name"],
    });
    expect(result.success).toBe(true);
    expect(result.data?.sqlResult.steps.length).toBeGreaterThan(0);
  });
});
