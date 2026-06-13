import sql from "mssql";
import type {
  DBConnectionConfig,
  ExplorationResult,
  DatabaseTableInfo,
  SQLStep,
  QualityScore,
} from "@contracts/types";
import { metricRegistry } from "../metrics/metricRegistry";
import { ExplorationMetricCollector } from "../metrics/metricSqlBuilder";
import { sqlserverDialect } from "../sql/sqlserverDialect";
import { runSqlSteps } from "../execution/runSqlSteps";
import { createSqlServerExecutor } from "../execution/sqlExecutor";
import type { DataSourcePlugin, ExploreOptions, ExecuteOptions } from "./plugin";
import { registerDataSourcePlugin } from "./plugin";
import {
  sanitizeTableName,
  sanitizeExploreLimit,
  buildColumnIssues,
  buildColumnStat,
  buildColumnInfo,
} from "./dbExploreShared";
import {
  buildSampleStatsFromClause,
  scaleNullCountFromSample,
  shouldUseApproximateRowCount,
  shouldUseSampleStats,
} from "./dbExploreSampling";

/** 构建 SQL Server 连接配置 */
function buildMssqlConfig(config: DBConnectionConfig): sql.config {
  return {
    server: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    options: {
      encrypt: true,
      trustServerCertificate: true,
    },
    connectionTimeout: 10000,
    requestTimeout: 30000,
    pool: { max: 2, min: 0 },
  };
}

/** 在短连接池中执行 T-SQL 操作 */
async function withMssqlPool<T>(
  config: DBConnectionConfig,
  fn: (pool: sql.ConnectionPool) => Promise<T>
): Promise<T> {
  const pool = await new sql.ConnectionPool(buildMssqlConfig(config)).connect();
  try {
    return await fn(pool);
  } finally {
    await pool.close();
  }
}

async function testSqlServerConnection(config: DBConnectionConfig): Promise<void> {
  await withMssqlPool(config, async (pool) => {
    await pool.request().query("SELECT 1");
  });
}

async function listSqlServerTables(config: DBConnectionConfig): Promise<DatabaseTableInfo[]> {
  return withMssqlPool(config, async (pool) => {
    const schema = config.schema || "dbo";
    const result = await pool
      .request()
      .input("schema", sql.VarChar, schema)
      .query(
        `SELECT t.name AS name,
                COALESCE(CAST(ep.value AS NVARCHAR(500)), '') AS comment,
                COALESCE(SUM(p.rows), 0) AS row_count
         FROM sys.tables t
         INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
         LEFT JOIN sys.extended_properties ep
           ON ep.major_id = t.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
         LEFT JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
         WHERE s.name = @schema
         GROUP BY t.name, ep.value
         ORDER BY t.name`
      );

    return result.recordset.map((row: { name: string; comment?: string; row_count: number }) => ({
      name: String(row.name),
      comment: row.comment ? String(row.comment) : undefined,
      rowCount: Number(row.row_count) || 0,
    }));
  });
}

async function exploreSqlServerTable(
  config: DBConnectionConfig,
  tableName: string,
  limit: number
): Promise<ExplorationResult> {
  const safeTable = sanitizeTableName(tableName);
  const safeLimit = sanitizeExploreLimit(limit);
  const schema = config.schema || "dbo";
  const quotedTable = `${sqlserverDialect.quoteIdentifier(schema)}.${sqlserverDialect.quoteTable(safeTable)}`;

  return withMssqlPool(config, async (pool) => {
    const columnsResult = await pool
      .request()
      .input("schema", sql.VarChar, schema)
      .input("table", sql.VarChar, safeTable)
      .query(
        `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
         FROM information_schema.columns
         WHERE table_schema = @schema AND table_name = @table
         ORDER BY ordinal_position`
      );

    const metricCollector = new ExplorationMetricCollector(
      sqlserverDialect,
      safeTable,
      (metricId, column) => metricRegistry.resolve(metricId, { column, table: safeTable })
    );

    const estimateResult = await pool
      .request()
      .input("schema", sql.VarChar, schema)
      .input("table", sql.VarChar, safeTable)
      .query(
        `SELECT COALESCE(SUM(p.rows), 0) AS row_est
         FROM sys.tables t
         INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
         INNER JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
         WHERE s.name = @schema AND t.name = @table`
      );
    const rowEstimate = Number(estimateResult.recordset[0]?.row_est) || 0;

    let totalRows: number;
    let rowCountApproximate = false;

    if (shouldUseApproximateRowCount(rowEstimate)) {
      totalRows = rowEstimate;
      rowCountApproximate = true;
    } else {
      const countResult = await pool.request().query(metricCollector.buildCountSql("row_count"));
      totalRows = Number(countResult.recordset[0]?.cnt) || 0;
    }

    const useSampleStats = shouldUseSampleStats(totalRows);
    const statsFrom = useSampleStats
      ? buildSampleStatsFromClause("sqlserver", quotedTable, safeLimit)
      : quotedTable;
    const statsRowCount = useSampleStats ? Math.min(safeLimit, totalRows) : totalRows;

    const sampleResult = await pool.request().query(`SELECT TOP ${safeLimit} * FROM ${quotedTable}`);

    const columnStats = [];
    const schemaInfo = [];
    const issues = [];

    for (const col of columnsResult.recordset) {
      const columnName = String(col.column_name);
      schemaInfo.push(
        buildColumnInfo(
          columnName,
          String(col.data_type),
          col.is_nullable === "YES",
          col.column_default ? String(col.column_default) : undefined,
          col.character_maximum_length ? Number(col.character_maximum_length) : undefined
        )
      );

      const quotedCol = sqlserverDialect.quoteIdentifier(columnName);

      const nullResult = await pool.request().query(
        useSampleStats
          ? `SELECT SUM(CASE WHEN ${quotedCol} IS NULL THEN 1 ELSE 0 END) AS cnt FROM ${statsFrom}`
          : metricCollector.buildCountSql("null_count", columnName)
      );
      const sampleNullCount = Number(nullResult.recordset[0]?.cnt) || 0;

      const uniqueResult = await pool.request().query(
        useSampleStats
          ? `SELECT COUNT(DISTINCT ${quotedCol}) AS cnt FROM ${statsFrom}`
          : metricCollector.buildCountSql("distinct_count", columnName)
      );
      const uniqueCount = Number(uniqueResult.recordset[0]?.cnt) || 0;

      const sampleValuesResult = await pool.request().query(
        `SELECT DISTINCT TOP 5 ${quotedCol} AS val FROM ${statsFrom} WHERE ${quotedCol} IS NOT NULL`
      );
      const sampleValues = sampleValuesResult.recordset.map(
        (r: { val: string | number | null }) => r.val as string | number | null
      );

      const nullCount = useSampleStats
        ? scaleNullCountFromSample(sampleNullCount, statsRowCount, totalRows)
        : sampleNullCount;

      columnStats.push(
        buildColumnStat(
          columnName,
          String(col.data_type),
          totalRows,
          nullCount,
          uniqueCount,
          sampleValues
        )
      );
      issues.push(
        ...buildColumnIssues(
          columnName,
          String(col.data_type),
          totalRows,
          nullCount,
          uniqueCount,
          useSampleStats ? { statsRowCount } : undefined
        )
      );
    }

    return {
      sourceType: "sqlserver",
      sourceName: `${config.database}.${schema}.${safeTable}`,
      totalRows,
      totalCols: columnsResult.recordset.length,
      schema: schemaInfo,
      sampleData: sampleResult.recordset.slice(0, 10) as Record<string, unknown>[],
      columnStats,
      sampleSize: Math.min(safeLimit, totalRows),
      issues,
      sampleBasedStats: useSampleStats,
      rowCountApproximate,
    };
  });
}

/** SQL Server 数据源插件：基于 mssql 驱动 */
export const sqlserverDataSourcePlugin: DataSourcePlugin = {
  type: "sqlserver",
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
    await testSqlServerConnection(config);
  },

  async listTables(config: DBConnectionConfig) {
    return listSqlServerTables(config);
  },

  async explore(config: DBConnectionConfig, options: ExploreOptions) {
    if (!options.tableName) {
      throw new Error("SQL Server 探查需要 tableName");
    }
    return exploreSqlServerTable(config, options.tableName, options.limit ?? 100);
  },

  async execute(config: DBConnectionConfig, options: ExecuteOptions) {
    const pool = await new sql.ConnectionPool(buildMssqlConfig(config)).connect();
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
        sessionId: "sqlserver-plugin",
        steps: [step],
        executor: createSqlServerExecutor(pool),
        dryRun: options.dryRun ?? false,
        metricsBefore,
      });
    } finally {
      await pool.close();
    }
  },
};

registerDataSourcePlugin(sqlserverDataSourcePlugin);
