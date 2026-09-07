import type { SqlDialect } from "./dialect";

/** PostgreSQL 方言实现 */
export class PostgresDialect implements SqlDialect {
  readonly name = "postgresql";

  quoteIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  quoteTable(table: string): string {
    const dot = table.indexOf(".");
    if (dot > 0) {
      const schema = table.slice(0, dot);
      const name = table.slice(dot + 1);
      return `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(name)}`;
    }
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
    return `CREATE TABLE ${bak} AS\nSELECT * FROM ${src};`;
  }

  createTableLikeSql(sourceTable: string, targetTable: string): string {
    const src = this.quoteTable(sourceTable);
    const tgt = this.quoteTable(targetTable);
    return `CREATE TABLE ${tgt} (LIKE ${src} INCLUDING ALL);`;
  }
}

export const postgresDialect = new PostgresDialect();
