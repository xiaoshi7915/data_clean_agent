import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { appRouter } from "../router";

vi.mock("../services/dataSourceService", () => ({
  listDatabaseTables: vi.fn(),
  exploreDatabase: vi.fn(),
  exploreFile: vi.fn(),
  testDatabaseConnection: vi.fn(),
}));

vi.mock("../services/sessionService", () => ({
  getSession: vi.fn(),
  getFullSession: vi.fn(),
  updateSessionPhase: vi.fn(),
  updateSessionTargetTable: vi.fn(),
  updateSessionTitle: vi.fn(),
}));

vi.mock("../services/phaseValidator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/phaseValidator")>();
  return {
    ...actual,
    validatePhaseTransition: vi.fn(),
  };
});

vi.mock("../services/executionService", () => ({
  executeSQLSteps: vi.fn(),
  generateRetryContext: vi.fn(),
  applyManualFix: vi.fn(),
}));

vi.mock("../services/fileCleaningService", () => ({
  executeFileCleaning: vi.fn(),
}));

vi.mock("../queries/connection", () => ({
  getDb: () => ({
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
  }),
}));

vi.mock("../services/contractService", () => ({
  exportSessionContractYaml: vi.fn().mockResolvedValue("version: '1.0'\nrules: []"),
  exportSessionContractJson: vi.fn().mockResolvedValue({ version: "1.0", rules: [] }),
  importContractToSession: vi.fn(),
  getSessionContractYaml: vi.fn(),
  loadContractFromDbRules: vi.fn(),
}));

import { listDatabaseTables } from "../services/dataSourceService";
import { validatePhaseTransition, PhaseValidationError } from "../services/phaseValidator";
import { executeSQLSteps } from "../services/executionService";

const mockedListTables = vi.mocked(listDatabaseTables);
const mockedValidate = vi.mocked(validatePhaseTransition);
const mockedExecute = vi.mocked(executeSQLSteps);

function createCaller(auth?: string) {
  const headers = auth ? { Authorization: `Bearer ${auth}` } : {};
  return appRouter.createCaller({
    req: new Request("http://localhost/api/trpc", { headers }),
    resHeaders: new Headers(),
  });
}

describe("appRouter integration", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_SECRET", "");
    vi.clearAllMocks();
  });

  it("ping 公开可访问", async () => {
    const caller = createCaller();
    const res = await caller.ping();
    expect(res.ok).toBe(true);
  });

  it("explore.listTables 成功返回表列表", async () => {
    mockedListTables.mockResolvedValue([
      { name: "users", rowCount: 100 },
      { name: "orders", rowCount: 50 },
    ]);
    const caller = createCaller();
    const res = await caller.explore.listTables({
      config: {
        host: "127.0.0.1",
        port: 3306,
        database: "db",
        username: "root",
        password: "pass",
      },
      dbType: "mysql",
    });
    expect(res.success).toBe(true);
    expect(res.tables?.map((t) => t.name)).toEqual(["users", "orders"]);
  });

  it("analyze 在有效会话下成功", async () => {
    mockedValidate.mockResolvedValue({
      sessionId: "sess_1",
      currentPhase: "explore",
      dataSource: { type: "mysql", name: "db" },
      explorationResult: undefined,
      cleaningRules: [],
      confirmedRules: [],
      messages: [],
      lastAction: "",
      retryCount: 0,
      createdAt: "",
      updatedAt: "",
    } as never);

    const caller = createCaller();
    const res = await caller.analyze.analyze({
      sessionId: "sess_1",
      explorationResult: {
        sourceType: "mysql",
        sourceName: "users",
        totalRows: 10,
        totalCols: 2,
        schema: [],
        sampleData: [{ email: "a@b.com", name: "A" }],
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
      },
    });

    expect(res.success).toBe(true);
    expect(res.rules.length).toBeGreaterThan(0);
  });

  it("analyze 阶段校验失败返回错误", async () => {
    mockedValidate.mockRejectedValue(new PhaseValidationError("请先完成数据探查"));

    const caller = createCaller();
    const res = await caller.analyze.analyze({
      sessionId: "sess_x",
      explorationResult: {
        sourceType: "mysql",
        sourceName: "t",
        totalRows: 1,
        totalCols: 1,
        schema: [],
        sampleData: [],
        columnStats: [],
        sampleSize: 0,
        issues: [],
      },
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/请先完成数据探查/);
  });

  it("explore.exploreDatabase 阶段校验拒绝", async () => {
    mockedValidate.mockRejectedValue(new PhaseValidationError("请先连接数据源"));

    const caller = createCaller();
    const res = await caller.explore.exploreDatabase({
      sessionId: "sess_x",
      config: {
        host: "127.0.0.1",
        port: 3306,
        database: "db",
        username: "u",
        password: "p",
      },
      tableName: "users",
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/请先连接数据源/);
  });

  it("配置 APP_SECRET 时 contract.exportYaml 需鉴权", async () => {
    vi.stubEnv("APP_SECRET", "test-secret");
    const caller = createCaller();
    await expect(caller.contract.exportYaml({ sessionId: "sess_1" })).rejects.toThrow(TRPCError);
  });

  it("Bearer 正确时 protectedQuery 可通过", async () => {
    vi.stubEnv("APP_SECRET", "test-secret");
    const caller = createCaller("test-secret");
    const res = await caller.contract.exportYaml({ sessionId: "sess_1" });
    expect(res.success).toBe(true);
    expect(res.yaml).toContain("version");
  });

  it("SCRIPT_ONLY 模式下拒绝非 dry-run 执行", async () => {
    vi.stubEnv("ALLOW_EXECUTE", "");
    mockedValidate.mockResolvedValue({} as never);
    mockedExecute.mockResolvedValue({ overallStatus: "success", stepResults: [] } as never);

    const caller = createCaller();
    const res = await caller.execute.execute({
      sessionId: "sess_1",
      steps: [
        {
          stepNumber: 1,
          name: "test",
          operationType: "UPDATE",
          sql: "UPDATE users SET name='x' WHERE id=1;",
          affectedRows: 1,
          riskLevel: "low",
        },
      ],
      dbConfig: {
        host: "127.0.0.1",
        port: 3306,
        database: "db",
        username: "u",
        password: "p",
      },
      dialect: "mysql",
      dryRun: false,
      metricsBefore: {
        overall: 70,
        completeness: 70,
        uniqueness: 80,
        consistency: 75,
        validity: 70,
        accuracy: 70,
      },
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/SCRIPT_ONLY/);
    expect(mockedExecute).not.toHaveBeenCalled();
  });

  it("artifact.config 返回 scriptOnly 默认值", async () => {
    vi.stubEnv("ALLOW_EXECUTE", "");
    const caller = createCaller();
    const cfg = await caller.artifact.config();
    expect(cfg.scriptOnly).toBe(true);
    expect(cfg.allowExecute).toBe(false);
  });
});
