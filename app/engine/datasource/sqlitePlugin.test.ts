import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DBConnectionConfig } from "@contracts/types";

const sqliteMocks = vi.hoisted(() => {
  const get = vi.fn();
  const all = vi.fn();
  const prepare = vi.fn(() => ({ get, all }));
  const close = vi.fn();
  const DatabaseSync = vi.fn(function DatabaseSync(this: { prepare: typeof prepare; close: typeof close }, path: string) {
    this.prepare = prepare;
    this.close = close;
    return this;
  });
  return { get, all, prepare, close, DatabaseSync };
});

vi.mock("node:sqlite", () => ({
  DatabaseSync: sqliteMocks.DatabaseSync,
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
}));

import { getDataSourcePlugin } from "../../engine/datasource/plugin";
import "../../engine/datasource/sqlitePlugin";

const sampleConfig: DBConnectionConfig = {
  host: "local",
  port: 0,
  database: "/tmp/test.db",
  username: "",
  password: "",
};

describe("sqliteDataSourcePlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqliteMocks.get.mockReturnValue({ cnt: 5 });
    sqliteMocks.all.mockReturnValue([{ name: "users" }]);
  });

  it("testConnection 打开文件并 SELECT 1", async () => {
    const plugin = getDataSourcePlugin("sqlite");
    await expect(plugin?.testConnection(sampleConfig)).resolves.toBeUndefined();
    expect(sqliteMocks.DatabaseSync).toHaveBeenCalledWith("/tmp/test.db");
    expect(sqliteMocks.prepare).toHaveBeenCalledWith("SELECT 1");
  });

  it("listTables 查询 sqlite_master", async () => {
    sqliteMocks.all
      .mockReturnValueOnce([{ name: "users" }])
      .mockReturnValueOnce(undefined);
    sqliteMocks.get.mockReturnValue({ cnt: 10 });

    const plugin = getDataSourcePlugin("sqlite");
    const tables = await plugin?.listTables?.(sampleConfig);

    expect(tables).toEqual([{ name: "users", rowCount: 10 }]);
    expect(sqliteMocks.prepare).toHaveBeenCalledWith(expect.stringContaining("sqlite_master"));
  });
});
