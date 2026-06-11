import type { SqlDialect } from "./dialect";

/** SQLite 方言实现（双引号标识符） */
export class SqliteDialect implements SqlDialect {
  readonly name = "sqlite";

  quoteIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  quoteTable(table: string): string {
    return this.quoteIdentifier(table);
  }

  concat(parts: string[]): string {
    if (parts.length === 0) return "''";
    if (parts.length === 1) return parts[0];
    return parts.join(" || ");
  }

  concatWs(separator: string, parts: string[]): string {
    const escapedSep = separator.replace(/'/g, "''");
    if (parts.length === 0) return "''";
    return `TRIM(${parts.map((p) => `'${escapedSep}' || ${p}`).join(" || ")})`;
  }

  createBackupSql(sourceTable: string, backupTable: string): string {
    const src = this.quoteTable(sourceTable);
    const bak = this.quoteTable(backupTable);
    return `CREATE TABLE ${bak} AS\nSELECT * FROM ${src};`;
  }

  createTableLikeSql(sourceTable: string, targetTable: string): string {
    const src = this.quoteTable(sourceTable);
    const tgt = this.quoteTable(targetTable);
    return `CREATE TABLE ${tgt} AS\nSELECT * FROM ${src} WHERE 1 = 0;`;
  }
}

export const sqliteDialect = new SqliteDialect();
