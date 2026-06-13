import mysql from "mysql2/promise";
import pg from "pg";
import { DatabaseSync } from "node:sqlite";
import sql from "mssql";
import oracledb from "oracledb";
import type { DatabaseDialect } from "@contracts/types";
import {
  createMysqlExecutor,
  createPostgresExecutor,
  createSqliteExecutor,
  createSqlServerExecutor,
  createOracleExecutor,
  type SqlExecutor,
} from "../../engine/execution/sqlExecutor";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  readSync,
  closeSync,
  createReadStream,
} from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { env } from "../lib/env";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { parseStringPromise, Builder } from "xml2js";
import type {
  DBConnectionConfig,
  FileType,
  ExplorationResult,
  ColumnInfo,
  ColumnStats,
  DetectedIssue,
  DatabaseTableInfo,
  DataSourceType,
} from "@contracts/types";
import { metricRegistry } from "../../engine/metrics/metricRegistry";
import { ExplorationMetricCollector } from "../../engine/metrics/metricSqlBuilder";
import { mysqlDialect } from "../../engine/sql/mysqlDialect";
import { getDataSourcePlugin } from "../../engine/datasource/plugin";
import { unsupportedDbMessage } from "@contracts/dataSourceSupport";
import {
  EXPLORE_SAMPLE_LIMIT,
  FILE_EXPLORE_FULL_SCAN_ROW_LIMIT,
} from "@contracts/exploreLimits";
import { resolveExistingUploadPath } from "./uploadPathService";

export { EXPLORE_FULL_SCAN_ROW_LIMIT, EXPLORE_SAMPLE_LIMIT } from "@contracts/exploreLimits";
import {
  buildSampleStatsFromClause,
  scaleNullCountFromSample,
  shouldUseApproximateRowCount,
  shouldUseSampleStats,
} from "../../engine/datasource/dbExploreSampling";
import {
  EXPLORE_COLUMN_STATS_CONCURRENCY,
  mapWithConcurrency,
} from "../../engine/datasource/exploreColumnStats";
import {
  mapExploreQueryError,
  withExploreQueryTimeout,
} from "../lib/exploreQueryTimeout";
import type { ExploreProgressStep } from "./exploreProgressService";
import "../../engine/datasource/mysqlPlugin";
import "../../engine/datasource/postgresPlugin";
import "../../engine/datasource/sqlitePlugin";
import "../../engine/datasource/sqlserverPlugin";
import "../../engine/datasource/oraclePlugin";

// ---- Database Connection Pool (per-session) ----

type SessionDbPool =
  | { dialect: "mysql"; pool: mysql.Pool }
  | { dialect: "postgresql"; pool: pg.Pool }
  | { dialect: "sqlite"; db: DatabaseSync }
  | { dialect: "sqlserver"; pool: sql.ConnectionPool }
  | { dialect: "oracle"; pool: oracledb.Pool };

const connectionPools = new Map<string, SessionDbPool>();

/** 记录各会话连接对应的配置指纹，配置未变时可复用连接池 */
const connectionConfigKeys = new Map<string, string>();

/** 同一会话并发建连时串行化，避免 A 关闭 B 正在使用的池导致 Pool is closed */
const connectionLocks = new Map<string, Promise<SessionDbPool>>();

function buildConfigKey(config: DBConnectionConfig, dialect: DatabaseDialect): string {
  return `${dialect}|${config.host}|${config.port}|${config.database}|${config.username}|${config.password}`;
}

/** 探测会话连接池是否仍可用（已 end 的池会在此返回 false） */
async function isSessionPoolHealthy(entry: SessionDbPool): Promise<boolean> {
  try {
    switch (entry.dialect) {
      case "mysql": {
        const conn = await entry.pool.getConnection();
        conn.release();
        return true;
      }
      case "postgresql": {
        const client = await entry.pool.connect();
        client.release();
        return true;
      }
      case "sqlite": {
        entry.db.prepare("SELECT 1").get();
        return true;
      }
      case "sqlserver": {
        await entry.pool.request().query("SELECT 1");
        return true;
      }
      case "oracle": {
        const connection = await entry.pool.getConnection();
        await connection.close();
        return true;
      }
      default: {
        const _exhaustive: never = entry;
        return Boolean(_exhaustive);
      }
    }
  } catch {
    return false;
  }
}

/** 内部：无条件关闭并重建连接池 */
async function createFreshConnectionForDialect(
  sessionId: string,
  config: DBConnectionConfig,
  dialect: DatabaseDialect = "mysql"
): Promise<SessionDbPool> {
  await closeConnection(sessionId);

  if (dialect === "postgresql") {
    const pool = new pg.Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      connectionTimeoutMillis: 10000,
      max: 5,
    });
    const client = await pool.connect();
    client.release();
    const entry: SessionDbPool = { dialect: "postgresql", pool };
    connectionPools.set(sessionId, entry);
    connectionConfigKeys.set(sessionId, buildConfigKey(config, dialect));
    return entry;
  }

  if (dialect === "sqlite") {
    const filePath = config.database?.trim();
    if (!filePath) {
      throw new Error("SQLite 需要在 database 字段指定 .db 文件路径");
    }
    const db = new DatabaseSync(filePath);
    db.prepare("SELECT 1").get();
    const entry: SessionDbPool = { dialect: "sqlite", db };
    connectionPools.set(sessionId, entry);
    connectionConfigKeys.set(sessionId, buildConfigKey(config, dialect));
    return entry;
  }

  if (dialect === "sqlserver") {
    const pool = await new sql.ConnectionPool({
      server: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      options: { encrypt: true, trustServerCertificate: true },
      connectionTimeout: 10000,
      pool: { max: 5, min: 0 },
    }).connect();
    const entry: SessionDbPool = { dialect: "sqlserver", pool };
    connectionPools.set(sessionId, entry);
    connectionConfigKeys.set(sessionId, buildConfigKey(config, dialect));
    return entry;
  }

  if (dialect === "oracle") {
    const pool = await oracledb.createPool({
      user: config.username,
      password: config.password,
      connectString: `${config.host}:${config.port}/${config.database}`,
      poolMin: 1,
      poolMax: 5,
    });
    const connection = await pool.getConnection();
    await connection.close();
    const entry: SessionDbPool = { dialect: "oracle", pool };
    connectionPools.set(sessionId, entry);
    connectionConfigKeys.set(sessionId, buildConfigKey(config, dialect));
    return entry;
  }

  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    connectTimeout: 10000,
  });

  const conn = await pool.getConnection();
  conn.release();

  const entry: SessionDbPool = { dialect: "mysql", pool };
  connectionPools.set(sessionId, entry);
  connectionConfigKeys.set(sessionId, buildConfigKey(config, dialect));
  return entry;
}

/** 按方言获取或创建会话级连接池（复用健康池，避免探查结束误关池） */
export async function createConnectionForDialect(
  sessionId: string,
  config: DBConnectionConfig,
  dialect: DatabaseDialect = "mysql"
): Promise<SessionDbPool> {
  const configKey = buildConfigKey(config, dialect);
  const existing = connectionPools.get(sessionId);

  if (
    existing &&
    existing.dialect === dialect &&
    connectionConfigKeys.get(sessionId) === configKey &&
    (await isSessionPoolHealthy(existing))
  ) {
    return existing;
  }

  const pending = connectionLocks.get(sessionId);
  if (pending) {
    return pending;
  }

  const createPromise = createFreshConnectionForDialect(sessionId, config, dialect);
  connectionLocks.set(sessionId, createPromise);
  try {
    return await createPromise;
  } finally {
    if (connectionLocks.get(sessionId) === createPromise) {
      connectionLocks.delete(sessionId);
    }
  }
}

/** 创建 MySQL 连接池（兼容旧调用方） */
export async function createConnection(sessionId: string, config: DBConnectionConfig): Promise<mysql.Pool> {
  const entry = await createConnectionForDialect(sessionId, config, "mysql");
  if (entry.dialect !== "mysql") {
    throw new Error("内部错误：期望 MySQL 连接池");
  }
  return entry.pool;
}

/** 将会话连接池包装为 SqlExecutor */
export function createSqlExecutorFromPool(entry: SessionDbPool): SqlExecutor {
  switch (entry.dialect) {
    case "postgresql":
      return createPostgresExecutor(entry.pool);
    case "sqlite":
      return createSqliteExecutor(entry.db);
    case "sqlserver":
      return createSqlServerExecutor(entry.pool);
    case "oracle":
      return createOracleExecutor(entry.pool);
    case "mysql":
      return createMysqlExecutor(entry.pool);
    default: {
      const _exhaustive: never = entry;
      throw new Error(`不支持的方言: ${String(_exhaustive)}`);
    }
  }
}

export async function closeConnection(sessionId: string): Promise<void> {
  const entry = connectionPools.get(sessionId);
  if (!entry) return;

  switch (entry.dialect) {
    case "sqlite":
      entry.db.close();
      break;
    case "sqlserver":
      await entry.pool.close();
      break;
    case "oracle":
      await entry.pool.close(0);
      break;
    case "mysql":
    case "postgresql":
      await entry.pool.end();
      break;
    default: {
      const _exhaustive: never = entry;
      throw new Error(`无法关闭未知连接: ${String(_exhaustive)}`);
    }
  }
  connectionPools.delete(sessionId);
  connectionConfigKeys.delete(sessionId);
}

export function getConnection(sessionId: string): mysql.Pool | undefined {
  const entry = connectionPools.get(sessionId);
  return entry?.dialect === "mysql" ? entry.pool : undefined;
}

export function getConnectionForDialect(sessionId: string): SessionDbPool | undefined {
  return connectionPools.get(sessionId);
}

function sanitizeTableName(name: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(`无效的表名: ${name}`);
  }
  return name;
}

function sanitizeLimit(limit: number): number {
  const value = Math.floor(Number(limit) || EXPLORE_SAMPLE_LIMIT);
  return Math.max(1, Math.min(value, EXPLORE_SAMPLE_LIMIT));
}

function quoteIdentifier(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
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

// ---- Exploration Functions ----

/** MySQL 表列表（供 service 与 mysql 插件共用，避免插件 ↔ service 互相委托） */
export async function listMysqlTables(config: DBConnectionConfig): Promise<DatabaseTableInfo[]> {
  const conn = await mysql.createConnection({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    connectTimeout: 10000,
  });

  try {
    const [rows] = await conn.execute(
      `SELECT TABLE_NAME AS name,
              NULLIF(TRIM(TABLE_COMMENT), '') AS comment,
              COALESCE(TABLE_ROWS, 0) AS rowCount
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`,
      [config.database]
    );
    return (rows as { name: string; comment: string | null; rowCount: number }[]).map((row) => ({
      name: row.name,
      comment: row.comment || undefined,
      rowCount: Number(row.rowCount) || 0,
    }));
  } finally {
    await conn.end();
  }
}

export async function listDatabaseTables(
  config: DBConnectionConfig,
  dbType: DataSourceType | string = "mysql"
): Promise<DatabaseTableInfo[]> {
  if (dbType === "mysql") {
    return listMysqlTables(config);
  }

  const plugin = getDataSourcePlugin(dbType);
  if (plugin?.listTables) {
    return plugin.listTables(config);
  }

  throw new Error(unsupportedDbMessage(String(dbType)));
}

export interface ExploreDatabaseOptions {
  /** 大表是否强制执行精确 COUNT(*) */
  exactRowCount?: boolean;
  onProgress?: (
    step: ExploreProgressStep,
    message: string,
    meta?: { columnIndex?: number; columnTotal?: number }
  ) => void;
}

async function mysqlTimedQuery<T>(
  pool: mysql.Pool,
  sql: string,
  params?: unknown[]
): Promise<T> {
  return withExploreQueryTimeout(async () => {
    const [rows] = await pool.query(sql, params);
    return rows as T;
  });
}

export async function exploreDatabase(
  sessionId: string,
  config: DBConnectionConfig,
  tableName: string,
  limit: number = 100,
  dbType: DataSourceType | string = "mysql",
  options?: ExploreDatabaseOptions
): Promise<ExplorationResult> {
  const plugin = getDataSourcePlugin(dbType);
  if (plugin && dbType !== "mysql") {
    return plugin.explore(config, {
      sessionId,
      tableName,
      limit,
      exactRowCount: options?.exactRowCount,
      onProgress: options?.onProgress,
    });
  }

  const report = options?.onProgress;
  const safeTable = sanitizeTableName(tableName);
  const safeLimit = sanitizeLimit(limit);
  const quotedTable = quoteIdentifier(safeTable);

  try {
    report?.("connecting", "正在连接数据库…");
    const pool = await createConnection(sessionId, config);

    report?.("loading_schema", "正在读取表结构…");
    const columns = await mysqlTimedQuery<
      Array<{
        COLUMN_NAME: string;
        DATA_TYPE: string;
        IS_NULLABLE: string;
        COLUMN_DEFAULT: string | null;
        COLUMN_COMMENT: string | null;
        CHARACTER_MAXIMUM_LENGTH: number | null;
      }>
    >(
      pool,
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT,
              CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [config.database, safeTable]
    );

    const metricCollector = new ExplorationMetricCollector(
      mysqlDialect,
      safeTable,
      (metricId, column) => metricRegistry.resolve(metricId, { column, table: safeTable })
    );

    report?.("counting_rows", "正在统计行数…");
    const tableMetaRows = await mysqlTimedQuery<{ TABLE_ROWS: number }[]>(
      pool,
      `SELECT TABLE_ROWS FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [config.database, safeTable]
    );
    const tableRowsEstimate = Number(tableMetaRows[0]?.TABLE_ROWS) || 0;

    let totalRows: number;
    let rowCountApproximate = false;

    const skipExactCount =
      shouldUseApproximateRowCount(tableRowsEstimate) && !options?.exactRowCount;

    if (skipExactCount) {
      totalRows = tableRowsEstimate;
      rowCountApproximate = true;
    } else {
      const countRows = await mysqlTimedQuery<{ cnt: number }[]>(
        pool,
        metricCollector.buildCountSql("row_count")
      );
      totalRows = countRows[0]?.cnt || 0;
      if (options?.exactRowCount && shouldUseApproximateRowCount(tableRowsEstimate)) {
        rowCountApproximate = false;
      }
    }

    const useSampleStats = shouldUseSampleStats(totalRows);
    const statsFrom = useSampleStats
      ? buildSampleStatsFromClause("mysql", quotedTable, safeLimit)
      : quotedTable;
    const statsRowCount = useSampleStats ? Math.min(safeLimit, totalRows) : totalRows;

    report?.("sampling", `正在抽取样本（最多 ${safeLimit} 行）…`);
    const sampleRows = await mysqlTimedQuery<Record<string, unknown>[]>(
      pool,
      `SELECT * FROM ${quotedTable} LIMIT ${safeLimit}`
    );

    const dbColumns = columns;
    const schema: ColumnInfo[] = dbColumns.map((col) => ({
      name: col.COLUMN_NAME,
      type: col.DATA_TYPE,
      nullable: col.IS_NULLABLE === "YES",
      defaultValue: col.COLUMN_DEFAULT || undefined,
      maxLength: col.CHARACTER_MAXIMUM_LENGTH || undefined,
    }));

    const columnTotal = dbColumns.length;
    const concurrency = useSampleStats ? 1 : EXPLORE_COLUMN_STATS_CONCURRENCY;

    const columnStats = await mapWithConcurrency(
      dbColumns,
      concurrency,
      async (col, index) => {
        report?.(
          "column_stats",
          `列统计 ${index + 1}/${columnTotal}：${col.COLUMN_NAME}`,
          { columnIndex: index + 1, columnTotal }
        );

        const quotedCol = quoteIdentifier(col.COLUMN_NAME);
        const nullResult = await mysqlTimedQuery<{ cnt: number }[]>(
          pool,
          useSampleStats
            ? `SELECT SUM(CASE WHEN ${quotedCol} IS NULL THEN 1 ELSE 0 END) AS cnt FROM ${statsFrom}`
            : metricCollector.buildCountSql("null_count", col.COLUMN_NAME)
        );
        const sampleNullCount = Number(nullResult[0]?.cnt) || 0;

        const uniqueResult = await mysqlTimedQuery<{ cnt: number }[]>(
          pool,
          useSampleStats
            ? `SELECT COUNT(DISTINCT ${quotedCol}) AS cnt FROM ${statsFrom}`
            : metricCollector.buildCountSql("distinct_count", col.COLUMN_NAME)
        );
        const uniqueCount = Number(uniqueResult[0]?.cnt) || 0;

        const sampleResult = await mysqlTimedQuery<{ val: unknown }[]>(
          pool,
          `SELECT DISTINCT ${quotedCol} as val FROM ${statsFrom} WHERE ${quotedCol} IS NOT NULL LIMIT 5`
        );
        const sampleValues = sampleResult.map((r) => r.val as string | number | null);

        const nullRate =
          statsRowCount > 0 ? Math.round((sampleNullCount / statsRowCount) * 10000) / 100 : 0;
        const nullCount = useSampleStats
          ? scaleNullCountFromSample(sampleNullCount, statsRowCount, totalRows)
          : sampleNullCount;

        return {
          columnName: col.COLUMN_NAME,
          dataType: col.DATA_TYPE,
          nullRate,
          nullCount,
          uniqueCount,
          sampleValues,
        } satisfies ColumnStats;
      }
    );

    const issues: DetectedIssue[] = [];
    for (let i = 0; i < columnStats.length; i++) {
      const stat = columnStats[i];
      const colName = stat.columnName;

      if (stat.nullRate > 5) {
        issues.push({
          id: `issue_null_${colName}`,
          column: colName,
          issueType: "空值过多",
          severity: stat.nullRate > 30 ? "high" : "medium",
          affectedRows: stat.nullCount,
          affectedPercent: parseFloat(stat.nullRate.toFixed(2)),
          description: `列 "${colName}" 空值率为 ${stat.nullRate}%`,
          suggestion:
            stat.nullRate > 50 ? "建议删除该列或使用默认值填充" : "建议使用合适的值填充空值",
        });
      }

      if (
        isIdLikeColumn(colName) &&
        stat.uniqueCount < (useSampleStats ? statsRowCount : totalRows) &&
        stat.nullCount === 0
      ) {
        const compareRows = useSampleStats ? statsRowCount : totalRows;
        const dupCountInBasis = compareRows - stat.uniqueCount;
        const dupCount = useSampleStats
          ? scaleNullCountFromSample(dupCountInBasis, statsRowCount, totalRows)
          : dupCountInBasis;
        issues.push({
          id: `issue_dup_${colName}`,
          column: colName,
          issueType: "唯一键重复",
          severity: dupCount > totalRows * 0.01 ? "high" : "medium",
          affectedRows: dupCount,
          affectedPercent: parseFloat(((dupCount / totalRows) * 100).toFixed(2)),
          description: `唯一标识列 "${colName}" 存在 ${dupCount} 个重复值`,
          suggestion: "建议检查主键/唯一约束或处理重复 ID",
        });
      }
    }

    if (!useSampleStats) {
      const allColNames = dbColumns.map((c) => quoteIdentifier(c.COLUMN_NAME)).join(", ");
      const dupResult = await mysqlTimedQuery<{ cnt: number }[]>(
        pool,
        `SELECT COUNT(*) as cnt FROM (
          SELECT ${allColNames}, COUNT(*) as dup_count
          FROM ${quotedTable}
          GROUP BY ${allColNames}
          HAVING COUNT(*) > 1
        ) as duplicates`
      );
      const fullDupCount = dupResult[0]?.cnt || 0;

      if (fullDupCount > 0) {
        issues.push({
          id: "issue_full_dup",
          column: "*",
          issueType: "完全重复行",
          severity: "high",
          affectedRows: fullDupCount,
          affectedPercent: parseFloat(((fullDupCount / totalRows) * 100).toFixed(2)),
          description: `发现 ${fullDupCount} 组完全重复的行`,
          suggestion: "建议删除完全重复的行，保留一条",
        });
      }
    }

    return {
      sourceType: "mysql",
      sourceName: `${config.database}.${safeTable}`,
      totalRows,
      totalCols: dbColumns.length,
      schema,
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
}

// ---- File Parsing ----

export function ensureUploadDir(): void {
  if (!existsSync(env.uploadDir)) {
    mkdirSync(env.uploadDir, { recursive: true });
  }
}

/** 原始文件名 → 带 _cleaned 后缀的输出名，如 数据.xlsx → 数据_cleaned.xlsx */
export function cleanedFileName(originalFileName: string): string {
  const ext = path.extname(originalFileName);
  const base = path.basename(originalFileName, ext);
  return `${base}_cleaned${ext}`;
}

export interface FileLoadOptions {
  /** 最多加载的数据行数（不含表头逻辑由各类 loader 自行处理） */
  maxRows?: number;
}

export interface FileLoadResult {
  rows: Record<string, unknown>[];
  columns: string[];
  jsonExport?: { mode: "array" } | { mode: "object"; key: string; wrapper: Record<string, unknown> };
  xmlExport?: { rootKey: string; containerKey?: string };
  /** 是否因 maxRows 截断 */
  truncated?: boolean;
  estimatedTotalRows?: number;
}

export function getUploadPath(fileName: string): string {
  ensureUploadDir();
  const safeName = path.basename(fileName).replace(/[^\w.\-()\u4e00-\u9fff]/g, "_");
  return path.join(env.uploadDir, `${Date.now()}_${safeName}`);
}

/** MySQL 连接测试（供 service 与 mysql 插件共用） */
export async function testMysqlConnection(config: DBConnectionConfig): Promise<void> {
  const conn = await mysql.createConnection({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    connectTimeout: 10000,
  });
  try {
    await conn.ping();
  } finally {
    await conn.end();
  }
}

export async function testDatabaseConnection(
  config: DBConnectionConfig,
  dbType: DataSourceType | string = "mysql"
): Promise<void> {
  if (dbType === "mysql") {
    await testMysqlConnection(config);
    return;
  }

  const plugin = getDataSourcePlugin(dbType);
  if (plugin) {
    await plugin.testConnection(config);
    return;
  }

  throw new Error(unsupportedDbMessage(String(dbType)));
}

/** 检测完全重复行（与 DB 探查语义对齐：统计重复组数） */
export function detectFullyDuplicateRowsIssue(
  rows: Record<string, unknown>[],
  columns: string[],
  totalRows: number
): DetectedIssue | null {
  if (totalRows === 0 || columns.length === 0) return null;

  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = columns.map((col) => JSON.stringify(row[col] ?? null)).join("\0");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let dupGroupCount = 0;
  for (const count of counts.values()) {
    if (count > 1) dupGroupCount++;
  }

  if (dupGroupCount === 0) return null;

  return {
    id: "issue_full_dup",
    column: "*",
    issueType: "完全重复行",
    severity: "high",
    affectedRows: dupGroupCount,
    affectedPercent: parseFloat(((dupGroupCount / totalRows) * 100).toFixed(2)),
    description: `发现 ${dupGroupCount} 组完全重复的行`,
    suggestion: "建议删除完全重复的行，保留一条",
  };
}

/** 快速统计文本文件行数（减 1 视为表头），用于大 CSV 总行数估算 */
export function countTextFileLines(filePath: string): number {
  const fd = openSync(filePath, "r");
  const buffer = Buffer.alloc(64 * 1024);
  let newlines = 0;
  let offset = 0;
  let bytesRead: number;
  try {
    while ((bytesRead = readSync(fd, buffer, 0, buffer.length, offset)) > 0) {
      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 10) newlines++;
      }
      offset += bytesRead;
    }
  } finally {
    closeSync(fd);
  }
  return Math.max(0, newlines > 0 ? newlines - 1 : 0);
}

/** 基于文件类型估算总行数（大文件探查用，可能为近似值） */
export function estimateFileRowCount(filePath: string, fileType: FileType): number {
  switch (fileType) {
    case "csv":
    case "xml":
      return countTextFileLines(filePath);
    case "xlsx": {
      const buffer = readFileSync(filePath);
      const workbook = XLSX.read(buffer, { type: "buffer", bookSheets: true });
      const sheetName = workbook.SheetNames[0];
      const ref = workbook.Sheets[sheetName]?.["!ref"];
      if (!ref) return 0;
      const range = XLSX.utils.decode_range(ref);
      return Math.max(0, range.e.r);
    }
    case "json": {
      const content = readFileSync(filePath, "utf-8");
      const data = JSON.parse(content) as unknown;
      if (Array.isArray(data)) return data.length;
      if (typeof data === "object" && data !== null) {
        const arrKey = Object.keys(data as Record<string, unknown>).find((k) =>
          Array.isArray((data as Record<string, unknown>)[k])
        );
        if (arrKey) return ((data as Record<string, unknown>)[arrKey] as unknown[]).length;
        return 1;
      }
      return 0;
    }
    default:
      return 0;
  }
}

/** 在样本行上计算列统计（大文件探查） */
function buildFileColumnStatsFromRows(
  rows: Record<string, unknown>[],
  columns: string[],
  statsRowCount: number,
  totalRows: number,
  useSampleStats: boolean
): { columnStats: ColumnStats[]; issues: DetectedIssue[] } {
  const columnStats: ColumnStats[] = [];
  const issues: DetectedIssue[] = [];

  for (const col of columns) {
    const values = rows.map((row) => row[col]);
    const nullCountInSample = values.filter(
      (v) => v === null || v === undefined || v === ""
    ).length;
    const uniqueValues = new Set(
      values.filter((v) => v !== null && v !== undefined && v !== "")
    );
    const nonNullValues = values.filter(
      (v) => v !== null && v !== undefined && v !== ""
    );
    const numericCount = nonNullValues.filter((v) => !isNaN(Number(v))).length;
    const detectedType =
      numericCount > nonNullValues.length * 0.8 ? "NUMERIC" : "VARCHAR";

    const nullRate =
      statsRowCount > 0
        ? Math.round((nullCountInSample / statsRowCount) * 10000) / 100
        : 0;
    const nullCount = useSampleStats
      ? scaleNullCountFromSample(nullCountInSample, statsRowCount, totalRows)
      : nullCountInSample;

    columnStats.push({
      columnName: col,
      dataType: detectedType,
      nullRate,
      nullCount,
      uniqueCount: uniqueValues.size,
      sampleValues: nonNullValues.slice(0, 5).map((v) => String(v)),
    });

    if (nullRate > 5) {
      issues.push({
        id: `issue_null_${col}`,
        column: col,
        issueType: "空值过多",
        severity: nullRate > 30 ? "high" : "medium",
        affectedRows: nullCount,
        affectedPercent: parseFloat(nullRate.toFixed(2)),
        description: `列 "${col}" 空值率为 ${nullRate}%`,
        suggestion: "建议使用合适的值填充空值",
      });
    }
  }

  return { columnStats, issues };
}

function appendFileExploreMeta(
  result: ExplorationResult,
  useSampleStats: boolean,
  rowCountApproximate: boolean
): ExplorationResult {
  return {
    ...result,
    sampleBasedStats: useSampleStats || undefined,
    rowCountApproximate: rowCountApproximate || undefined,
  };
}

export async function parseCSVFile(filePath: string, previewRows: number = 100): Promise<ExplorationResult> {
  const estimatedRows = countTextFileLines(filePath);
  const useSampleStats = estimatedRows > FILE_EXPLORE_FULL_SCAN_ROW_LIMIT;
  const totalRows = estimatedRows;
  const statsLimit = Math.min(previewRows, EXPLORE_SAMPLE_LIMIT);
  const rowCountApproximate = useSampleStats;

  const loaded = useSampleStats
    ? await loadCSVRowsAsync(filePath, { maxRows: statsLimit })
    : loadCSVRows(filePath);
  const columns = loaded.columns;
  const statsRows = loaded.rows;
  const statsRowCount = useSampleStats ? statsRows.length : totalRows;

  const schema: ColumnInfo[] = columns.map((col) => ({
    name: col,
    type: "VARCHAR",
    nullable: true,
  }));

  const { columnStats, issues } = buildFileColumnStatsFromRows(
    statsRows,
    columns,
    statsRowCount,
    totalRows,
    useSampleStats
  );

  if (!useSampleStats) {
    const dupIssue = detectFullyDuplicateRowsIssue(statsRows, columns, totalRows);
    if (dupIssue) issues.push(dupIssue);
  }

  return appendFileExploreMeta(
    {
      sourceType: "csv",
      sourceName: path.basename(filePath),
      totalRows,
      totalCols: columns.length,
      schema,
      sampleData: statsRows.slice(0, 10),
      columnStats,
      sampleSize: Math.min(statsLimit, totalRows),
      issues,
    },
    useSampleStats,
    rowCountApproximate
  );
}

export async function parseJSONFile(filePath: string, previewRows: number = 100): Promise<ExplorationResult> {
  const content = readFileSync(filePath, "utf-8");
  const data = JSON.parse(content) as unknown;

  let rows: Record<string, unknown>[] = [];
  if (Array.isArray(data)) {
    rows = data;
  } else if (typeof data === "object" && data !== null) {
    const arrKey = Object.keys(data).find((k) => Array.isArray((data as Record<string, unknown>)[k]));
    if (arrKey) rows = (data as Record<string, unknown>)[arrKey] as Record<string, unknown>[];
    else rows = [data as Record<string, unknown>];
  }

  const totalRows = rows.length;
  const useSampleStats = totalRows > FILE_EXPLORE_FULL_SCAN_ROW_LIMIT;
  const statsLimit = Math.min(previewRows, EXPLORE_SAMPLE_LIMIT);
  const statsRows = useSampleStats ? rows.slice(0, statsLimit) : rows;
  const statsRowCount = statsRows.length;

  const allKeys = new Set<string>();
  statsRows.forEach((row) => Object.keys(row).forEach((k) => allKeys.add(k)));
  const columns = Array.from(allKeys);

  const schema: ColumnInfo[] = columns.map((col) => ({
    name: col,
    type: "VARCHAR",
    nullable: true,
  }));

  const { columnStats, issues } = buildFileColumnStatsFromRows(
    statsRows,
    columns,
    statsRowCount,
    totalRows,
    useSampleStats
  );

  if (!useSampleStats) {
    const dupIssue = detectFullyDuplicateRowsIssue(rows, columns, totalRows);
    if (dupIssue) issues.push(dupIssue);
  }

  return appendFileExploreMeta(
    {
      sourceType: "json",
      sourceName: path.basename(filePath),
      totalRows,
      totalCols: columns.length,
      schema,
      sampleData: statsRows.slice(0, 10),
      columnStats,
      sampleSize: Math.min(statsLimit, totalRows),
      issues,
    },
    useSampleStats,
    false
  );
}

export async function parseXLSXFile(filePath: string, previewRows: number = 100): Promise<ExplorationResult> {
  const buffer = readFileSync(filePath);
  const metaWorkbook = XLSX.read(buffer, { type: "buffer", bookSheets: true });
  const sheetName = metaWorkbook.SheetNames[0];
  const sheetRef = metaWorkbook.Sheets[sheetName]?.["!ref"];
  const totalRows = sheetRef ? Math.max(0, XLSX.utils.decode_range(sheetRef).e.r) : 0;
  const useSampleStats = totalRows > FILE_EXPLORE_FULL_SCAN_ROW_LIMIT;
  const statsLimit = Math.min(previewRows, EXPLORE_SAMPLE_LIMIT);
  const readRowCap = useSampleStats ? statsLimit + 1 : undefined;

  const workbook = XLSX.read(buffer, {
    type: "buffer",
    sheetRows: readRowCap,
  });
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];

  if (rows.length === 0) {
    throw new Error("Empty Excel file");
  }

  const headers = (rows[0] as string[]).map((h) => String(h).trim());
  const dataRows = rows.slice(1);
  const statsRowCount = dataRows.length;

  const schema: ColumnInfo[] = headers.map((col) => ({
    name: col,
    type: "VARCHAR",
    nullable: true,
  }));

  const allRecords = dataRows.map((row) => {
    const record: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      record[h] = (row as unknown[])[i];
    });
    return record;
  });

  const { columnStats, issues } = buildFileColumnStatsFromRows(
    allRecords,
    headers,
    statsRowCount,
    totalRows,
    useSampleStats
  );

  if (!useSampleStats) {
    const dupIssue = detectFullyDuplicateRowsIssue(allRecords, headers, totalRows);
    if (dupIssue) issues.push(dupIssue);
  }

  return appendFileExploreMeta(
    {
      sourceType: "xlsx",
      sourceName: path.basename(filePath),
      totalRows,
      totalCols: headers.length,
      schema,
      sampleData: allRecords.slice(0, 10),
      columnStats,
      sampleSize: Math.min(statsLimit, totalRows),
      issues,
    },
    useSampleStats,
    useSampleStats
  );
}

export async function parseXMLFile(filePath: string, previewRows: number = 100): Promise<ExplorationResult> {
  const content = readFileSync(filePath, "utf-8");
  const parsed = await parseStringPromise(content, { explicitArray: false });

  // Try to extract rows from common XML patterns
  let rows: Record<string, unknown>[] = [];
  const parsedRecord = parsed as Record<string, unknown>;
  const rootKeys = Object.keys(parsedRecord);

  for (const key of rootKeys) {
    const val = parsedRecord[key];
    if (Array.isArray(val)) {
      rows = val as Record<string, unknown>[];
      break;
    } else if (typeof val === "object" && val !== null) {
      const valRecord = val as Record<string, unknown>;
      const childKeys = Object.keys(valRecord);
      const arrKey = childKeys.find((k) => Array.isArray(valRecord[k]));
      if (arrKey) {
        rows = valRecord[arrKey] as Record<string, unknown>[];
        break;
      }
    }
  }

  if (rows.length === 0) {
    rows = [parsed];
  }

  const totalRows = rows.length;
  const allKeys = new Set<string>();
  rows.forEach((row) => Object.keys(row).forEach((k) => allKeys.add(k)));
  const columns = Array.from(allKeys);

  const schema: ColumnInfo[] = columns.map((col) => ({
    name: col,
    type: "VARCHAR",
    nullable: true,
  }));

  const columnStats: ColumnStats[] = columns.map((col) => {
    const values = rows.map((row) => row[col]);
    const nullCount = values.filter((v) => v === null || v === undefined).length;
    const uniqueValues = new Set(values.filter((v) => v !== null && v !== undefined));

    return {
      columnName: col,
      dataType: "VARCHAR",
      nullRate: totalRows > 0 ? Math.round((nullCount / totalRows) * 10000) / 100 : 0,
      uniqueCount: uniqueValues.size,
      sampleValues: values.filter((v) => v !== null && v !== undefined).slice(0, 5).map((v) =>
        typeof v === "object" ? JSON.stringify(v) : String(v)
      ),
    };
  });

  const issues: DetectedIssue[] = columnStats
    .filter((cs) => cs.nullRate > 5)
    .map((cs) => ({
      id: `issue_null_${cs.columnName}`,
      column: cs.columnName,
      issueType: "空值过多",
      severity: cs.nullRate > 30 ? "high" : "medium",
      affectedRows: Math.round((cs.nullRate / 100) * totalRows),
      affectedPercent: cs.nullRate,
      description: `列 "${cs.columnName}" 空值率为 ${cs.nullRate}%`,
      suggestion: "建议使用合适的值填充空值",
    }));

  const dupIssue = detectFullyDuplicateRowsIssue(rows, columns, totalRows);
  if (dupIssue) issues.push(dupIssue);

  return {
    sourceType: "xml",
    sourceName: path.basename(filePath),
    totalRows,
    totalCols: columns.length,
    schema,
    sampleData: rows.slice(0, 10),
    columnStats,
    sampleSize: Math.min(previewRows, totalRows),
    issues,
  };
}

export async function exploreFile(
  filePath: string,
  fileType: FileType,
  previewRows: number = 100
): Promise<ExplorationResult> {
  const resolvedPath = resolveExistingUploadPath(filePath);
  switch (fileType) {
    case "csv":
      return parseCSVFile(resolvedPath, previewRows);
    case "json":
      return parseJSONFile(resolvedPath, previewRows);
    case "xlsx":
      return parseXLSXFile(resolvedPath, previewRows);
    case "xml":
      return parseXMLFile(resolvedPath, previewRows);
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

/** 流式读取 CSV 前 N 行（大文件避免整文件载入内存） */
async function loadCSVRowsStreaming(
  filePath: string,
  maxRows: number
): Promise<{ rows: Record<string, unknown>[]; columns: string[] }> {
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let headers: string[] = [];
  const rows: Record<string, unknown>[] = [];
  let lineIndex = 0;

  return new Promise((resolve, reject) => {
    rl.on("line", (line) => {
      if (lineIndex === 0) {
        const headerParsed = Papa.parse<string[]>(line, { header: false });
        headers = (headerParsed.data[0] ?? []).map((h) => String(h).trim());
        lineIndex++;
        return;
      }

      if (rows.length >= maxRows) return;

      const fieldParsed = Papa.parse<string[]>(line, { header: false });
      const fields = fieldParsed.data[0] ?? [];
      const row: Record<string, unknown> = {};
      headers.forEach((header, idx) => {
        row[header] = fields[idx] ?? null;
      });
      if (Object.keys(row).length > 0) {
        rows.push(row);
      }
      lineIndex++;
    });

    rl.on("close", () => resolve({ rows, columns: headers }));
    rl.on("error", reject);
    stream.on("error", reject);
  });
}

async function loadCSVRowsAsync(filePath: string, options?: FileLoadOptions): Promise<FileLoadResult> {
  const estimatedTotalRows = countTextFileLines(filePath);
  const maxRows = options?.maxRows;

  if (maxRows != null) {
    const { rows, columns } = await loadCSVRowsStreaming(filePath, maxRows);
    return {
      rows,
      columns,
      truncated: estimatedTotalRows > rows.length,
      estimatedTotalRows,
    };
  }

  const content = readFileSync(filePath, "utf-8");
  const parsed = Papa.parse<Record<string, unknown>>(content, {
    header: true,
    skipEmptyLines: true,
  });
  const rows = parsed.data;
  const columns = parsed.meta.fields || (rows[0] ? Object.keys(rows[0]) : []);
  return {
    rows,
    columns,
    truncated: false,
    estimatedTotalRows,
  };
}

function loadCSVRows(filePath: string, options?: FileLoadOptions): FileLoadResult {
  const estimatedTotalRows = countTextFileLines(filePath);
  const maxRows = options?.maxRows;

  if (maxRows != null && estimatedTotalRows > maxRows) {
    throw new Error("大 CSV 请使用 loadCSVRowsAsync 流式读取");
  }

  const content = readFileSync(filePath, "utf-8");
  const parsed = Papa.parse<Record<string, unknown>>(content, {
    header: true,
    skipEmptyLines: true,
    preview: maxRows,
  });
  const rows = parsed.data;
  const columns = parsed.meta.fields || (rows[0] ? Object.keys(rows[0]) : []);
  return {
    rows,
    columns,
    truncated: maxRows != null && estimatedTotalRows > rows.length,
    estimatedTotalRows,
  };
}

function loadJSONRows(filePath: string, options?: FileLoadOptions): FileLoadResult {
  const content = readFileSync(filePath, "utf-8");
  const data = JSON.parse(content) as unknown;
  const maxRows = options?.maxRows;

  if (Array.isArray(data)) {
    const fullRows = data as Record<string, unknown>[];
    const rows = maxRows != null ? fullRows.slice(0, maxRows) : fullRows;
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return {
      rows,
      columns,
      jsonExport: { mode: "array" },
      truncated: maxRows != null && fullRows.length > rows.length,
      estimatedTotalRows: fullRows.length,
    };
  }

  if (typeof data === "object" && data !== null) {
    const record = data as Record<string, unknown>;
    const arrKey = Object.keys(record).find((k) => Array.isArray(record[k]));
    if (arrKey) {
      const fullRows = record[arrKey] as Record<string, unknown>[];
      const rows = maxRows != null ? fullRows.slice(0, maxRows) : fullRows;
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      const wrapper = { ...record };
      delete wrapper[arrKey];
      return {
        rows,
        columns,
        jsonExport: { mode: "object", key: arrKey, wrapper },
        truncated: maxRows != null && fullRows.length > rows.length,
        estimatedTotalRows: fullRows.length,
      };
    }
    return { rows: [record], columns: Object.keys(record), jsonExport: { mode: "array" } };
  }

  return { rows: [], columns: [] };
}

function loadXlsxRows(filePath: string, options?: FileLoadOptions): FileLoadResult {
  const buffer = readFileSync(filePath);
  const metaWorkbook = XLSX.read(buffer, { type: "buffer", bookSheets: true });
  const sheetName = metaWorkbook.SheetNames[0];
  const sheetRef = metaWorkbook.Sheets[sheetName]?.["!ref"];
  const estimatedTotalRows = sheetRef ? Math.max(0, XLSX.utils.decode_range(sheetRef).e.r) : 0;
  const maxRows = options?.maxRows;
  const readCap = maxRows != null ? maxRows + 1 : undefined;

  const workbook = XLSX.read(buffer, { type: "buffer", sheetRows: readCap });
  const worksheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];
  if (matrix.length === 0) {
    return { rows: [], columns: [], estimatedTotalRows };
  }
  const headers = (matrix[0] as string[]).map((h) => String(h).trim());
  const rows = matrix.slice(1).map((row) => {
    const record: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      record[h] = (row as unknown[])[i];
    });
    return record;
  });
  return {
    rows,
    columns: headers,
    truncated: maxRows != null && estimatedTotalRows > rows.length,
    estimatedTotalRows,
  };
}

async function loadXMLRows(filePath: string): Promise<FileLoadResult> {
  const content = readFileSync(filePath, "utf-8");
  const parsed = await parseStringPromise(content, { explicitArray: false });
  const parsedRecord = parsed as Record<string, unknown>;
  const rootKeys = Object.keys(parsedRecord);

  for (const key of rootKeys) {
    const val = parsedRecord[key];
    if (Array.isArray(val)) {
      const rows = val as Record<string, unknown>[];
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      return { rows, columns, xmlExport: { rootKey: key } };
    }
    if (typeof val === "object" && val !== null) {
      const valRecord = val as Record<string, unknown>;
      const arrKey = Object.keys(valRecord).find((k) => Array.isArray(valRecord[k]));
      if (arrKey) {
        const rows = valRecord[arrKey] as Record<string, unknown>[];
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        return { rows, columns, xmlExport: { rootKey: key, containerKey: arrKey } };
      }
    }
  }

  return { rows: [parsedRecord], columns: Object.keys(parsedRecord), xmlExport: { rootKey: rootKeys[0] || "root" } };
}

export async function loadFullFileData(
  filePath: string,
  fileType: FileType,
  options?: FileLoadOptions
): Promise<FileLoadResult> {
  switch (fileType) {
    case "csv":
      return options?.maxRows != null
        ? loadCSVRowsAsync(filePath, options)
        : loadCSVRows(filePath, options);
    case "json":
      return loadJSONRows(filePath, options);
    case "xlsx":
      return loadXlsxRows(filePath, options);
    case "xml":
      return loadXMLRows(filePath);
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

export function writeCleanedFile(
  outputPath: string,
  fileType: FileType,
  rows: Record<string, unknown>[],
  columns: string[],
  meta?: Pick<FileLoadResult, "jsonExport" | "xmlExport">
): void {
  ensureUploadDir();
  switch (fileType) {
    case "csv": {
      const csv = Papa.unparse(rows, { columns });
      writeFileSync(outputPath, csv, "utf-8");
      break;
    }
    case "json": {
      let payload: unknown = rows;
      if (meta?.jsonExport?.mode === "object") {
        payload = { ...meta.jsonExport.wrapper, [meta.jsonExport.key]: rows };
      }
      writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf-8");
      break;
    }
    case "xlsx": {
      const sheet = XLSX.utils.json_to_sheet(rows, { header: columns });
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
      writeFileSync(outputPath, buffer);
      break;
    }
    case "xml": {
      const rootKey = meta?.xmlExport?.rootKey || "data";
      const containerKey = meta?.xmlExport?.containerKey;
      const xmlBody = containerKey
        ? { [rootKey]: { [containerKey]: rows } }
        : { [rootKey]: rows };
      const xmlContent = new Builder({ headless: false, renderOpts: { pretty: true } }).buildObject(xmlBody);
      writeFileSync(outputPath, xmlContent, "utf-8");
      break;
    }
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

// ---- Cleanup ----

export async function cleanupSession(sessionId: string): Promise<void> {
  await closeConnection(sessionId);
  connectionPools.delete(sessionId);
}
