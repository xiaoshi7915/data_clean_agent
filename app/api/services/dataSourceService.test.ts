import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DBConnectionConfig } from "@contracts/types";

const mysqlMocks = vi.hoisted(() => {
  const execute = vi.fn();
  const ping = vi.fn();
  const end = vi.fn();
  const createConnection = vi.fn(async () => ({
    execute,
    ping,
    end,
  }));
  return { execute, ping, end, createConnection };
});

vi.mock("mysql2/promise", () => ({
  default: {
    createConnection: mysqlMocks.createConnection,
    createPool: vi.fn(),
  },
}));

vi.mock("../../engine/datasource/postgresPlugin", () => ({}));

import { listDatabaseTables, testDatabaseConnection } from "./dataSourceService";
import "../../engine/datasource/mysqlPlugin";

const sampleConfig: DBConnectionConfig = {
  host: "127.0.0.1",
  port: 3306,
  database: "demo",
  username: "user",
  password: "pass",
};

describe("dataSourceService mysql plugin dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mysqlMocks.execute.mockResolvedValue([
      [{ name: "users", comment: "用户", rowCount: 10 }],
    ]);
    mysqlMocks.ping.mockResolvedValue(undefined);
    mysqlMocks.end.mockResolvedValue(undefined);
  });

  it("listDatabaseTables(mysql) 不应因插件互相委托而栈溢出", async () => {
    const tables = await listDatabaseTables(sampleConfig, "mysql");

    expect(tables).toEqual([{ name: "users", comment: "用户", rowCount: 10 }]);
    expect(mysqlMocks.createConnection).toHaveBeenCalledTimes(1);
  });

  it("testDatabaseConnection(mysql) 经插件委托时不应无限递归", async () => {
    await expect(testDatabaseConnection(sampleConfig, "mysql")).resolves.toBeUndefined();
    expect(mysqlMocks.createConnection).toHaveBeenCalledTimes(1);
    expect(mysqlMocks.ping).toHaveBeenCalledTimes(1);
  });
});
