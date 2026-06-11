import mysql from "mysql2/promise";
import pg from "pg";
import type { DatabaseSync } from "node:sqlite";
import sql from "mssql";
import oracledb from "oracledb";

/** SQL 单步执行结果 */
export interface SqlExecuteResult {
  affectedRows: number;
  rows?: unknown[];
}

/** 方言无关的 SQL 执行器，供 runSqlSteps 复用 */
export interface SqlExecutor {
  execute(sql: string): Promise<SqlExecuteResult>;
}

/** 基于 mysql2 连接池的执行器 */
export function createMysqlExecutor(pool: mysql.Pool): SqlExecutor {
  return {
    async execute(sql: string): Promise<SqlExecuteResult> {
      const [result] = await pool.execute(sql);
      let affectedRows = 0;
      if (result && typeof result === "object") {
        affectedRows = (result as mysql.OkPacket).affectedRows || 0;
        if (Array.isArray(result)) {
          affectedRows = result.length;
        }
      }
      return {
        affectedRows,
        rows: Array.isArray(result) ? (result as unknown[]) : undefined,
      };
    },
  };
}

/** 基于 node-pg 连接池的执行器 */
export function createPostgresExecutor(pool: pg.Pool): SqlExecutor {
  return {
    async execute(sql: string): Promise<SqlExecuteResult> {
      const result = await pool.query(sql);
      return {
        affectedRows: result.rowCount ?? 0,
        rows: result.rows,
      };
    },
  };
}

/** 基于 Node.js 内置 node:sqlite 的执行器 */
export function createSqliteExecutor(db: DatabaseSync): SqlExecutor {
  return {
    async execute(sqlText: string): Promise<SqlExecuteResult> {
      const trimmed = sqlText.trim();
      const isQuery = /^\s*(SELECT|WITH|PRAGMA|EXPLAIN)/i.test(trimmed);
      if (isQuery) {
        const rows = db.prepare(trimmed).all() as unknown[];
        return { affectedRows: rows.length, rows };
      }
      const info = db.prepare(trimmed).run();
      return { affectedRows: Number(info.changes ?? 0) };
    },
  };
}

/** 基于 mssql 连接池的执行器 */
export function createSqlServerExecutor(pool: sql.ConnectionPool): SqlExecutor {
  return {
    async execute(sqlText: string): Promise<SqlExecuteResult> {
      const result = await pool.request().query(sqlText);
      return {
        affectedRows: result.rowsAffected?.[0] ?? 0,
        rows: result.recordset,
      };
    },
  };
}

/** 基于 oracledb 连接池的执行器 */
export function createOracleExecutor(pool: oracledb.Pool): SqlExecutor {
  return {
    async execute(sqlText: string): Promise<SqlExecuteResult> {
      const connection = await pool.getConnection();
      try {
        const result = await connection.execute(sqlText, [], { autoCommit: true });
        return {
          affectedRows: result.rowsAffected ?? 0,
          rows: result.rows as unknown[] | undefined,
        };
      } finally {
        await connection.close();
      }
    },
  };
}
