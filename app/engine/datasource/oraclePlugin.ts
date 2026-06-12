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
import {
  buildSampleStatsFromClause,
  scaleNullCountFromSample,
  shouldUseApproximateRowCount,
  shouldUseSampleStats,
} from "./dbExploreSampling";
import {
  EXPLORE_COLUMN_STATS_CONCURRENCY,
  mapWithConcurrency,
} from "./exploreColumnStats";
import {
  mapExploreQueryError,
  withExploreQueryTimeout,
} from "../../api/lib/exploreQueryTimeout";
import type { ExploreProgressStep } from "../../api/services/exploreProgressService";

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

async function oracleTimedExecute<T>(
  connection: oracledb.Connection,
  sql: string,
  binds?: oracledb.BindParameters
): Promise<T> {
  return withExploreQueryTimeout(async () => {
    const result =
      binds != null
        ? await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT })
        : await connection.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return (result.rows ?? []) as T;
  });
}

async function exploreOracleTable(
  config: DBConnectionConfig,
  tableName: string,
  limit: number,
  options?: {
    exactRowCount?: boolean;
    onProgress?: (
      step: ExploreProgressStep,
      message: string,
      meta?: { columnIndex?: number; columnTotal?: number }
    ) => void;
  }
): Promise<ExplorationResult> {
  const safeTable = sanitizeTableName(tableName).toUpperCase();
  const safeLimit = sanitizeExploreLimit(limit);
  const owner = (config.schema || config.username).toUpperCase();
  const quotedTable = `${oracleDialect.quoteIdentifier(owner)}.${oracleDialect.quoteTable(safeTable)}`;

  const report = options?.onProgress;

  return withOracleConnection(config, async (connection) => {
    try {
      report?.("connecting", "正在连接 Oracle…");
      report?.("loading_schema", "正在读取表结构…");
      const columnsRows = await oracleTimedExecute<{
        COLUMN_NAME: string;
        DATA_TYPE: string;
        NULLABLE: string;
        DATA_DEFAULT: string | null;
        DATA_LENGTH: number | null;
      }[]>(
        connection,
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

      report?.("counting_rows", "正在统计行数…");
      const estimateRows = await oracleTimedExecute<{ ROW_EST: number }[]>(
        connection,
        `SELECT NVL(num_rows, 0) AS row_est FROM all_tables WHERE owner = :owner AND table_name = :tableName`,
        { owner, tableName: safeTable }
      );
      const rowEstimate = Number(estimateRows[0]?.ROW_EST) || 0;

      let totalRows: number;
      let rowCountApproximate = false;

      const skipExactCount =
        shouldUseApproximateRowCount(rowEstimate) && !options?.exactRowCount;

      if (skipExactCount) {
        totalRows = rowEstimate;
        rowCountApproximate = true;
      } else {
        const countRows = await oracleTimedExecute<{ CNT: number }[]>(
          connection,
          metricCollector.buildCountSql("row_count")
        );
        totalRows = Number(countRows[0]?.CNT) || 0;
      }

      const useSampleStats = shouldUseSampleStats(totalRows);
      const statsFrom = useSampleStats
        ? buildSampleStatsFromClause("oracle", quotedTable, safeLimit)
        : quotedTable;
      const statsRowCount = useSampleStats ? Math.min(safeLimit, totalRows) : totalRows;

      report?.("sampling", `正在抽取样本（最多 ${safeLimit} 行）…`);
      const sampleRows = await oracleTimedExecute<Record<string, unknown>[]>(
        connection,
        `SELECT * FROM ${quotedTable} FETCH FIRST ${safeLimit} ROWS ONLY`
      );

      const schemaInfo = columnsRows.map((col) =>
        buildColumnInfo(
          String(col.COLUMN_NAME),
          String(col.DATA_TYPE),
          col.NULLABLE === "Y",
          col.DATA_DEFAULT ? String(col.DATA_DEFAULT) : undefined,
          col.DATA_LENGTH ? Number(col.DATA_LENGTH) : undefined
        )
      );

      const columnTotal = columnsRows.length;
      const concurrency = useSampleStats ? 1 : EXPLORE_COLUMN_STATS_CONCURRENCY;

      const columnStats = await mapWithConcurrency(
        columnsRows,
        concurrency,
        async (col, index) => {
          const columnName = String(col.COLUMN_NAME);
          report?.(
            "column_stats",
            `列统计 ${index + 1}/${columnTotal}：${columnName}`,
            { columnIndex: index + 1, columnTotal }
          );

          const quotedCol = oracleDialect.quoteIdentifier(columnName);

          const nullRows = await oracleTimedExecute<{ CNT: number }[]>(
            connection,
            useSampleStats
              ? `SELECT SUM(CASE WHEN ${quotedCol} IS NULL THEN 1 ELSE 0 END) AS cnt FROM ${statsFrom}`
              : metricCollector.buildCountSql("null_count", columnName)
          );
          const sampleNullCount = Number(nullRows[0]?.CNT) || 0;

          const uniqueRows = await oracleTimedExecute<{ CNT: number }[]>(
            connection,
            useSampleStats
              ? `SELECT COUNT(DISTINCT ${quotedCol}) AS cnt FROM ${statsFrom}`
              : metricCollector.buildCountSql("distinct_count", columnName)
          );
          const uniqueCount = Number(uniqueRows[0]?.CNT) || 0;

          const sampleValuesRows = await oracleTimedExecute<{ VAL: string | number | null }[]>(
            connection,
            `SELECT DISTINCT ${quotedCol} AS val FROM ${statsFrom}
             WHERE ${quotedCol} IS NOT NULL FETCH FIRST 5 ROWS ONLY`
          );
          const sampleValues = sampleValuesRows.map((r) => r.VAL);

          const nullCount = useSampleStats
            ? scaleNullCountFromSample(sampleNullCount, statsRowCount, totalRows)
            : sampleNullCount;

          return buildColumnStat(
            columnName,
            String(col.DATA_TYPE),
            totalRows,
            nullCount,
            uniqueCount,
            sampleValues
          );
        }
      );

      const issues = columnStats.flatMap((stat) =>
        buildColumnIssues(
          stat.columnName,
          stat.dataType,
          totalRows,
          stat.nullCount ?? 0,
          stat.uniqueCount
        )
      );

      return {
        sourceType: "oracle",
        sourceName: `${owner}.${safeTable}`,
        totalRows,
        totalCols: columnsRows.length,
        schema: schemaInfo,
        sampleData: sampleRows.slice(0, 10),
        columnStats,
        sampleSize: Math.min(safeLimit, totalRows),
        issues,
        sampleBasedStats: useSampleStats,
        rowCountApproximate,
      };
    } catch (error) {
      throw mapExploreQueryError(error);
    }
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
    return exploreOracleTable(config, options.tableName, options.limit ?? 100, {
      exactRowCount: options.exactRowCount,
      onProgress: options.onProgress,
    });
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
