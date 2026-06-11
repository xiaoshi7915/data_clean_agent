/** SQL 方言抽象：标识符引用、字符串拼接、备份 DDL 等 */
export interface SqlDialect {
  readonly name: string;

  /** 引用列/标识符 */
  quoteIdentifier(name: string): string;

  /** 引用表名（默认同 quoteIdentifier） */
  quoteTable(table: string): string;

  /** 多段字符串拼接 CONCAT(a, b, ...) */
  concat(parts: string[]): string;

  /** 带分隔符拼接 CONCAT_WS(sep, ...) */
  concatWs(separator: string, parts: string[]): string;

  /** 创建备份表 DDL */
  createBackupSql(sourceTable: string, backupTable: string): string;

  /** 创建与源表结构相同的空表 */
  createTableLikeSql(sourceTable: string, targetTable: string): string;
}
