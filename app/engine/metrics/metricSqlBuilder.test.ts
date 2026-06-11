import { describe, expect, it, beforeEach } from "vitest";
import { MetricRegistry } from "./metricRegistry";
import { buildMetricCountSql, ExplorationMetricCollector } from "./metricSqlBuilder";
import { mysqlDialect } from "../sql/mysqlDialect";

describe("metricSqlBuilder", () => {
  let registry: MetricRegistry;

  beforeEach(() => {
    registry = new MetricRegistry();
    registry.clearResolveCache();
  });

  it("builds row_count SQL", () => {
    const resolved = registry.resolve("row_count", { table: "users" });
    const sql = buildMetricCountSql(resolved, mysqlDialect, "users");
    expect(sql).toBe("SELECT COUNT(*) AS cnt FROM `users`");
  });

  it("builds null_count SQL with column placeholder", () => {
    const resolved = registry.resolve("null_count", { column: "email", table: "users" });
    const sql = buildMetricCountSql(resolved, mysqlDialect, "users");
    expect(sql).toContain("SUM(CASE WHEN `email` IS NULL");
    expect(sql).toContain("FROM `users`");
  });

  it("ExplorationMetricCollector deduplicates resolve via registry", () => {
    const collector = new ExplorationMetricCollector(mysqlDialect, "orders", (metricId, column) =>
      registry.resolve(metricId, { column, table: "orders" })
    );
    const a = collector.buildCountSql("distinct_count", "status");
    const b = collector.buildCountSql("distinct_count", "status");
    expect(a).toBe(b);
    expect(a).toContain("COUNT(DISTINCT `status`)");
  });
});
