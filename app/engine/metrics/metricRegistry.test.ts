import { describe, expect, it, beforeEach } from "vitest";
import { MetricRegistry, MetricsResolver } from "./metricRegistry";

describe("MetricRegistry", () => {
  let registry: MetricRegistry;

  beforeEach(() => {
    registry = new MetricRegistry();
    registry.clearResolveCache();
  });

  it("lists builtin metrics", () => {
    const ids = registry.list().map((m) => m.id);
    expect(ids).toContain("row_count");
    expect(ids).toContain("null_count");
    expect(ids).toContain("duplicate_count");
    expect(ids).toContain("distinct_count");
  });

  it("resolve deduplicates same metricId and context", () => {
    const a = registry.resolve("row_count", { table: "users" });
    const b = registry.resolve("row_count", { table: "users" });
    expect(a).toBe(b);
  });

  it("resolve returns different instances for different columns", () => {
    const a = registry.resolve("null_count", { column: "email", table: "users" });
    const b = registry.resolve("null_count", { column: "phone", table: "users" });
    expect(a).not.toBe(b);
    expect(a.cacheKey).not.toBe(b.cacheKey);
  });

  it("MetricsResolver delegates to registry", () => {
    const resolver = new MetricsResolver(registry);
    const metric = resolver.resolve("distinct_count", { column: "status" });
    expect(metric.definition.sqlFragment).toContain("COUNT(DISTINCT");
  });
});
