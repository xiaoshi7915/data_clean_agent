import type { SqlDialect } from "../sql/dialect";
import type { MetricId, ResolvedMetric } from "./types";

/** 将指标 SQL 片段中的 {column} / {table} 占位符替换为方言引用 */
function applyMetricPlaceholders(
  fragment: string,
  dialect: SqlDialect,
  tableName: string,
  column?: string
): string {
  const quotedTable = dialect.quoteTable(tableName);
  let sql = fragment.replace(/\{table\}/g, quotedTable);
  if (column) {
    sql = sql.replace(/\{column\}/g, dialect.quoteIdentifier(column));
  }
  return sql;
}

/**
 * 根据已解析指标生成单行 COUNT 查询 SQL（返回别名为 cnt）
 * 供 exploreDatabase 与质量报告复用，避免各处手写 COUNT 逻辑
 */
export function buildMetricCountSql(
  resolved: ResolvedMetric,
  dialect: SqlDialect,
  tableName: string
): string {
  const { id, definition, column } = resolved;
  const table = dialect.quoteTable(tableName);

  switch (id) {
    case "row_count":
      return `SELECT ${definition.sqlFragment} AS cnt FROM ${table}`;
    case "null_count": {
      if (!column) {
        throw new Error("null_count 指标需要 column 上下文");
      }
      const expr = applyMetricPlaceholders(definition.sqlFragment, dialect, tableName, column);
      return `SELECT ${expr} AS cnt FROM ${table}`;
    }
    case "distinct_count": {
      if (!column) {
        throw new Error("distinct_count 指标需要 column 上下文");
      }
      const expr = applyMetricPlaceholders(definition.sqlFragment, dialect, tableName, column);
      return `SELECT ${expr} AS cnt FROM ${table}`;
    }
    case "duplicate_count": {
      if (!column) {
        throw new Error("duplicate_count 指标需要 column 上下文");
      }
      const quotedCol = dialect.quoteIdentifier(column);
      const inner = applyMetricPlaceholders(definition.sqlFragment, dialect, tableName, column);
      return `SELECT ${inner} AS cnt FROM (SELECT ${quotedCol}, COUNT(*) cnt FROM ${table} GROUP BY ${quotedCol}) t`;
    }
    default: {
      const _exhaustive: never = id;
      throw new Error(`未支持的指标: ${String(_exhaustive)}`);
    }
  }
}

/** 探查阶段指标收集器：resolve 去重 + 统一 SQL 生成 */
export class ExplorationMetricCollector {
  private readonly dialect: SqlDialect;
  private readonly tableName: string;
  private readonly resolveFn: (metricId: MetricId, column?: string) => ResolvedMetric;

  constructor(
    dialect: SqlDialect,
    tableName: string,
    resolveFn: (metricId: MetricId, column?: string) => ResolvedMetric
  ) {
    this.dialect = dialect;
    this.tableName = tableName;
    this.resolveFn = resolveFn;
  }

  /** 生成指标 COUNT SQL（同一 metricId+column 经 registry resolve 去重） */
  buildCountSql(metricId: MetricId, column?: string): string {
    const resolved = this.resolveFn(metricId, column);
    return buildMetricCountSql(resolved, this.dialect, this.tableName);
  }
}
