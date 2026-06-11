import type { DataSourceType, DatabaseDialect, FileType } from "./types";

/** 当前已实现探查/执行的数据库驱动（仅 MySQL） */
export const SUPPORTED_DB_DRIVER_TYPES: DataSourceType[] = ["mysql"];

/** 当前已实现 SQL 生成的方言 */
export const SUPPORTED_SQL_DIALECTS: DatabaseDialect[] = ["mysql"];

/** 已实现的文件探查/清洗类型 */
export const SUPPORTED_FILE_TYPES: FileType[] = ["csv", "json", "xml", "xlsx"];

const DB_TYPES = new Set<DataSourceType>([
  "mysql",
  "postgresql",
  "sqlite",
  "sqlserver",
  "oracle",
]);

/** 是否为数据库类数据源 */
export function isDatabaseSourceType(type: DataSourceType | string): boolean {
  return DB_TYPES.has(type as DataSourceType);
}

/** 数据库探查/表列表是否已支持 */
export function isDbExploreSupported(type: DataSourceType | string): boolean {
  return SUPPORTED_DB_DRIVER_TYPES.includes(type as DataSourceType);
}

/** SQL 执行/生成是否已支持该方言 */
export function isSqlDialectSupported(dialect: DatabaseDialect | string): boolean {
  return SUPPORTED_SQL_DIALECTS.includes(dialect as DatabaseDialect);
}

/** 文件探查/清洗是否已支持 */
export function isFileTypeSupported(type: FileType | string): boolean {
  return SUPPORTED_FILE_TYPES.includes(type as FileType);
}

/** 未支持类型的用户提示文案 */
export function unsupportedDbMessage(type: string): string {
  return `数据源类型「${type}」的探查与 SQL 执行尚未实现，当前仅支持 MySQL。`;
}
