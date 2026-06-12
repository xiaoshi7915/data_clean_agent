import { eq, and, desc, isNull } from "drizzle-orm";
import { encryptCredentialForStorage, decryptCredential } from "../lib/credentialCrypto";
import { isPasswordMissing } from "../lib/dataSourceSanitizer";
import { normalizeStoredUploadPath, toStoredUploadPath } from "./uploadPathService";
import { getDb } from "../queries/connection";
import { savedDataSources, cleaningSessions } from "@db/schema";
import type { DataSourceConfig } from "@contracts/types";

export interface SavedDataSourceSummary {
  dataSourceId: string;
  name: string;
  type: string;
  dbDatabase?: string | null;
  fileName?: string | null;
  sessionCount: number;
  updatedAt: Date;
}

function rowToConfig(row: typeof savedDataSources.$inferSelect): DataSourceConfig {
  const config: DataSourceConfig = {
    type: row.type as DataSourceConfig["type"],
    name: row.name,
  };
  if (row.dbHost) {
    config.dbConfig = {
      host: row.dbHost,
      port: row.dbPort || 3306,
      database: row.dbDatabase || "",
      username: row.dbUsername || "",
      password: decryptCredential(row.dbPassword || ""),
      schema: row.dbSchema || undefined,
    };
  }
  if (row.fileName) {
    config.fileConfig = {
      fileName: row.fileName,
      fileSize: 0,
      fileType: (row.fileType as "csv" | "json" | "xml" | "xlsx") || "csv",
      // 读取时规范化路径，兼容历史绝对路径
      filePath: row.filePath ? normalizeStoredUploadPath(row.filePath) : "",
    };
  }
  return config;
}

/** 仅匹配未逻辑删除的数据源 */
const notDeleted = isNull(savedDataSources.deletedAt);

export async function findExistingDataSource(config: DataSourceConfig): Promise<string | null> {
  const db = getDb();

  if (config.dbConfig) {
    const rows = await db
      .select({ dataSourceId: savedDataSources.dataSourceId })
      .from(savedDataSources)
      .where(
        and(
          notDeleted,
          eq(savedDataSources.type, config.type),
          eq(savedDataSources.dbHost, config.dbConfig.host),
          eq(savedDataSources.dbPort, config.dbConfig.port),
          eq(savedDataSources.dbDatabase, config.dbConfig.database),
          eq(savedDataSources.dbUsername, config.dbConfig.username)
        )
      )
      .limit(1);
    return rows[0]?.dataSourceId ?? null;
  }

  if (config.fileConfig) {
    const rows = await db
      .select({ dataSourceId: savedDataSources.dataSourceId })
      .from(savedDataSources)
      .where(
        and(
          notDeleted,
          eq(savedDataSources.type, config.type),
          eq(savedDataSources.fileName, config.fileConfig.fileName)
        )
      )
      .limit(1);
    // 优先按文件名匹配；路径仅存 basename，跨环境可复用
    if (rows[0]?.dataSourceId) return rows[0].dataSourceId;

    const legacyRows = await db
      .select({ dataSourceId: savedDataSources.dataSourceId })
      .from(savedDataSources)
      .where(
        and(
          notDeleted,
          eq(savedDataSources.type, config.type),
          eq(savedDataSources.filePath, config.fileConfig.filePath)
        )
      )
      .limit(1);
    return legacyRows[0]?.dataSourceId ?? null;
  }

  return null;
}

/** 按连接信息查找已保存数据源（用于会话重建时恢复密码） */
export async function findDataSourceByConnection(
  type: string,
  host: string,
  port: number,
  database: string
): Promise<DataSourceConfig | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(savedDataSources)
    .where(
      and(
        notDeleted,
        eq(savedDataSources.type, type as DataSourceConfig["type"]),
        eq(savedDataSources.dbHost, host),
        eq(savedDataSources.dbPort, port),
        eq(savedDataSources.dbDatabase, database)
      )
    )
    .limit(1);

  if (rows.length === 0) return null;
  return rowToConfig(rows[0]);
}

export async function upsertDataSource(config: DataSourceConfig): Promise<string> {
  const db = getDb();
  const existingId = await findExistingDataSource(config);

  if (existingId) {
    await db
      .update(savedDataSources)
      .set({
        name: config.name,
        dbPassword: encryptCredentialForStorage(config.dbConfig?.password),
        updatedAt: new Date(),
      })
      .where(eq(savedDataSources.dataSourceId, existingId));
    return existingId;
  }

  const dataSourceId = `ds_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  await db.insert(savedDataSources).values({
    dataSourceId,
    name: config.name,
    type: config.type,
    dbHost: config.dbConfig?.host ?? null,
    dbPort: config.dbConfig?.port ?? null,
    dbDatabase: config.dbConfig?.database ?? null,
    dbSchema: config.dbConfig?.schema ?? null,
    dbUsername: config.dbConfig?.username ?? null,
    dbPassword: encryptCredentialForStorage(config.dbConfig?.password),
    fileName: config.fileConfig?.fileName ?? null,
    fileType: config.fileConfig?.fileType ?? null,
    filePath: config.fileConfig?.filePath
      ? toStoredUploadPath(config.fileConfig.filePath)
      : null,
  });

  return dataSourceId;
}

export async function getDataSourceById(dataSourceId: string): Promise<DataSourceConfig | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(savedDataSources)
    .where(and(eq(savedDataSources.dataSourceId, dataSourceId), notDeleted))
    .limit(1);

  if (rows.length === 0) return null;
  return rowToConfig(rows[0]);
}

export async function updateDataSource(
  dataSourceId: string,
  config: DataSourceConfig
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: savedDataSources.id })
    .from(savedDataSources)
    .where(and(eq(savedDataSources.dataSourceId, dataSourceId), notDeleted))
    .limit(1);

  if (rows.length === 0) return false;

  const existing = await getDataSourceById(dataSourceId);
  const incomingPassword = config.dbConfig?.password;
  const passwordToStore =
    existing?.dbConfig && isPasswordMissing(incomingPassword)
      ? existing.dbConfig.password
      : incomingPassword;

  await db
    .update(savedDataSources)
    .set({
      name: config.name,
      type: config.type,
      dbHost: config.dbConfig?.host ?? null,
      dbPort: config.dbConfig?.port ?? null,
      dbDatabase: config.dbConfig?.database ?? null,
      dbSchema: config.dbConfig?.schema ?? null,
      dbUsername: config.dbConfig?.username ?? null,
      dbPassword: encryptCredentialForStorage(passwordToStore),
      fileName: config.fileConfig?.fileName ?? null,
      fileType: config.fileConfig?.fileType ?? null,
      filePath: config.fileConfig?.filePath
        ? toStoredUploadPath(config.fileConfig.filePath)
        : null,
      updatedAt: new Date(),
    })
    .where(eq(savedDataSources.dataSourceId, dataSourceId));

  return true;
}

/** 逻辑删除数据源（不级联删除会话） */
export async function softDeleteDataSource(dataSourceId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: savedDataSources.id })
    .from(savedDataSources)
    .where(and(eq(savedDataSources.dataSourceId, dataSourceId), notDeleted))
    .limit(1);

  if (rows.length === 0) return false;

  await db
    .update(savedDataSources)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(savedDataSources.dataSourceId, dataSourceId));

  return true;
}

export async function listSavedDataSources(): Promise<SavedDataSourceSummary[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(savedDataSources)
    .where(notDeleted)
    .orderBy(desc(savedDataSources.updatedAt));
  const sessions = await db
    .select({
      dataSourceId: cleaningSessions.dataSourceId,
    })
    .from(cleaningSessions);

  const countMap = new Map<string, number>();
  for (const s of sessions) {
    if (s.dataSourceId) {
      countMap.set(s.dataSourceId, (countMap.get(s.dataSourceId) || 0) + 1);
    }
  }

  return rows.map((row) => ({
    dataSourceId: row.dataSourceId,
    name: row.name,
    type: row.type,
    dbDatabase: row.dbDatabase,
    fileName: row.fileName,
    sessionCount: countMap.get(row.dataSourceId) || 0,
    updatedAt: row.updatedAt,
  }));
}
