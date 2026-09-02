import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DBConnectionConfig } from "@contracts/types";

const mysqlMocks = vi.hoisted(() => {
  const execute = vi.fn();
  const ping = vi.fn();
  const end = vi.fn();
  const getConnection = vi.fn(async () => ({
    release: vi.fn(),
  }));
  const createPool = vi.fn(() => ({
    getConnection,
    end,
  }));
  const createConnection = vi.fn(async () => ({
    execute,
    ping,
    end,
  }));
  return { execute, ping, end, getConnection, createPool, createConnection };
});

const pgMocks = vi.hoisted(() => {
  const release = vi.fn();
  const connect = vi.fn(async () => ({ release }));
  const end = vi.fn(async () => undefined);
  const Pool = vi.fn(function MockPgPool(this: { connect: typeof connect; end: typeof end }) {
    this.connect = connect;
    this.end = end;
  });
  return { release, connect, end, Pool };
});

vi.mock("mysql2/promise", () => ({
  default: {
    createConnection: mysqlMocks.createConnection,
    createPool: mysqlMocks.createPool,
  },
}));

vi.mock("pg", () => ({
  default: { Pool: pgMocks.Pool },
}));

vi.mock("../../engine/datasource/postgresPlugin", () => ({}));

import {
  closeConnection,
  createConnectionForDialect,
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

describe("createConnectionForDialect", () => {
  let releaseMysqlConnect!: () => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    await closeConnection("sess_lock");

    const mysqlConnectGate = new Promise<void>((resolve) => {
      releaseMysqlConnect = resolve;
    });

    mysqlMocks.createPool.mockImplementation(function MockMysqlPool() {
      return {
        getConnection: vi.fn(async () => {
          await mysqlConnectGate;
          return { release: vi.fn() };
        }),
        end: vi.fn(async () => undefined),
      };
    });
  });

  it("并发请求不同方言时，等待中的调用方不会拿到错误方言的连接池", async () => {
    const mysqlPromise = createConnectionForDialect("sess_lock", sampleConfig, "mysql");

    const postgresPromise = createConnectionForDialect(
      "sess_lock",
      {
        ...sampleConfig,
        host: "pg-host",
        database: "pgdb",
      },
      "postgresql"
    );

    await Promise.resolve();
    releaseMysqlConnect();

    const [mysqlEntry, postgresEntry] = await Promise.all([mysqlPromise, postgresPromise]);

    expect(mysqlEntry.dialect).toBe("mysql");
    expect(postgresEntry.dialect).toBe("postgresql");
    expect(pgMocks.Pool).toHaveBeenCalled();
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
