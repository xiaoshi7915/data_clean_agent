import oracledb from "oracledb";
import type {
  DBConnectionConfig,
  ExplorationResult,
  DatabaseTableInfo,
  SQLStep,
  QualityScore,
} from "@contracts/types";
import { metricRegistry } from "../metrics/metricRegistry";
import { ExplorationMetricCollector } from "../metrics/metricSqlBuilder";
import { oracleDialect } from "../sql/oracleDialect";
import { runSqlSteps } from "../execution/runSqlSteps";
import { createOracleExecutor } from "../execution/sqlExecutor";
import type { DataSourcePlugin, ExploreOptions, ExecuteOptions } from "./plugin";
import { registerDataSourcePlugin } from "./plugin";
import {
  sanitizeTableName,
  sanitizeExploreLimit,
  buildColumnIssues,
  buildColumnStat,
  buildColumnInfo,
} from "./dbExploreShared";

/** 构建 Oracle 连接串（database 字段为 service name 或 SID） */
function buildOracleConnectString(config: DBConnectionConfig): string {
  return `${config.host}:${config.port}/${config.database}`;
}

/** 在短连接中执行 Oracle 操作（thin 模式，无需 Instant Client） */
async function withOracleConnection<T>(
  config: DBConnectionConfig,
  fn: (connection: oracledb.Connection) => Promise<T>
): Promise<T> {
  const connection = await oracledb.getConnection({
    user: config.username,
    password: config.password,
    connectString: buildOracleConnectString(config),
  });
  try {
    return await fn(connection);
  } finally {
    await connection.close();
  }
}

async function testOracleConnection(config: DBConnectionConfig): Promise<void> {
  await withOracleConnection(config, async (connection) => {
    await connection.execute("SELECT 1 FROM DUAL");
  });
}

async function listOracleTables(config: DBConnectionConfig): Promise<DatabaseTableInfo[]> {
  return withOracleConnection(config, async (connection) => {
    const owner = (config.schema || config.username).toUpperCase();
    const result = await connection.execute<{
      NAME: string;
      COMMENT: string | null;
      ROW_COUNT: number;
    }>(
      `SELECT t.table_name AS name,
              tc.comments AS comment,
              NVL(t.num_rows, 0) AS row_count
       FROM all_tables t
       LEFT JOIN all_tab_comments tc
         ON tc.owner = t.owner AND tc.table_name = t.table_name
       WHERE t.owner = :owner
       ORDER BY t.table_name`,
      { owner }
    );

    return (result.rows ?? []).map((row: { NAME: string; COMMENT: string | null; ROW_COUNT: number }) => ({
      name: String(row.NAME),
      comment: row.COMMENT ? String(row.COMMENT) : undefined,
      rowCount: Number(row.ROW_COUNT) || 0,
    }));
  });
}

async function exploreOracleTable(
  config: DBConnectionConfig,
  tableName: string,
  limit: number
): Promise<ExplorationResult> {
  const safeTable = sanitizeTableName(tableName).toUpperCase();
  const safeLimit = sanitizeExploreLimit(limit);
  const owner = (config.schema || config.username).toUpperCase();
  const quotedTable = `${oracleDialect.quoteIdentifier(owner)}.${oracleDialect.quoteTable(safeTable)}`;

  return withOracleConnection(config, async (connection) => {
    const columnsResult = await connection.execute<{
      COLUMN_NAME: string;
      DATA_TYPE: string;
      NULLABLE: string;
      DATA_DEFAULT: string | null;
      DATA_LENGTH: number | null;
    }>(
      `SELECT column_name, data_type, nullable, data_default, data_length
       FROM all_tab_columns
       WHERE owner = :owner AND table_name = :tableName
       ORDER BY column_id`,
      { owner, tableName: safeTable }
    );

    const metricCollector = new ExplorationMetricCollector(
      oracleDialect,
      safeTable,
      (metricId, column) => metricRegistry.resolve(metricId, { column, table: safeTable })
    );

    const countResult = await connection.execute<{ CNT: number }>(
      metricCollector.buildCountSql("row_count")
    );
    const totalRows = Number(countResult.rows?.[0]?.CNT) || 0;

    const sampleResult = await connection.execute(
      `SELECT * FROM ${quotedTable} FETCH FIRST ${safeLimit} ROWS ONLY`
    );

    const columnStats = [];
    const schemaInfo = [];
    const issues = [];

    for (const col of columnsResult.rows ?? []) {
      const columnName = String(col.COLUMN_NAME);
      schemaInfo.push(
        buildColumnInfo(
          columnName,
          String(col.DATA_TYPE),
          col.NULLABLE === "Y",
          col.DATA_DEFAULT ? String(col.DATA_DEFAULT) : undefined,
          col.DATA_LENGTH ? Number(col.DATA_LENGTH) : undefined
        )
      );

      const nullResult = await connection.execute<{ CNT: number }>(
        metricCollector.buildCountSql("null_count", columnName)
      );
      const nullCount = Number(nullResult.rows?.[0]?.CNT) || 0;

      const uniqueResult = await connection.execute<{ CNT: number }>(
        metricCollector.buildCountSql("distinct_count", columnName)
      );
      const uniqueCount = Number(uniqueResult.rows?.[0]?.CNT) || 0;

      const quotedCol = oracleDialect.quoteIdentifier(columnName);
      const sampleValuesResult = await connection.execute<{ VAL: string | number | null }>(
        `SELECT DISTINCT ${quotedCol} AS val FROM ${quotedTable}
         WHERE ${quotedCol} IS NOT NULL FETCH FIRST 5 ROWS ONLY`
      );
      const sampleValues = (sampleValuesResult.rows ?? []).map(
        (r: { VAL: string | number | null }) => r.VAL
      );

      columnStats.push(
        buildColumnStat(
          columnName,
          String(col.DATA_TYPE),
          totalRows,
          nullCount,
          uniqueCount,
          sampleValues
        )
      );
      issues.push(
        ...buildColumnIssues(columnName, String(col.DATA_TYPE), totalRows, nullCount, uniqueCount)
      );
    }

    return {
      sourceType: "oracle",
      sourceName: `${owner}.${safeTable}`,
      totalRows,
      totalCols: columnsResult.rows?.length ?? 0,
      schema: schemaInfo,
      sampleData: (sampleResult.rows ?? []).slice(0, 10) as Record<string, unknown>[],
      columnStats,
      sampleSize: Math.min(safeLimit, totalRows),
      issues,
    };
  });
}

/** Oracle 数据源插件：基于 oracledb thin 模式 */
export const oracleDataSourcePlugin: DataSourcePlugin = {
  type: "oracle",
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
    await testOracleConnection(config);
  },

  async listTables(config: DBConnectionConfig) {
    return listOracleTables(config);
  },

  async explore(config: DBConnectionConfig, options: ExploreOptions) {
    if (!options.tableName) {
      throw new Error("Oracle 探查需要 tableName");
    }
    return exploreOracleTable(config, options.tableName, options.limit ?? 100);
  },

  async execute(config: DBConnectionConfig, options: ExecuteOptions) {
    const pool = await oracledb.createPool({
      user: config.username,
      password: config.password,
      connectString: buildOracleConnectString(config),
      poolMin: 1,
      poolMax: 2,
    });

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
        sessionId: "oracle-plugin",
        steps: [step],
        executor: createOracleExecutor(pool),
        dryRun: options.dryRun ?? false,
        metricsBefore,
      });
    } finally {
      await pool.close(0);
    }
  },
};

registerDataSourcePlugin(oracleDataSourcePlugin);
