import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SQLStep, QualityScore } from "@contracts/types";
import {
  executeSQLSteps,
  generateRetryContext,
  applyManualFix,
} from "./executionService";

vi.mock("./dataSourceService", () => ({
  createConnectionForDialect: vi.fn(),
  createSqlExecutorFromPool: vi.fn(),
}));

vi.mock("../../engine/execution/runSqlSteps", () => ({
  runSqlSteps: vi.fn(),
}));

import { createConnectionForDialect, createSqlExecutorFromPool } from "./dataSourceService";
import { runSqlSteps } from "../../engine/execution/runSqlSteps";

const mockedCreateConnection = vi.mocked(createConnectionForDialect);
const mockedCreateExecutor = vi.mocked(createSqlExecutorFromPool);
const mockedRunSqlSteps = vi.mocked(runSqlSteps);

const metricsBefore: QualityScore = {
  overall: 70,
  completeness: 70,
  uniqueness: 80,
  consistency: 75,
  validity: 70,
  accuracy: 70,
};

const sampleStep: SQLStep = {
  stepNumber: 1,
  name: "更新空值",
  operationType: "UPDATE",
  sql: "UPDATE users SET name = 'x' WHERE name IS NULL",
  affectedRows: 10,
  riskLevel: "low",
};

describe("executeSQLSteps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCreateConnection.mockResolvedValue({} as never);
    mockedCreateExecutor.mockReturnValue({ execute: vi.fn() } as never);
  });

  it("不支持的方言直接抛错", async () => {
    await expect(
      executeSQLSteps(
        "sess_1",
        [sampleStep],
        { host: "h", port: 3306, database: "db", username: "u", password: "p" },
        "oracle",
        true,
        metricsBefore
      )
    ).rejects.toThrow(/尚未实现/);
  });

  it("委托 runSqlSteps 并返回结果", async () => {
    mockedRunSqlSteps.mockResolvedValue({
      executionId: "exec_1",
      overallStatus: "success",
      stepResults: [],
      metricsBefore,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    const result = await executeSQLSteps(
      "sess_1",
      [sampleStep],
      { host: "h", port: 3306, database: "db", username: "u", password: "p" },
      "mysql",
      true,
      metricsBefore
    );

    expect(result.overallStatus).toBe("success");
    expect(mockedRunSqlSteps).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "sess_1", dryRun: true })
    );
  });

  it("runSqlSteps 抛错时返回 failed 结构", async () => {
    mockedRunSqlSteps.mockRejectedValue(new Error("connection lost"));

    const result = await executeSQLSteps(
      "sess_1",
      [sampleStep],
      { host: "h", port: 3306, database: "db", username: "u", password: "p" },
      "mysql",
      false,
      metricsBefore
    );

    expect(result.overallStatus).toBe("failed");
    expect(result.error).toContain("connection lost");
  });
});

describe("generateRetryContext", () => {
  it("语法错误分类与方案", () => {
    const ctx = generateRetryContext("syntax error near FROM", sampleStep, 1);
    expect(ctx.errorType).toBe("语法错误");
    expect(ctx.options.length).toBeGreaterThanOrEqual(2);
    expect(ctx.options.some((o) => o.label === "方案C")).toBe(true);
  });

  it("权限错误分类", () => {
    const ctx = generateRetryContext("Access denied for user", sampleStep, 0);
    expect(ctx.errorType).toBe("权限错误");
  });
});

describe("applyManualFix", () => {
  it("非法 SQL 抛错", async () => {
    await expect(applyManualFix("s", [sampleStep], 1, "DROP TABLE users")).rejects.toThrow(
      /验证失败/
    );
  });

  it("替换指定步骤 SQL", async () => {
    const fixed = "UPDATE users SET name = 'fixed' WHERE name IS NULL";
    const steps = await applyManualFix("s", [sampleStep], 1, fixed);
    expect(steps[0].sql).toBe(fixed);
  });
});
