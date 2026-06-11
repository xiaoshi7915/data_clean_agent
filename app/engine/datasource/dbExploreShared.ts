import type { ColumnInfo, ColumnStats, DetectedIssue } from "@contracts/types";

/** 校验表名，防止 SQL 注入 */
export function sanitizeTableName(name: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(`无效的表名: ${name}`);
  }
  return name;
}

/** 限制探查采样行数 */
export function sanitizeExploreLimit(limit: number): number {
  const value = Math.floor(Number(limit) || 100);
  return Math.max(1, Math.min(value, 100));
}

/** 判断是否为 ID 类列（用于重复检测） */
export function isIdLikeColumn(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === "id" ||
    lower.endsWith("_id") ||
    lower.endsWith("_pk") ||
    lower.includes("uuid") ||
    lower.includes("guid")
  );
}

/** 根据列统计构建空值/唯一键问题列表 */
export function buildColumnIssues(
  columnName: string,
  _dataType: string,
  totalRows: number,
  nullCount: number,
  uniqueCount: number
): DetectedIssue[] {
  const issues: DetectedIssue[] = [];
  const nullRate = totalRows > 0 ? Math.round((nullCount / totalRows) * 10000) / 100 : 0;

  if (nullRate > 5) {
    issues.push({
      id: `issue_null_${columnName}`,
      column: columnName,
      issueType: "空值过多",
      severity: nullRate > 30 ? "high" : "medium",
      affectedRows: nullCount,
      affectedPercent: parseFloat(nullRate.toFixed(2)),
      description: `列 "${columnName}" 空值率为 ${nullRate}%`,
      suggestion: nullRate > 50 ? "建议删除该列或使用默认值填充" : "建议使用合适的值填充空值",
    });
  }

  if (isIdLikeColumn(columnName) && uniqueCount < totalRows && nullCount === 0) {
    const dupCount = totalRows - uniqueCount;
    issues.push({
      id: `issue_dup_${columnName}`,
      column: columnName,
      issueType: "唯一键重复",
      severity: dupCount > totalRows * 0.01 ? "high" : "medium",
      affectedRows: dupCount,
      affectedPercent: parseFloat(((dupCount / totalRows) * 100).toFixed(2)),
      description: `唯一标识列 "${columnName}" 存在 ${dupCount} 个重复值`,
      suggestion: "建议检查主键/唯一约束或处理重复 ID",
    });
  }

  return issues;
}

/** 组装单列探查统计 */
export function buildColumnStat(
  columnName: string,
  dataType: string,
  totalRows: number,
  nullCount: number,
  uniqueCount: number,
  sampleValues: (string | number | null)[]
): ColumnStats {
  const nullRate = totalRows > 0 ? Math.round((nullCount / totalRows) * 10000) / 100 : 0;
  return {
    columnName,
    dataType,
    nullRate,
    nullCount,
    uniqueCount,
    sampleValues,
  };
}

/** 组装列元数据 */
export function buildColumnInfo(
  name: string,
  type: string,
  nullable: boolean,
  defaultValue?: string,
  maxLength?: number
): ColumnInfo {
  return {
    name,
    type,
    nullable,
    defaultValue,
    maxLength,
  };
}
