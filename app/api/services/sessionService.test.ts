import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getSession,
  updateSessionPhase,
  updateSessionTitle,
  incrementRetryCount,
} from "./sessionService";
import { MASKED_PASSWORD } from "../lib/dataSourceSanitizer";
import { getDataSourceById } from "./dataSourceStoreService";

const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockInsert = vi.fn();
const mockDelete = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockOrderBy = vi.fn();
const mockSet = vi.fn();

vi.mock("../queries/connection", () => ({
  getDb: () => ({
    select: mockSelect,
    update: mockUpdate,
    insert: mockInsert,
    delete: mockDelete,
  }),
}));

vi.mock("./dataSourceService", () => ({
  cleanupSession: vi.fn(),
}));

vi.mock("./dataSourceStoreService", () => ({
  getDataSourceById: vi.fn().mockResolvedValue(null),
  upsertDataSource: vi.fn().mockResolvedValue("ds_1"),
  findDataSourceByConnection: vi.fn().mockResolvedValue(null),
}));

const mockedGetDataSourceById = vi.mocked(getDataSourceById);

function chainTerminal(rows: unknown[]) {
  mockLimit.mockReturnValue(Promise.resolve(rows));
  mockOrderBy.mockReturnValue({ limit: mockLimit });
  mockWhere.mockReturnValue({ limit: mockLimit, orderBy: mockOrderBy });
  mockFrom.mockReturnValue({ where: mockWhere, orderBy: mockOrderBy });
  mockSelect.mockReturnValue({ from: mockFrom });
}

describe("sessionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  it("getSession 会话不存在返回 null", async () => {
    chainTerminal([]);
    const session = await getSession("sess_missing");
    expect(session).toBeNull();
  });

  it("getSession 返回基础会话字段", async () => {
    const now = new Date();
    chainTerminal([
      {
        sessionId: "sess_1",
        currentPhase: "explore",
        dataSourceId: "ds_1",
        dataSourceType: "mysql",
        dataSourceName: "mydb",
        targetTable: "users",
        dbHost: "localhost",
        dbPort: 3306,
        dbDatabase: "mydb",
        dbSchema: null,
        fileName: null,
        fileType: null,
        filePath: null,
        retryCount: 0,
        lastAction: "created",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    mockOrderBy.mockReturnValue(Promise.resolve([]));
    mockedGetDataSourceById.mockResolvedValue({
      type: "mysql",
      name: "mydb",
      dbConfig: {
        host: "localhost",
        port: 3306,
        database: "mydb",
        username: "root",
        password: "secret-pass",
      },
    });

    const session = await getSession("sess_1");
    expect(session?.sessionId).toBe("sess_1");
    expect(session?.currentPhase).toBe("explore");
    expect(session?.targetTable).toBe("users");
    expect(session?.dataSource?.dbConfig?.password).toBe(MASKED_PASSWORD);
    expect(session?.dataSource?.dbConfig?.password).not.toBe("secret-pass");
  });

  it("updateSessionPhase 调用 update", async () => {
    await updateSessionPhase("sess_1", "analyze", "analyzed");
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ currentPhase: "analyze", lastAction: "analyzed" })
    );
  });

  it("updateSessionTitle 更新标题", async () => {
    await updateSessionTitle("sess_1", "新标题");
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ sessionTitle: "新标题" }));
  });

  it("incrementRetryCount 递增并返回新值", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: 2 }]),
      }),
    });
    const next = await incrementRetryCount("sess_1");
    expect(next).toBe(3);
  });
});
