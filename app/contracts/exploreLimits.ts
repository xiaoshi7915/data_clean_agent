/** 探查样本默认行数（与 exploreRouter / pipelineHelpers 默认 limit 一致） */
export const EXPLORE_SAMPLE_LIMIT = 100;

/**
 * 超过此行数时，DB 探查对列 null/distinct/重复检测改用 LIMIT 样本，
 * 避免 O(列数×行数) 多次全表扫描。
 */
export const EXPLORE_FULL_SCAN_ROW_LIMIT = 50_000;

/**
 * 超过此行数时跳过精确 COUNT(*)，改用 catalog 统计估算行数（MySQL TABLE_ROWS 等）。
 */
export const EXPLORE_APPROXIMATE_COUNT_ROW_LIMIT = 50_000;

/**
 * 文件探查超过此行数时仅读取前 N 行做列统计（总行数用行数/元数据估算）。
 */
export const FILE_EXPLORE_FULL_SCAN_ROW_LIMIT = 10_000;

/** 选表 UI 大表预警阈值（仅提示，不阻断探查） */
export const LARGE_TABLE_ROW_WARNING = 100_000;

/** 整库 batch pipeline 默认最多处理的表数量 */
export const BATCH_PIPELINE_MAX_TABLES = 10;
