import type { DatabaseDialect } from "@contracts/types";
import {
  EXPLORE_APPROXIMATE_COUNT_ROW_LIMIT,
  EXPLORE_FULL_SCAN_ROW_LIMIT,
  EXPLORE_SAMPLE_LIMIT,
} from "@contracts/exploreLimits";

/** 是否应对列统计使用样本而非全表扫描 */
export function shouldUseSampleStats(totalRows: number): boolean {
  return totalRows > EXPLORE_FULL_SCAN_ROW_LIMIT;
}

/** 是否应跳过精确 COUNT，改用 catalog 估算行数 */
export function shouldUseApproximateRowCount(estimatedRows: number): boolean {
  return estimatedRows > EXPLORE_APPROXIMATE_COUNT_ROW_LIMIT;
}

/** 样本统计时用于 nullCount 外推的全表行数 */
export function scaleNullCountFromSample(
  sampleNullCount: number,
  statsRowCount: number,
  totalRows: number
): number {
  if (statsRowCount <= 0) return 0;
  return Math.round((sampleNullCount / statsRowCount) * totalRows);
}

/** 样本模式下的有效统计行数 */
export function resolveStatsRowCount(totalRows: number, sampleLimit: number): number {
  const useSampleStats = shouldUseSampleStats(totalRows);
  return useSampleStats ? Math.min(sampleLimit, totalRows) : totalRows;
}

/** 各方言列统计采样子查询（FROM 子句片段） */
export function buildSampleStatsFromClause(
  dialect: DatabaseDialect,
  quotedTable: string,
  sampleLimit: number
): string {
  const limit = Math.max(1, Math.min(Math.floor(sampleLimit) || EXPLORE_SAMPLE_LIMIT, EXPLORE_SAMPLE_LIMIT));
  switch (dialect) {
    case "mysql":
    case "postgresql":
    case "sqlite":
      return `(SELECT * FROM ${quotedTable} LIMIT ${limit}) AS _explore_sample`;
    case "sqlserver":
      return `(SELECT TOP ${limit} * FROM ${quotedTable}) AS _explore_sample`;
    case "oracle":
      return `(SELECT * FROM ${quotedTable} FETCH FIRST ${limit} ROWS ONLY) _explore_sample`;
    default: {
      const _exhaustive: never = dialect;
      return _exhaustive;
    }
  }
}
