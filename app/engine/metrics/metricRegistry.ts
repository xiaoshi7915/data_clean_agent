import type { MetricDefinition, MetricId, ResolvedMetric } from "./types";

/** 内置指标目录 */
const BUILTIN_METRICS: Record<MetricId, MetricDefinition> = {
  row_count: {
    id: "row_count",
    name: "行数",
    description: "表或结果集总行数",
    sqlFragment: "COUNT(*)",
  },
  null_count: {
    id: "null_count",
    name: "空值数",
    description: "指定列 NULL 或空字符串计数",
    sqlFragment: "SUM(CASE WHEN {column} IS NULL OR TRIM(CAST({column} AS CHAR)) = '' THEN 1 ELSE 0 END)",
  },
  duplicate_count: {
    id: "duplicate_count",
    name: "重复数",
    description: "指定列重复值超出 1 的行数",
    sqlFragment:
      "SUM(CASE WHEN cnt > 1 THEN cnt - 1 ELSE 0 END) FROM (SELECT {column}, COUNT(*) cnt FROM {table} GROUP BY {column}) t",
  },
  distinct_count: {
    id: "distinct_count",
    name: "去重计数",
    description: "指定列不同取值个数",
    sqlFragment: "COUNT(DISTINCT {column})",
  },
};

function buildCacheKey(metricId: MetricId, column?: string, table?: string): string {
  return `${metricId}|${column ?? "*"}|${table ?? "*"}`;
}

/** 指标注册表：注册定义 + resolve 去重缓存 */
export class MetricRegistry {
  private readonly definitions = new Map<MetricId, MetricDefinition>();
  private readonly resolvedCache = new Map<string, ResolvedMetric>();

  constructor(seed: Record<MetricId, MetricDefinition> = BUILTIN_METRICS) {
    for (const def of Object.values(seed)) {
      this.definitions.set(def.id, def);
    }
  }

  /** 注册或覆盖指标定义 */
  register(definition: MetricDefinition): void {
    this.definitions.set(definition.id, definition);
  }

  /** 按 ID 获取定义 */
  get(metricId: MetricId): MetricDefinition | undefined {
    return this.definitions.get(metricId);
  }

  /** 列出全部已注册指标 */
  list(): MetricDefinition[] {
    return [...this.definitions.values()];
  }

  /**
   * 解析指标：相同 metricId + column + table 只返回同一 ResolvedMetric 实例（去重）
   */
  resolve(metricId: MetricId, context?: { column?: string; table?: string }): ResolvedMetric {
    const column = context?.column;
    const table = context?.table;
    const cacheKey = buildCacheKey(metricId, column, table);

    const cached = this.resolvedCache.get(cacheKey);
    if (cached) return cached;

    const definition = this.definitions.get(metricId);
    if (!definition) {
      throw new Error(`未知指标: ${metricId}`);
    }

    const resolved: ResolvedMetric = {
      id: metricId,
      definition,
      cacheKey,
      column,
      table,
    };
    this.resolvedCache.set(cacheKey, resolved);
    return resolved;
  }

  /** 清空 resolve 缓存（测试或热更新用） */
  clearResolveCache(): void {
    this.resolvedCache.clear();
  }
}

/** 默认全局注册表 */
export const metricRegistry = new MetricRegistry();

/** 指标解析器门面 */
export class MetricsResolver {
  private readonly registry: MetricRegistry;

  constructor(registry: MetricRegistry = metricRegistry) {
    this.registry = registry;
  }

  resolve(metricId: MetricId, context?: { column?: string; table?: string }): ResolvedMetric {
    return this.registry.resolve(metricId, context);
  }
}
