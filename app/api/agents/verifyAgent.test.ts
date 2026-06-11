import { describe, expect, it, vi, beforeEach } from "vitest";
import { enhancedValidateSQL, runVerifyAgent } from "./verifyAgent";

const mockExecute = vi.fn();
vi.mock("../services/dataSourceService", () => ({
  createConnectionForDialect: vi.fn().mockResolvedValue({}),
  closeConnection: vi.fn().mockResolvedValue(undefined),
  createSqlExecutorFromPool: vi.fn(() => ({ execute: mockExecute })),
}));

describe("runVerifyAgent", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue(undefined);
  });

  it("无 dbConfig 时仅做静态校验", async () => {
    const result = await runVerifyAgent({
      sessionId: "s1",
      steps: [
        {
          stepNumber: 1,
          name: "select",
          operationType: "SELECT",
          sql: "SELECT 1;",
          affectedRows: 0,
          riskLevel: "low",
        },
      ],
      dialect: "mysql",
    });
    expect(result.success).toBe(true);
    expect(result.data?.valid).toBe(true);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("有 dbConfig 时对 MySQL 步骤执行 EXPLAIN", async () => {
    const result = await runVerifyAgent({
      sessionId: "s1",
      steps: [
        {
          stepNumber: 1,
          name: "select",
          operationType: "SELECT",
          sql: "SELECT 1;",
          affectedRows: 0,
          riskLevel: "low",
        },
      ],
      dialect: "mysql",
      dbConfig: {
        host: "127.0.0.1",
        port: 3306,
        database: "db",
        username: "u",
        password: "p",
      },
    });
    expect(result.success).toBe(true);
    expect(result.data?.valid).toBe(true);
    expect(mockExecute).toHaveBeenCalledWith("EXPLAIN SELECT 1;");
  });

  it("EXPLAIN 失败时标记步骤无效", async () => {
    mockExecute.mockRejectedValue(new Error("syntax error"));
    const result = await runVerifyAgent({
      sessionId: "s1",
      steps: [
        {
          stepNumber: 1,
          name: "bad",
          operationType: "SELECT",
          sql: "SELECT FROM;",
          affectedRows: 0,
          riskLevel: "low",
        },
      ],
      dialect: "postgresql",
      dbConfig: {
        host: "127.0.0.1",
        port: 5432,
        database: "db",
        username: "u",
        password: "p",
      },
    });
    expect(result.success).toBe(true);
    expect(result.data?.valid).toBe(false);
    expect(result.data?.stepResults[0]?.errors[0]).toMatch(/EXPLAIN/);
  });
});

describe("verifyAgent", () => {
  it("enhancedValidateSQL 拒绝空 SQL", () => {
    const result = enhancedValidateSQL("");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("不能为空"))).toBe(true);
  });

  it("enhancedValidateSQL 通过合法 SELECT", () => {
    const result = enhancedValidateSQL("SELECT 1;");
    expect(result.valid).toBe(true);
  });

  it("enhancedValidateSQL 拦截 TRUNCATE", () => {
    const result = enhancedValidateSQL("TRUNCATE TABLE users;");
    expect(result.valid).toBe(false);
  });
});
