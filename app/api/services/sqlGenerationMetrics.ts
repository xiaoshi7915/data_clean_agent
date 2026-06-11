import type { DatabaseDialect } from "@contracts/types";
import { metricRegistry } from "../../engine/metrics/metricRegistry";
import { buildMetricCountSql } from "../../engine/metrics/metricSqlBuilder";
import { mysqlDialect } from "../../engine/sql/mysqlDialect";
import { postgresDialect } from "../../engine/sql/postgresDialect";
import type { SqlDialect } from "../../engine/sql/dialect";

/** 方言 → SqlDialect 实例（供 MetricRegistry 生成 COUNT） */
export function dialectToSqlDialect(dialect: DatabaseDialect): SqlDialect {
  if (dialect === "mysql") return mysqlDialect;
  if (dialect === "postgresql") return postgresDialect;
  return mysqlDialect;
}

/** 生成验证步骤用的行数 COUNT SQL（MetricRegistry row_count） */
export function buildRowCountValidationSql(
  tableName: string,
  dialect: DatabaseDialect
): string {
  const sqlDialect = dialectToSqlDialect(dialect);
  const resolved = metricRegistry.resolve("row_count", { table: tableName });
  const inner = buildMetricCountSql(resolved, sqlDialect, tableName);
  return inner.replace(/ AS cnt$/i, " AS total_rows");
}

/** 生成列空值 COUNT SQL（MetricRegistry null_count） */
export function buildNullCountSql(
  tableName: string,
  column: string,
  dialect: DatabaseDialect
): string {
  const sqlDialect = dialectToSqlDialect(dialect);
  const resolved = metricRegistry.resolve("null_count", { column, table: tableName });
  return buildMetricCountSql(resolved, sqlDialect, tableName);
}
