import pg from "pg";
import type {
  DBConnectionConfig,
  ExplorationResult,
  ColumnInfo,
  ColumnStats,
  DetectedIssue,
  DatabaseTableInfo,
  SQLStep,
  QualityScore,
} from "@contracts/types";
import { metricRegistry } from "../metrics/metricRegistry";
import { ExplorationMetricCollector } from "../metrics/metricSqlBuilder";
import { postgresDialect } from "../sql/postgresDialect";
import { runSqlSteps } from "../execution/runSqlSteps";
import { createPostgresExecutor } from "../execution/sqlExecutor";
import type { DataSourcePlugin, ExploreOptions, ExecuteOptions } from "./plugin";
import { registerDataSourcePlugin } from "./plugin";
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

const { Pool } = pg;

function sanitizeTableName(name: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(`无效的表名: ${name}`);
  }
  return name;
}

function sanitizeLimit(limit: number): number {
  const value = Math.floor(Number(limit) || 100);
  return Math.max(1, Math.min(value, 100));
}

function isIdLikeColumn(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === "id" ||
    lower.endsWith("_id") ||
    lower.endsWith("_pk") ||
    lower.includes("uuid") ||
    lower.includes("guid")
  );
}

async function withClient<T>(
  config: DBConnectionConfig,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    connectionTimeoutMillis: 10000,
    max: 2,
  });
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
    await pool.end();
  }
}

async function testPostgresConnection(config: DBConnectionConfig): Promise<void> {
  await withClient(config, async (client) => {
    await client.query("SELECT 1");
  });
}

async function listPostgresTables(config: DBConnectionConfig): Promise<DatabaseTableInfo[]> {
  return withClient(config, async (client) => {
    const schema = config.schema || "public";
    const result = await client.query(
      `SELECT c.relname AS name,
              COALESCE(obj_description(c.oid), '') AS comment,
              COALESCE(c.reltuples::bigint, 0) AS row_count
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relkind = 'r'
       ORDER BY c.relname`,
      [schema]
    );
    return result.rows.map((row) => ({
      name: String(row.name),
      comment: row.comment ? String(row.comment) : undefined,
      rowCount: Number(row.row_count) || 0,
    }));
  });
}

async function pgTimedQuery<T>(
  client: pg.PoolClient,
  sql: string,
  params?: unknown[]
): Promise<T> {
  return withExploreQueryTimeout(async () => {
    const result = await client.query(sql, params);
    return result.rows as T;
  });
}

async function explorePostgresTable(
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
  const safeTable = sanitizeTableName(tableName);
  const safeLimit = sanitizeLimit(limit);
  const schema = config.schema || "public";
  const quotedTable = postgresDialect.quoteTable(safeTable);
  const report = options?.onProgress;

  return withClient(config, async (client) => {
    try {
      report?.("connecting", "正在连接 PostgreSQL…");
      report?.("loading_schema", "正在读取表结构…");
      const columnsResult = await pgTimedQuery<
        Array<{
          column_name: string;
          data_type: string;
          is_nullable: string;
          column_default: string | null;
          character_maximum_length: number | null;
        }>
      >(
        client,
      `SELECT column_name, data_type, is_nullable, column_default,
              character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [schema, safeTable]
      );

    const metricCollector = new ExplorationMetricCollector(
      postgresDialect,
      safeTable,
      (metricId, column) => metricRegistry.resolve(metricId, { column, table: safeTable })
    );

    report?.("counting_rows", "正在统计行数…");
    const estimateRows = await pgTimedQuery<{ est: number }[]>(
      client,
      `SELECT COALESCE(c.reltuples::bigint, 0) AS est
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = 'r'`,
      [schema, safeTable]
    );
    const rowEstimate = Number(estimateRows[0]?.est) || 0;

    let totalRows: number;
    let rowCountApproximate = false;

    const skipExactCount =
      shouldUseApproximateRowCount(rowEstimate) && !options?.exactRowCount;

    if (skipExactCount) {
      totalRows = rowEstimate;
      rowCountApproximate = true;
    } else {
      const countRows = await pgTimedQuery<{ cnt: number }[]>(
        client,
        metricCollector.buildCountSql("row_count")
      );
      totalRows = Number(countRows[0]?.cnt) || 0;
    }

    const useSampleStats = shouldUseSampleStats(totalRows);
    const statsFrom = useSampleStats
      ? buildSampleStatsFromClause("postgresql", quotedTable, safeLimit)
      : quotedTable;
    const statsRowCount = useSampleStats ? Math.min(safeLimit, totalRows) : totalRows;

    report?.("sampling", `正在抽取样本（最多 ${safeLimit} 行）…`);
    const sampleRows = await pgTimedQuery<Record<string, unknown>[]>(
      client,
      `SELECT * FROM ${quotedTable} LIMIT ${safeLimit}`
    );

    const schemaInfo: ColumnInfo[] = columnsResult.map((col) => ({
      name: String(col.column_name),
      type: String(col.data_type),
      nullable: col.is_nullable === "YES",
      defaultValue: col.column_default ? String(col.column_default) : undefined,
      maxLength: col.character_maximum_length
        ? Number(col.character_maximum_length)
        : undefined,
    }));

    const columnTotal = columnsResult.length;
    const concurrency = useSampleStats ? 1 : EXPLORE_COLUMN_STATS_CONCURRENCY;

    const columnStats = await mapWithConcurrency(
      columnsResult,
      concurrency,
      async (col, index) => {
        const columnName = String(col.column_name);
        report?.(
          "column_stats",
          `列统计 ${index + 1}/${columnTotal}：${columnName}`,
          { columnIndex: index + 1, columnTotal }
        );

        const quotedCol = postgresDialect.quoteIdentifier(columnName);
        const nullRows = await pgTimedQuery<{ cnt: number }[]>(
          client,
          useSampleStats
            ? `SELECT SUM(CASE WHEN ${quotedCol} IS NULL THEN 1 ELSE 0 END) AS cnt FROM ${statsFrom}`
            : metricCollector.buildCountSql("null_count", columnName)
        );
        const sampleNullCount = Number(nullRows[0]?.cnt) || 0;

        const uniqueRows = await pgTimedQuery<{ cnt: number }[]>(
          client,
          useSampleStats
            ? `SELECT COUNT(DISTINCT ${quotedCol}) AS cnt FROM ${statsFrom}`
            : metricCollector.buildCountSql("distinct_count", columnName)
        );
        const uniqueCount = Number(uniqueRows[0]?.cnt) || 0;

        const sampleValuesRows = await pgTimedQuery<{ val: string | number | null }[]>(
          client,
          `SELECT DISTINCT ${quotedCol} AS val FROM ${statsFrom} WHERE ${quotedCol} IS NOT NULL LIMIT 5`
        );
        const sampleValues = sampleValuesRows.map((r) => r.val);

        const nullRate =
          statsRowCount > 0 ? Math.round((sampleNullCount / statsRowCount) * 10000) / 100 : 0;
        const nullCount = useSampleStats
          ? scaleNullCountFromSample(sampleNullCount, statsRowCount, totalRows)
          : sampleNullCount;

        return {
          columnName,
          dataType: String(col.data_type),
          nullRate,
          nullCount,
          uniqueCount,
          sampleValues,
        } satisfies ColumnStats;
      }
    );

    const issues: DetectedIssue[] = [];
    for (const stat of columnStats) {
      if (stat.nullRate > 5) {
        issues.push({
          id: `issue_null_${stat.columnName}`,
          column: stat.columnName,
          issueType: "空值过多",
          severity: stat.nullRate > 30 ? "high" : "medium",
          affectedRows: stat.nullCount,
          affectedPercent: parseFloat(stat.nullRate.toFixed(2)),
          description: `列 "${stat.columnName}" 空值率为 ${stat.nullRate}%`,
          suggestion:
            stat.nullRate > 50 ? "建议删除该列或使用默认值填充" : "建议使用合适的值填充空值",
        });
      }

      if (
        isIdLikeColumn(stat.columnName) &&
        stat.uniqueCount < totalRows &&
        stat.nullCount === 0
      ) {
        const dupCount = totalRows - stat.uniqueCount;
        issues.push({
          id: `issue_dup_${stat.columnName}`,
          column: stat.columnName,
          issueType: "唯一键重复",
          severity: dupCount > totalRows * 0.01 ? "high" : "medium",
          affectedRows: dupCount,
          affectedPercent: parseFloat(((dupCount / totalRows) * 100).toFixed(2)),
          description: `唯一标识列 "${stat.columnName}" 存在 ${dupCount} 个重复值`,
          suggestion: "建议检查主键/唯一约束或处理重复 ID",
        });
      }
    }

    return {
      sourceType: "postgresql",
      sourceName: `${config.database}.${safeTable}`,
      totalRows,
      totalCols: columnsResult.length,
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

/** PostgreSQL 数据源插件：连接测试、表列表、探查（行数经 MetricRegistry） */
export const postgresDataSourcePlugin: DataSourcePlugin = {
  type: "postgresql",
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
    await testPostgresConnection(config);
  },

  async listTables(config: DBConnectionConfig) {
    return listPostgresTables(config);
  },

  async explore(config: DBConnectionConfig, options: ExploreOptions) {
    if (!options.tableName) {
      throw new Error("PostgreSQL 探查需要 tableName");
    }
    return explorePostgresTable(config, options.tableName, options.limit ?? 100, {
      exactRowCount: options.exactRowCount,
      onProgress: options.onProgress,
    });
  },

  async execute(config: DBConnectionConfig, options: ExecuteOptions) {
    const pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      connectionTimeoutMillis: 10000,
      max: 2,
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
        sessionId: "postgres-plugin",
        steps: [step],
        executor: createPostgresExecutor(pool),
        dryRun: options.dryRun ?? false,
        metricsBefore,
      });
    } finally {
      await pool.end();
    }
  },
};

registerDataSourcePlugin(postgresDataSourcePlugin);
