/** 内置质量指标 ID（参考 soda-core 指标模型） */
export type MetricId =
  | "row_count"
  | "null_count"
  | "duplicate_count"
  | "distinct_count";

/** 指标定义 */
export interface MetricDefinition {
  id: MetricId;
  /** 中文展示名 */
  name: string;
  description: string;
  /** 聚合 SQL 片段模板，占位符 {column} / {table} */
  sqlFragment: string;
}

/** resolve 去重后的已解析指标 */
export interface ResolvedMetric {
  id: MetricId;
  definition: MetricDefinition;
  /** 去重键：同一 metricId + 上下文只解析一次 */
  cacheKey: string;
  column?: string;
  table?: string;
}
