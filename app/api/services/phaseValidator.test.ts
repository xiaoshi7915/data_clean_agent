import { describe, expect, it, vi, beforeEach } from "vitest";
import { validatePhaseTransition, PhaseValidationError } from "./phaseValidator";
import type { CleaningRule } from "@contracts/types";

vi.mock("./sessionService", () => ({
  getFullSession: vi.fn(),
}));

import { getFullSession } from "./sessionService";

const mockedGetFullSession = vi.mocked(getFullSession);

type FullSession = NonNullable<Awaited<ReturnType<typeof getFullSession>>>;

function mockFullSession(overrides: Partial<FullSession>): FullSession {
  return {
    sessionId: "sess_1",
    currentPhase: "idle",
    dataSourceId: undefined,
    sessionTitle: undefined,
    dataSource: undefined,
    targetTable: undefined,
    explorationResult: undefined,
    qualityReport: undefined,
    cleaningRules: [],
    confirmedRules: [],
    generatedSQL: undefined,
    executionResult: undefined,
    retryContext: undefined,
    lastAction: "",
    retryCount: 0,
    createdAt: "",
    updatedAt: "",
    messages: [],
    ...overrides,
  };
}

const baseRule: CleaningRule = {
  id: "r1",
  index: 1,
  name: "test",
  field: "col",
  action: "fill_null",
  affectedRows: 1,
  affectedPercent: 1,
  parameters: {},
  status: "confirmed",
};

describe("phaseValidator", () => {
  beforeEach(() => {
    mockedGetFullSession.mockReset();
  });

  it("会话不存在时抛出 PhaseValidationError", async () => {
    mockedGetFullSession.mockResolvedValue(null);
    await expect(validatePhaseTransition("sess_x", "explore")).rejects.toThrow(PhaseValidationError);
  });

  it("analyze 前未 explore 时拒绝", async () => {
    mockedGetFullSession.mockResolvedValue(
      mockFullSession({
        currentPhase: "explore",
        dataSource: { type: "mysql", name: "db" },
      })
    );
    await expect(validatePhaseTransition("sess_1", "analyze")).rejects.toThrow(/请先完成数据探查/);
  });

  it("PostgreSQL 数据库 explore 已支持", async () => {
    mockedGetFullSession.mockResolvedValue(
      mockFullSession({
        currentPhase: "idle",
        dataSource: {
          type: "postgresql",
          name: "pg",
          dbConfig: {
            host: "localhost",
            port: 5432,
            database: "app",
            username: "u",
            password: "p",
          },
        },
        targetTable: "users",
      })
    );
    await expect(validatePhaseTransition("sess_1", "explore")).resolves.toBeDefined();
  });

  it("Oracle 数据库 explore 已支持", async () => {
    mockedGetFullSession.mockResolvedValue(
      mockFullSession({
        currentPhase: "idle",
        dataSource: {
          type: "oracle",
          name: "ora",
          dbConfig: {
            host: "localhost",
            port: 1521,
            database: "app",
            username: "u",
            password: "p",
          },
        },
        targetTable: "users",
      })
    );
    await expect(validatePhaseTransition("sess_1", "explore")).resolves.toBeDefined();
  });

  it("generate 需要至少一条 confirmed 规则", async () => {
    mockedGetFullSession.mockResolvedValue(
      mockFullSession({
        currentPhase: "confirm",
        dataSource: { type: "mysql", name: "db" },
        explorationResult: {
          sourceType: "mysql",
          sourceName: "t",
          totalRows: 1,
          totalCols: 1,
          schema: [],
          sampleData: [],
          columnStats: [],
          sampleSize: 1,
          issues: [],
        },
        cleaningRules: [{ ...baseRule, status: "pending" }],
      })
    );
    await expect(validatePhaseTransition("sess_1", "generate")).rejects.toThrow(/至少确认一条/);
  });
});
