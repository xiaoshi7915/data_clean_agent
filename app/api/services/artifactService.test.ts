import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildArtifactBundle, exportZip } from "./artifactService";
import { generateCleaningSQL } from "./sqlGenerationService";
import type { CleaningRule } from "@contracts/types";

vi.mock("../agents/orchestrator", () => ({
  createOrchestratorContext: vi.fn(),
  startRun: vi.fn().mockResolvedValue({ runId: "run_test", ctx: { state: "schema_explore" } }),
  runScriptOnlyPipeline: vi.fn().mockResolvedValue({ state: "done" }),
}));

const rules: CleaningRule[] = [
  {
    id: "r1",
    index: 1,
    name: "空值填充",
    field: "name",
    action: "fill_null",
    affectedRows: 5,
    affectedPercent: 2,
    parameters: { fillValue: "UNKNOWN" },
    status: "confirmed",
  },
];

describe("artifactService", () => {
  it("buildArtifactBundle 包含标准目录结构", () => {
    const sqlResult = generateCleaningSQL(rules, "mysql", "users", "mydb", ["name"]);
    const bundle = buildArtifactBundle({
      sessionId: "sess_test",
      rules,
      sqlResult,
      dialect: "mysql",
      tableName: "users",
      databaseName: "mydb",
    });

    const paths = bundle.files.map((f) => f.path);
    expect(paths).toContain("cleaning.sql");
    expect(paths).toContain("contract.yaml");
    expect(paths).toContain("soda/checks.yml");
    expect(paths).toContain("manifest.json");
    expect(paths).toContain("README.md");
    expect(paths.some((p) => p.match(/^steps\/\d{2}_/))).toBe(true);
    expect(bundle.manifest.scriptOnly).toBe(true);
  });

  it("includeDbt 生成 dbt 子目录", () => {
    const sqlResult = generateCleaningSQL(rules, "mysql", "users", "mydb", ["name"]);
    const bundle = buildArtifactBundle({
      sessionId: "sess_test",
      rules,
      sqlResult,
      dialect: "mysql",
      tableName: "users",
      databaseName: "mydb",
      options: { includeDbt: true },
    });
    const paths = bundle.files.map((f) => f.path);
    expect(paths).toContain("dbt/models/staging/stg_users_cleaned.sql");
    expect(paths).toContain("dbt/schema.yml");
    expect((bundle.manifest.artifacts as Record<string, unknown>)?.includeDbt).toBe(true);
  });

  it("includeScheduling 生成 Airflow DAG 片段", () => {
    const sqlResult = generateCleaningSQL(rules, "mysql", "users", "mydb", ["name"]);
    const bundle = buildArtifactBundle({
      rules,
      sqlResult,
      dialect: "mysql",
      tableName: "users",
      databaseName: "mydb",
      options: { includeScheduling: true },
    });
    const paths = bundle.files.map((f) => f.path);
    expect(paths).toContain("scheduling/airflow/dag_snippet.py");
    expect((bundle.manifest.scheduling as Record<string, unknown>)?.dbt).toBeDefined();
  });

  it("exportZip 返回非空 Buffer", async () => {
    const sqlResult = generateCleaningSQL(rules, "mysql", "users", "mydb", ["name"]);
    const bundle = buildArtifactBundle({
      rules,
      sqlResult,
      dialect: "mysql",
      tableName: "users",
      databaseName: "mydb",
    });
    const zip = await exportZip(bundle);
    expect(zip.length).toBeGreaterThan(100);
    expect(zip[0]).toBe(0x50); // PK zip magic
    expect(zip[1]).toBe(0x4b);
  });
});
