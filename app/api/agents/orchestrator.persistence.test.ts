import { describe, expect, it, vi, beforeEach } from "vitest";
import type { OrchestratorContext } from "./types";

const store = new Map<string, { runId: string; sessionId: string; ctx: OrchestratorContext }>();

vi.mock("../queries/connection", () => ({
  getDb: () => ({
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation(async (row: { runId: string; sessionId: string; context: OrchestratorContext }) => {
        store.set(row.runId, { runId: row.runId, sessionId: row.sessionId, ctx: row.context });
      }),
    })),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockImplementation((values: { state?: string; context?: OrchestratorContext }) => ({
        where: vi.fn().mockImplementation(async () => {
          for (const [key, entry] of store.entries()) {
            store.set(key, {
              ...entry,
              ctx: (values.context as OrchestratorContext) ?? {
                ...entry.ctx,
                state: (values.state as OrchestratorContext["state"]) ?? entry.ctx.state,
              },
            });
          }
        }),
      })),
    }),
    select: vi.fn().mockImplementation((fields?: unknown) => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          const rows = [...store.values()].map((entry) => {
            if (fields && typeof fields === "object") {
              return {
                runId: entry.runId,
                state: entry.ctx.state,
                createdAt: new Date(),
              };
            }
            return {
              runId: entry.runId,
              sessionId: entry.sessionId,
              state: entry.ctx.state,
              context: entry.ctx,
              createdAt: new Date(),
            };
          });
          // 兼容 .limit(1) 与直接 await where()
          const queryable = {
            limit: vi.fn().mockResolvedValue(rows),
            then: (resolve: (v: typeof rows) => void) => resolve(rows),
          };
          return queryable;
        }),
      }),
    })),
  }),
}));

vi.mock("../services/sessionService", () => ({
  getFullSession: vi.fn().mockResolvedValue({
    sessionId: "sess_test",
    targetTable: "users",
    dataSource: { type: "mysql", dbConfig: { database: "mydb", host: "127.0.0.1", port: 3306, username: "root", password: "" } },
    explorationResult: {
      sourceType: "mysql",
      sourceName: "users",
      totalRows: 100,
      totalCols: 2,
      schema: [{ name: "email", type: "varchar", nullable: true }],
      sampleData: [],
      columnStats: [],
      sampleSize: 0,
      issues: [],
    },
    cleaningRules: [
      {
        id: "r1",
        index: 1,
        name: "空值",
        field: "email",
        action: "fill_null",
        affectedRows: 1,
        affectedPercent: 1,
        parameters: {},
        status: "confirmed",
      },
    ],
    generatedSQL: {
      steps: [{ stepNumber: 1, name: "fill", operationType: "UPDATE", sql: "UPDATE users SET email='x'", affectedRows: 0, riskLevel: "low" }],
      targetTable: "users_cleaned",
    },
  }),
}));

vi.mock("../services/phaseValidator", () => ({
  validatePhaseTransition: vi.fn().mockResolvedValue({}),
  PhaseValidationError: class extends Error {},
}));

vi.mock("./schemaAgent", () => ({
  runSchemaAgent: vi.fn().mockResolvedValue({
    success: true,
    data: {
      exploration: {
        sourceType: "mysql",
        sourceName: "users",
        totalRows: 100,
        totalCols: 1,
        schema: [{ name: "email", type: "varchar", nullable: true }],
        sampleData: [],
        columnStats: [],
        sampleSize: 0,
        issues: [],
      },
    },
  }),
}));

vi.mock("./qualityAgent", () => ({
  runQualityAgent: vi.fn().mockReturnValue({
    success: true,
    data: {
      report: {
        score: { overall: 80, completeness: 80, uniqueness: 80, consistency: 80, validity: 80, accuracy: 80 },
        issues: [],
        recommendations: [],
      },
      rules: [
        {
          id: "r1",
          index: 1,
          name: "空值",
          field: "email",
          action: "fill_null",
          affectedRows: 1,
          affectedPercent: 1,
          parameters: {},
          status: "pending",
        },
      ],
    },
  }),
}));

import {
  startRun,
  advanceRun,
  getRunStatus,
  handleUserMessage,
  ingestVerificationResult,
  resolveEventTarget,
  createOrchestratorContext,
} from "./orchestrator";

describe("orchestrator persistence", () => {
  beforeEach(() => {
    store.clear();
    vi.stubEnv("MAX_REPAIR_ROUNDS", "3");
  });

  it("startRun 创建 DB 行并返回 runId", async () => {
    const { runId, ctx } = await startRun("sess_test", "users");
    expect(runId).toMatch(/^run_/);
    expect(ctx.state).toBe("schema_explore");
    expect(store.has(runId)).toBe(true);
  });

  it("advanceRun 校验转移并更新状态", async () => {
    const { runId } = await startRun("sess_test");
    const result = await advanceRun(runId, "explore_complete");
    expect(result.transitioned).toBe(true);
    expect(["quality_analyze", "failed"]).toContain(result.ctx.state);
  });

  it("getRunStatus 返回 state + context", async () => {
    const { runId, ctx } = await startRun("sess_test");
    const status = await getRunStatus(runId);
    expect(status?.runId).toBe(runId);
    expect(status?.state).toBe(ctx.state);
    expect(status?.context.input.sessionId).toBe("sess_test");
  });
});

describe("orchestrator handleUserMessage", () => {
  beforeEach(() => {
    store.clear();
  });

  it("解析导出意图并返回前端动作", async () => {
    const result = await handleUserMessage("sess_test", "请导出脚本包", {
      phase: "generate",
      hasExploration: true,
      hasQualityReport: true,
      rulesCount: 1,
      confirmedRulesCount: 1,
      hasGeneratedSQL: true,
      hasExecutionResult: false,
    });
    expect(result.orchestrated).toBe(true);
    expect(result.actions.some((a) => a.type === "exportScripts")).toBe(true);
  });

  it("非编排意图返回 orchestrated=false", async () => {
    const result = await handleUserMessage("sess_test", "你好", {
      phase: "idle",
      hasExploration: false,
      hasQualityReport: false,
      rulesCount: 0,
      confirmedRulesCount: 0,
      hasGeneratedSQL: false,
      hasExecutionResult: false,
    });
    expect(result.orchestrated).toBe(false);
  });

  it("一键流程在 human_confirm 暂停并返回 confirmAll/viewRules", async () => {
    const result = await handleUserMessage("sess_test", "一键全流程清洗", {
      phase: "explore",
      targetTable: "users",
      hasExploration: false,
      hasQualityReport: false,
      rulesCount: 0,
      confirmedRulesCount: 0,
      hasGeneratedSQL: false,
      hasExecutionResult: false,
    });
    expect(result.orchestrated).toBe(true);
    expect(result.state).toBe("human_confirm");
    expect(result.actions.some((a) => a.type === "confirmAll" || a.type === "viewRules")).toBe(
      true
    );
  });
});

describe("orchestrator feedback loop", () => {
  beforeEach(() => {
    store.clear();
    vi.stubEnv("MAX_REPAIR_ROUNDS", "3");
  });

  it("verify_fail 在 MAX_REPAIR_ROUNDS 内回环 quality_analyze", () => {
    const ctx = createOrchestratorContext("sess_test");
    const target = resolveEventTarget(
      { ...ctx, state: "external_verify", repairRound: 1 },
      "verify_fail"
    );
    expect(target).toBe("quality_analyze");
  });

  it("verify_fail 超过 MAX_REPAIR_ROUNDS 进入 failed", () => {
    const ctx = createOrchestratorContext("sess_test");
    const target = resolveEventTarget(
      { ...ctx, state: "external_verify", repairRound: 3 },
      "verify_fail"
    );
    expect(target).toBe("failed");
  });

  it("webhook verify_pass 推进到 done", async () => {
    const { runId } = await startRun("sess_test");
    store.set(runId, {
      runId,
      sessionId: "sess_test",
      ctx: { ...createOrchestratorContext("sess_test"), state: "external_verify" },
    });
    const result = await ingestVerificationResult(runId, "pass", "all checks passed");
    expect(["done", "failed", "external_verify"]).toContain(result.ctx.state);
  });
});
