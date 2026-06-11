import { describe, expect, it, vi, beforeEach } from "vitest";
import { MASKED_PASSWORD } from "../lib/dataSourceSanitizer";

const mockGetDataSourceById = vi.fn();

vi.mock("../services/dataSourceStoreService", () => ({
  listSavedDataSources: vi.fn().mockResolvedValue([]),
  getDataSourceById: (...args: unknown[]) => mockGetDataSourceById(...args),
  updateDataSource: vi.fn(),
  upsertDataSource: vi.fn(),
}));

vi.mock("../services/sessionService", () => ({
  createSession: vi.fn(),
  getSession: vi.fn(),
  getFullSession: vi.fn(),
  updateSessionPhase: vi.fn(),
  updateSessionTitle: vi.fn(),
  updateSessionTargetTable: vi.fn(),
  addMessage: vi.fn(),
  listSessions: vi.fn(),
  listSessionsByDataSource: vi.fn(),
  deleteSession: vi.fn(),
}));

import { sessionRouter } from "./sessionRouter";

describe("sessionRouter.getDataSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("不向客户端返回明文密码", async () => {
    mockGetDataSourceById.mockResolvedValue({
      type: "mysql",
      name: "prod",
      dbConfig: {
        host: "127.0.0.1",
        port: 3306,
        database: "db",
        username: "root",
        password: "admin123456!!",
      },
    });

    const caller = sessionRouter.createCaller({
      req: new Request("http://localhost/api/trpc"),
      resHeaders: new Headers(),
    });
    const result = await caller.getDataSource({ dataSourceId: "ds_1" });

    expect(result.found).toBe(true);
    expect(result.config?.dbConfig?.password).toBe(MASKED_PASSWORD);
    expect(result.config?.dbConfig?.password).not.toBe("admin123456!!");
  });
});
