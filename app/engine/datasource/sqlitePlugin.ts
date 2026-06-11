import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type {
  DBConnectionConfig,
  ExplorationResult,
  DatabaseTableInfo,
  SQLStep,
  QualityScore,
} from "@contracts/types";
import { metricRegistry } from "../metrics/metricRegistry";
import { ExplorationMetricCollector } from "../metrics/metricSqlBuilder";
import { sqliteDialect } from "../sql/sqliteDialect";
import { runSqlSteps } from "../execution/runSqlSteps";
import { createSqliteExecutor } from "../execution/sqlExecutor";
import type { DataSourcePlugin, ExploreOptions, ExecuteOptions } from "./plugin";
import { registerDataSourcePlugin } from "./plugin";
import {
  sanitizeTableName,
  sanitizeExploreLimit,
  buildColumnIssues,
  buildColumnStat,
  buildColumnInfo,
} from "./dbExploreShared";

/** 打开 SQLite 文件（database 字段为文件路径） */
function openSqliteDatabase(config: DBConnectionConfig): DatabaseSync {
  const filePath = config.database?.trim();
  if (!filePath) {
    throw new Error("SQLite 需要在「数据库名」字段填写 .db 文件路径");
  }
  if (!existsSync(filePath)) {
    throw new Error(`SQLite 文件不存在: ${filePath}`);
  }
  return new DatabaseSync(filePath);
}

/** 在短连接中执行 SQLite 操作 */
async function withSqliteDatabase<T>(
  config: DBConnectionConfig,
  fn: (db: DatabaseSync) => T
): Promise<T> {
  const db = openSqliteDatabase(config);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

async function testSqliteConnection(config: DBConnectionConfig): Promise<void> {
  await withSqliteDatabase(config, (db) => {
    db.prepare("SELECT 1").get();
  });
}

async function listSqliteTables(config: DBConnectionConfig): Promise<DatabaseTableInfo[]> {
  return withSqliteDatabase(config, (db) => {
    const rows = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`
      )
      .all() as { name: string }[];

    return rows.map((row) => {
      const countRow = db
        .prepare(`SELECT COUNT(*) AS cnt FROM ${sqliteDialect.quoteTable(row.name)}`)
        .get() as { cnt: number };
      return {
        name: row.name,
        rowCount: Number(countRow.cnt) || 0,
      };
    });
  });
}

async function exploreSqliteTable(
  config: DBConnectionConfig,
  tableName: string,
  limit: number
): Promise<ExplorationResult> {
  const safeTable = sanitizeTableName(tableName);
  const safeLimit = sanitizeExploreLimit(limit);
  const quotedTable = sqliteDialect.quoteTable(safeTable);

  return withSqliteDatabase(config, (db) => {
    const columns = db.prepare(`PRAGMA table_info(${sqliteDialect.quoteIdentifier(safeTable)})`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>;

    const metricCollector = new ExplorationMetricCollector(
      sqliteDialect,
      safeTable,
      (metricId, column) => metricRegistry.resolve(metricId, { column, table: safeTable })
    );

    const countRow = db.prepare(metricCollector.buildCountSql("row_count")).get() as { cnt: number };
    const totalRows = Number(countRow.cnt) || 0;

    const sampleRows = db.prepare(`SELECT * FROM ${quotedTable} LIMIT ${safeLimit}`).all() as Record<
      string,
      unknown
    >[];

    const columnStats = [];
    const schemaInfo = [];
    const issues = [];

    for (const col of columns) {
      const columnName = col.name;
      schemaInfo.push(
        buildColumnInfo(columnName, col.type || "TEXT", col.notnull === 0, col.dflt_value ?? undefined)
      );

      const nullRow = db.prepare(metricCollector.buildCountSql("null_count", columnName)).get() as {
        cnt: number;
      };
      const nullCount = Number(nullRow.cnt) || 0;

      const uniqueRow = db.prepare(metricCollector.buildCountSql("distinct_count", columnName)).get() as {
        cnt: number;
      };
      const uniqueCount = Number(uniqueRow.cnt) || 0;

      const quotedCol = sqliteDialect.quoteIdentifier(columnName);
      const sampleValues = (
        db
          .prepare(
            `SELECT DISTINCT ${quotedCol} AS val FROM ${quotedTable} WHERE ${quotedCol} IS NOT NULL LIMIT 5`
          )
          .all() as { val: string | number | null }[]
      ).map((r) => r.val);

      columnStats.push(
        buildColumnStat(columnName, col.type || "TEXT", totalRows, nullCount, uniqueCount, sampleValues)
      );
      issues.push(...buildColumnIssues(columnName, col.type || "TEXT", totalRows, nullCount, uniqueCount));
    }

    return {
      sourceType: "sqlite",
      sourceName: `${config.database}.${safeTable}`,
      totalRows,
      totalCols: columns.length,
      schema: schemaInfo,
      sampleData: sampleRows.slice(0, 10),
      columnStats,
      sampleSize: Math.min(safeLimit, totalRows),
      issues,
    };
  });
}

/** SQLite 数据源插件：基于 Node.js 内置 node:sqlite */
export const sqliteDataSourcePlugin: DataSourcePlugin = {
  type: "sqlite",
  supportedActions: [
    "fill_null",
    "dedup",
    "format",
    "truncate",
    "convert_type",
    "standardize",
    "split",
    "merge",
    "remove",
  ],

  async testConnection(config: DBConnectionConfig): Promise<void> {
    await testSqliteConnection(config);
  },

  async listTables(config: DBConnectionConfig) {
    return listSqliteTables(config);
  },

  async explore(config: DBConnectionConfig, options: ExploreOptions) {
    if (!options.tableName) {
      throw new Error("SQLite 探查需要 tableName");
    }
    return exploreSqliteTable(config, options.tableName, options.limit ?? 100);
  },

  async execute(config: DBConnectionConfig, options: ExecuteOptions) {
    const db = openSqliteDatabase(config);
    const metricsBefore: QualityScore = {
      overall: 70,
      completeness: 70,
      uniqueness: 80,
      consistency: 75,
      validity: 70,
      accuracy: 70,
    };

    const step: SQLStep = {
      stepNumber: 0,
      name: "执行 SQL",
      operationType: /^\s*SELECT/i.test(options.sql) ? "SELECT" : "INSERT",
      sql: options.sql,
      affectedRows: 0,
      riskLevel: "medium",
    };

    try {
      return await runSqlSteps({
        sessionId: "sqlite-plugin",
        steps: [step],
        executor: createSqliteExecutor(db),
        dryRun: options.dryRun ?? false,
        metricsBefore,
      });
    } finally {
      db.close();
    }
  },
};

registerDataSourcePlugin(sqliteDataSourcePlugin);
