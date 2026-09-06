import { beforeEach, describe, expect, it, vi } from "vitest";
import { MASKED_PASSWORD } from "../lib/dataSourceSanitizer";

const mockUpdateSet = vi.fn();
const mockUpdateWhere = vi.fn();
const mockUpdate = vi.fn();
const mockSelectLimit = vi.fn();
const mockSelectWhere = vi.fn();
const mockSelectFrom = vi.fn();
const mockSelect = vi.fn();

vi.mock("../queries/connection", () => ({
  getDb: () => ({
    select: mockSelect,
    update: mockUpdate,
    insert: vi.fn(),
  }),
}));

vi.mock("../lib/credentialCrypto", () => ({
  encryptCredentialForStorage: vi.fn((value: string | null | undefined) => `enc:${value}`),
  decryptCredential: vi.fn((value: string) => value.replace(/^enc:/, "")),
}));

import { upsertDataSource } from "./dataSourceStoreService";

const dbConfig = {
  host: "127.0.0.1",
  port: 3306,
  database: "demo",
  username: "root",
  password: MASKED_PASSWORD,
};

describe("upsertDataSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReturnValue({ set: mockUpdateSet });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdateWhere.mockResolvedValue(undefined);
    mockSelect.mockReturnValue({ from: mockSelectFrom });
    mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
    mockSelectWhere.mockReturnValue({ limit: mockSelectLimit });
  });

  it("更新已存在数据源时保留真实密码，不写入脱敏占位符", async () => {
    mockSelectLimit
      .mockResolvedValueOnce([{ dataSourceId: "ds_existing" }])
      .mockResolvedValueOnce([
        {
          dataSourceId: "ds_existing",
          type: "mysql",
          name: "demo",
          dbHost: "127.0.0.1",
          dbPort: 3306,
          dbDatabase: "demo",
          dbUsername: "root",
          dbPassword: "enc:real-secret",
          dbSchema: null,
          fileName: null,
          fileType: null,
          filePath: null,
        },
      ]);

    const dataSourceId = await upsertDataSource({
      type: "mysql",
      name: "demo",
      dbConfig,
    });

    expect(dataSourceId).toBe("ds_existing");
    expect(mockUpdateSet).toHaveBeenCalledWith({
      name: "demo",
      dbPassword: "enc:real-secret",
      updatedAt: expect.any(Date),
    });
  });
});
