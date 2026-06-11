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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

/** 按方言创建会话级连接池 */
export async function createConnectionForDialect(
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
  return entry;
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
  const value = Math.floor(Number(limit) || 100);
  return Math.max(1, Math.min(value, 100));
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

export async function exploreDatabase(
  sessionId: string,
  config: DBConnectionConfig,
  tableName: string,
  limit: number = 100,
  dbType: DataSourceType | string = "mysql"
): Promise<ExplorationResult> {
  const plugin = getDataSourcePlugin(dbType);
  if (plugin && dbType !== "mysql") {
    return plugin.explore(config, { sessionId, tableName, limit });
  }

  const safeTable = sanitizeTableName(tableName);
  const safeLimit = sanitizeLimit(limit);
  const quotedTable = quoteIdentifier(safeTable);
  const pool = await createConnection(sessionId, config);

  // Get schema
  const [columns] = await pool.execute(
    `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT,
            CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [config.database, safeTable]
  );

  // 通过 MetricRegistry 生成行数 SQL，避免与质量报告侧重复定义
  const metricCollector = new ExplorationMetricCollector(
    mysqlDialect,
    safeTable,
    (metricId, column) => metricRegistry.resolve(metricId, { column, table: safeTable })
  );
  const [countRows] = await pool.query(metricCollector.buildCountSql("row_count"));
  const totalRows = (countRows as { cnt: number }[])[0]?.cnt || 0;

  // LIMIT 不能用预处理占位符，MySQL 会报 mysqld_stmt_execute 参数错误
  const [sampleRows] = await pool.query(
    `SELECT * FROM ${quotedTable} LIMIT ${safeLimit}`
  );

  // Get column stats
  const dbColumns = columns as Array<{
    COLUMN_NAME: string;
    DATA_TYPE: string;
    IS_NULLABLE: string;
    COLUMN_DEFAULT: string | null;
    CHARACTER_MAXIMUM_LENGTH: number | null;
  }>;

  const columnStats: ColumnStats[] = [];
  const schema: ColumnInfo[] = [];
  const issues: DetectedIssue[] = [];

  for (const col of dbColumns) {
    schema.push({
      name: col.COLUMN_NAME,
      type: col.DATA_TYPE,
      nullable: col.IS_NULLABLE === "YES",
      defaultValue: col.COLUMN_DEFAULT || undefined,
      maxLength: col.CHARACTER_MAXIMUM_LENGTH || undefined,
    });

    const quotedCol = quoteIdentifier(col.COLUMN_NAME);
    const [nullResult] = await pool.query(
      metricCollector.buildCountSql("null_count", col.COLUMN_NAME)
    );
    const nullCount = Number((nullResult as { cnt: number }[])[0]?.cnt) || 0;

    const [uniqueResult] = await pool.query(
      metricCollector.buildCountSql("distinct_count", col.COLUMN_NAME)
    );
    const uniqueCount = Number((uniqueResult as { cnt: number }[])[0]?.cnt) || 0;

    // Get sample values
    const [sampleResult] = await pool.query(
      `SELECT DISTINCT ${quotedCol} as val FROM ${quotedTable} WHERE ${quotedCol} IS NOT NULL LIMIT 5`
    );
    const sampleValues = (sampleResult as { val: unknown }[]).map((r) => r.val as string | number | null);

    const nullRate = totalRows > 0 ? Math.round((nullCount / totalRows) * 10000) / 100 : 0;

    columnStats.push({
      columnName: col.COLUMN_NAME,
      dataType: col.DATA_TYPE,
      nullRate,
      nullCount,
      uniqueCount,
      sampleValues,
    });

    // Detect issues
    if (nullRate > 5) {
      issues.push({
        id: `issue_null_${col.COLUMN_NAME}`,
        column: col.COLUMN_NAME,
        issueType: "空值过多",
        severity: nullRate > 30 ? "high" : "medium",
        affectedRows: nullCount,
        affectedPercent: parseFloat(nullRate.toFixed(2)),
        description: `列 "${col.COLUMN_NAME}" 空值率为 ${nullRate}%`,
        suggestion: nullRate > 50 ? "建议删除该列或使用默认值填充" : "建议使用合适的值填充空值",
      });
    }

    // 仅对 id 类字段检测列级重复（业务上应唯一）；普通列重复是正常现象
    if (
      isIdLikeColumn(col.COLUMN_NAME) &&
      uniqueCount < totalRows &&
      nullCount === 0
    ) {
      const dupCount = totalRows - uniqueCount;
      issues.push({
        id: `issue_dup_${col.COLUMN_NAME}`,
        column: col.COLUMN_NAME,
        issueType: "唯一键重复",
        severity: dupCount > totalRows * 0.01 ? "high" : "medium",
        affectedRows: dupCount,
        affectedPercent: parseFloat(((dupCount / totalRows) * 100).toFixed(2)),
        description: `唯一标识列 "${col.COLUMN_NAME}" 存在 ${dupCount} 个重复值`,
        suggestion: "建议检查主键/唯一约束或处理重复 ID",
      });
    }
  }

  // Check for fully duplicate rows
  const allColNames = dbColumns.map((c) => quoteIdentifier(c.COLUMN_NAME)).join(", ");
  const [dupResult] = await pool.query(
    `SELECT COUNT(*) as cnt FROM (
      SELECT ${allColNames}, COUNT(*) as dup_count
      FROM ${quotedTable}
      GROUP BY ${allColNames}
      HAVING COUNT(*) > 1
    ) as duplicates`
  );
  const fullDupCount = (dupResult as { cnt: number }[])[0]?.cnt || 0;

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

  await closeConnection(sessionId);

  return {
    sourceType: "mysql",
    sourceName: `${config.database}.${safeTable}`,
    totalRows,
    totalCols: dbColumns.length,
    schema,
    sampleData: (sampleRows as Record<string, unknown>[]).slice(0, 10),
    columnStats,
    sampleSize: Math.min(100, totalRows),
    issues,
  };
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

function readXlsxWorkbook(filePath: string): XLSX.WorkBook {
  const buffer = readFileSync(filePath);
  return XLSX.read(buffer, { type: "buffer" });
}

export interface FileLoadResult {
  rows: Record<string, unknown>[];
  columns: string[];
  jsonExport?: { mode: "array" } | { mode: "object"; key: string; wrapper: Record<string, unknown> };
  xmlExport?: { rootKey: string; containerKey?: string };
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

export async function parseCSVFile(filePath: string, previewRows: number = 100): Promise<ExplorationResult> {
  const content = readFileSync(filePath, "utf-8");

  const result = Papa.parse(content, {
    header: true,
    skipEmptyLines: true,
    preview: previewRows,
  });

  const allResult = Papa.parse(content, { header: true, skipEmptyLines: true });
  const totalRows = allResult.data.length;
  const columns = result.meta.fields || [];

  const schema: ColumnInfo[] = columns.map((col) => ({
    name: col,
    type: "VARCHAR",
    nullable: true,
  }));

  const columnStats: ColumnStats[] = [];
  const issues: DetectedIssue[] = [];

  for (const col of columns) {
    const values = (allResult.data as Record<string, unknown>[]).map((row) => row[col]);
    const nullCount = values.filter((v) => v === null || v === undefined || v === "").length;
    const uniqueValues = new Set(values.filter((v) => v !== null && v !== undefined && v !== ""));
    const nonNullValues = values.filter((v) => v !== null && v !== undefined && v !== "");

    // Detect numeric
    const numericCount = nonNullValues.filter((v) => !isNaN(Number(v))).length;
    const detectedType = numericCount > nonNullValues.length * 0.8 ? "NUMERIC" : "VARCHAR";

    const nullRate = totalRows > 0 ? Math.round((nullCount / totalRows) * 10000) / 100 : 0;

    columnStats.push({
      columnName: col,
      dataType: detectedType,
      nullRate,
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

  const dupIssue = detectFullyDuplicateRowsIssue(
    allResult.data as Record<string, unknown>[],
    columns,
    totalRows
  );
  if (dupIssue) issues.push(dupIssue);

  return {
    sourceType: "csv",
    sourceName: path.basename(filePath),
    totalRows,
    totalCols: columns.length,
    schema,
    sampleData: (result.data as Record<string, unknown>[]).slice(0, 10),
    columnStats,
    sampleSize: Math.min(previewRows, totalRows),
    issues,
  };
}

export async function parseJSONFile(filePath: string, previewRows: number = 100): Promise<ExplorationResult> {
  const content = readFileSync(filePath, "utf-8");
  const data = JSON.parse(content);

  let rows: Record<string, unknown>[] = [];
  if (Array.isArray(data)) {
    rows = data;
  } else if (typeof data === "object" && data !== null) {
    // Try to find array property
    const arrKey = Object.keys(data).find((k) => Array.isArray(data[k]));
    if (arrKey) rows = data[arrKey] as Record<string, unknown>[];
    else rows = [data];
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
    sourceType: "json",
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

export async function parseXLSXFile(filePath: string, previewRows: number = 100): Promise<ExplorationResult> {
  const workbook = readXlsxWorkbook(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];

  if (rows.length === 0) {
    throw new Error("Empty Excel file");
  }

  const headers = (rows[0] as string[]).map((h) => String(h).trim());
  const dataRows = rows.slice(1);
  const totalRows = dataRows.length;

  const schema: ColumnInfo[] = headers.map((col) => ({
    name: col,
    type: "VARCHAR",
    nullable: true,
  }));

  const columnStats: ColumnStats[] = [];
  const issues: DetectedIssue[] = [];

  for (let i = 0; i < headers.length; i++) {
    const col = headers[i];
    const values = dataRows.map((row) => row[i]);
    const nullCount = values.filter((v) => v === null || v === undefined || v === "").length;
    const uniqueValues = new Set(values.filter((v) => v !== null && v !== undefined && v !== ""));

    const nullRate = totalRows > 0 ? Math.round((nullCount / totalRows) * 10000) / 100 : 0;

    columnStats.push({
      columnName: col,
      dataType: "VARCHAR",
      nullRate,
      uniqueCount: uniqueValues.size,
      sampleValues: values.filter((v) => v !== null && v !== undefined).slice(0, 5).map((v) => String(v)),
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

  // Convert to record format for sample data
  const allRecords = dataRows.map((row) => {
    const record: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      record[h] = row[i];
    });
    return record;
  });
  const sampleData = allRecords.slice(0, 10);

  const dupIssue = detectFullyDuplicateRowsIssue(allRecords, headers, totalRows);
  if (dupIssue) issues.push(dupIssue);

  return {
    sourceType: "xlsx",
    sourceName: path.basename(filePath),
    totalRows,
    totalCols: headers.length,
    schema,
    sampleData,
    columnStats,
    sampleSize: Math.min(previewRows, totalRows),
    issues,
  };
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
  switch (fileType) {
    case "csv":
      return parseCSVFile(filePath, previewRows);
    case "json":
      return parseJSONFile(filePath, previewRows);
    case "xlsx":
      return parseXLSXFile(filePath, previewRows);
    case "xml":
      return parseXMLFile(filePath, previewRows);
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

function loadCSVRows(filePath: string): FileLoadResult {
  const content = readFileSync(filePath, "utf-8");
  const parsed = Papa.parse<Record<string, unknown>>(content, { header: true, skipEmptyLines: true });
  const rows = parsed.data;
  const columns = parsed.meta.fields || (rows[0] ? Object.keys(rows[0]) : []);
  return { rows, columns };
}

function loadJSONRows(filePath: string): FileLoadResult {
  const content = readFileSync(filePath, "utf-8");
  const data = JSON.parse(content) as unknown;

  if (Array.isArray(data)) {
    const rows = data as Record<string, unknown>[];
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { rows, columns, jsonExport: { mode: "array" } };
  }

  if (typeof data === "object" && data !== null) {
    const record = data as Record<string, unknown>;
    const arrKey = Object.keys(record).find((k) => Array.isArray(record[k]));
    if (arrKey) {
      const rows = record[arrKey] as Record<string, unknown>[];
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      const wrapper = { ...record };
      delete wrapper[arrKey];
      return {
        rows,
        columns,
        jsonExport: { mode: "object", key: arrKey, wrapper },
      };
    }
    return { rows: [record], columns: Object.keys(record), jsonExport: { mode: "array" } };
  }

  return { rows: [], columns: [] };
}

function loadXlsxRows(filePath: string): FileLoadResult {
  const workbook = readXlsxWorkbook(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];
  if (matrix.length === 0) {
    return { rows: [], columns: [] };
  }
  const headers = (matrix[0] as string[]).map((h) => String(h).trim());
  const rows = matrix.slice(1).map((row) => {
    const record: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      record[h] = (row as unknown[])[i];
    });
    return record;
  });
  return { rows, columns: headers };
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

export async function loadFullFileData(filePath: string, fileType: FileType): Promise<FileLoadResult> {
  switch (fileType) {
    case "csv":
      return loadCSVRows(filePath);
    case "json":
      return loadJSONRows(filePath);
    case "xlsx":
      return loadXlsxRows(filePath);
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
