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

import {
  detectFullyDuplicateRowsIssue,
  listDatabaseTables,
  testDatabaseConnection,
} from "./dataSourceService";
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

describe("detectFullyDuplicateRowsIssue", () => {
  it("无重复行时返回 null", () => {
    const rows = [
      { a: "1", b: "x" },
      { a: "2", b: "y" },
    ];
    expect(detectFullyDuplicateRowsIssue(rows, ["a", "b"], 2)).toBeNull();
  });

  it("检测到完全重复行组", () => {
    const rows = [
      { a: "1", b: "x" },
      { a: "1", b: "x" },
      { a: "2", b: "y" },
    ];
    const issue = detectFullyDuplicateRowsIssue(rows, ["a", "b"], 3);
    expect(issue?.issueType).toBe("完全重复行");
    expect(issue?.affectedRows).toBe(1);
  });
});
