import { beforeEach, describe, expect, it, vi } from "vitest";
import { MASKED_PASSWORD } from "../lib/dataSourceSanitizer";

const createSessionMock = vi.fn();
const runSchemaAgentMock = vi.fn();
const cleanupSessionMock = vi.fn();
const resolveDbConfigInputMock = vi.fn();
const getSessionMock = vi.fn();
const listDatabaseTablesMock = vi.fn();
const persistExplorationMock = vi.fn();
const persistAnalysisMock = vi.fn();
const updateSessionPhaseMock = vi.fn();
const getCurrentRunIndexMock = vi.fn();

const mockDeleteWhere = vi.fn();
const mockInsertValues = vi.fn();
const mockSelectLimit = vi.fn();
const mockSelectWhere = vi.fn();
const mockSelectFrom = vi.fn();
const mockSelect = vi.fn();

vi.mock("../queries/connection", () => ({
  getDb: () => ({
    select: mockSelect,
    delete: vi.fn().mockReturnValue({ where: mockDeleteWhere }),
    insert: vi.fn().mockReturnValue({ values: mockInsertValues }),
  }),
}));

vi.mock("./sessionService", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
  createSession: (...args: unknown[]) => createSessionMock(...args),
  updateSessionPhase: (...args: unknown[]) => updateSessionPhaseMock(...args),
}));

vi.mock("./sessionCredentialService", () => ({
  resolveDbConfigInput: (...args: unknown[]) => resolveDbConfigInputMock(...args),
}));

vi.mock("./dataSourceService", () => ({
  listDatabaseTables: (...args: unknown[]) => listDatabaseTablesMock(...args),
  cleanupSession: (...args: unknown[]) => cleanupSessionMock(...args),
}));

vi.mock("../agents/schemaAgent", () => ({
  runSchemaAgent: (...args: unknown[]) => runSchemaAgentMock(...args),
}));

vi.mock("../agents/qualityAgent", () => ({
  runQualityAgent: vi.fn().mockReturnValue({
    success: true,
    data: {
      report: { score: { overall: 90 } },
      rules: [{ id: "r1", status: "confirmed" }],
    },
  }),
}));

vi.mock("../agents/repairAgent", () => ({
  runRepairAgent: vi.fn().mockReturnValue({
    success: true,
    data: {
      sqlResult: {
        steps: [],
        targetTable: "users_cleaned",
      },
    },
  }),
}));

vi.mock("./explorationPersistenceService", () => ({
  persistExploration: (...args: unknown[]) => persistExplorationMock(...args),
  persistAnalysis: (...args: unknown[]) => persistAnalysisMock(...args),
}));

vi.mock("./pipelineRunService", () => ({
  getCurrentRunIndex: (...args: unknown[]) => getCurrentRunIndexMock(...args),
}));

import { runBatchPipelineForDatabase } from "./batchPipelineService";

describe("runBatchPipelineForDatabase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteWhere.mockResolvedValue(undefined);
    mockInsertValues.mockResolvedValue(undefined);
    mockSelect.mockReturnValue({ from: mockSelectFrom });
    mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
    mockSelectWhere.mockReturnValue({ limit: mockSelectLimit });
    mockSelectLimit.mockResolvedValue([{ dataSourceId: "ds_parent" }]);

    getSessionMock.mockResolvedValue({
      dataSource: {
        type: "mysql",
        name: "demo",
        dbConfig: {
          host: "127.0.0.1",
          port: 3306,
          database: "demo",
          username: "root",
          password: MASKED_PASSWORD,
        },
      },
    });
    resolveDbConfigInputMock.mockResolvedValue({
      host: "127.0.0.1",
      port: 3306,
      database: "demo",
      username: "root",
      password: "real-secret",
    });
    listDatabaseTablesMock.mockResolvedValue([{ name: "users" }]);
    createSessionMock.mockResolvedValue("sess_child");
    runSchemaAgentMock.mockResolvedValue({
      success: true,
      data: {
        exploration: {
          schema: [{ name: "id", type: "int", nullable: false }],
        },
      },
    });
    getCurrentRunIndexMock.mockResolvedValue(1);
    cleanupSessionMock.mockResolvedValue(undefined);
  });

  it("复用父会话 dataSourceId，并向探查传入已解析的真实密码", async () => {
    await runBatchPipelineForDatabase("sess_parent", { maxTables: 1 });

    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dbConfig: expect.objectContaining({ password: "real-secret" }),
      }),
      "users",
      expect.objectContaining({ dataSourceId: "ds_parent" })
    );
    expect(runSchemaAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dataSource: expect.objectContaining({
          dbConfig: expect.objectContaining({ password: "real-secret" }),
        }),
      })
    );
    expect(cleanupSessionMock).toHaveBeenCalledWith("sess_child");
  });
});
