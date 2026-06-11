import { describe, expect, it } from "vitest";
import { buildArtifactBundle } from "./artifactService";
import { generateCleaningSQL } from "./sqlGenerationService";
import type { CleaningRule } from "@contracts/types";

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
    expect(paths.some((p) => p.startsWith("steps/"))).toBe(true);
    expect(bundle.manifest.scriptOnly).toBe(true);
  });
});
