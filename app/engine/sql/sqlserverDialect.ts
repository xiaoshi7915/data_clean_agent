import type { SqlDialect } from "./dialect";

/** SQL Server (T-SQL) 方言实现（方括号标识符） */
export class SqlServerDialect implements SqlDialect {
  readonly name = "sqlserver";

  quoteIdentifier(name: string): string {
    return `[${name.replace(/]/g, "]]")}]`;
  }

  quoteTable(table: string): string {
    return this.quoteIdentifier(table);
  }

  concat(parts: string[]): string {
    if (parts.length === 0) return "''";
    if (parts.length === 1) return parts[0];
    return `CONCAT(${parts.join(", ")})`;
  }

  concatWs(separator: string, parts: string[]): string {
    const escapedSep = separator.replace(/'/g, "''");
    if (parts.length === 0) return "''";
    return `CONCAT_WS('${escapedSep}', ${parts.join(", ")})`;
  }

  createBackupSql(sourceTable: string, backupTable: string): string {
    const src = this.quoteTable(sourceTable);
    const bak = this.quoteTable(backupTable);
    return `SELECT * INTO ${bak}\nFROM ${src};`;
  }

  createTableLikeSql(sourceTable: string, targetTable: string): string {
    const src = this.quoteTable(sourceTable);
    const tgt = this.quoteTable(targetTable);
    return `SELECT * INTO ${tgt}\nFROM ${src}\nWHERE 1 = 0;`;
  }
}

export const sqlserverDialect = new SqlServerDialect();
