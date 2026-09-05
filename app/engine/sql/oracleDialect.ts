import type { SqlDialect } from "./dialect";

/** Oracle 方言实现（大写双引号标识符，与 sqlGenerationService 对齐） */
export class OracleDialect implements SqlDialect {
  readonly name = "oracle";

  quoteIdentifier(name: string): string {
    return `"${name.toUpperCase().replace(/"/g, '""')}"`;
  }

  quoteTable(table: string): string {
    const dot = table.indexOf(".");
    if (dot > 0) {
      const owner = table.slice(0, dot);
      const name = table.slice(dot + 1);
      return `${this.quoteIdentifier(owner)}.${this.quoteIdentifier(name)}`;
    }
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
    return parts.map((p, i) => (i === 0 ? p : `'${escapedSep}' || ${p}`)).join(" || ");
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

export const oracleDialect = new OracleDialect();
