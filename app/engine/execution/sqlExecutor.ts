import mysql from "mysql2/promise";
import pg from "pg";

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
