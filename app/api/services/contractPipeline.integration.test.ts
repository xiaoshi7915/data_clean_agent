import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  parseCleaningContract,
  contractToRules,
  rulesToContract,
} from "@contracts/contractParser";
import { generateCleaningSQL } from "./sqlGenerationService";
import { runSqlSteps } from "../../engine/execution/runSqlSteps";
import type { SqlExecutor } from "../../engine/execution/sqlExecutor";

const fixturePath = path.join(import.meta.dirname, "../../contracts/contract-template.yaml");

describe("contract pipeline integration", () => {
  it("YAML → rulesToContract → generateCleaningSQL → dry-run execute", async () => {
    const yaml = readFileSync(fixturePath, "utf8");
    const contract = parseCleaningContract(yaml, "yaml");
    const rules = contractToRules(contract).map((r) =>
      r.status === "confirmed" ? r : { ...r, status: "confirmed" as const }
    );

    expect(rules.length).toBeGreaterThan(0);

    const roundTrip = rulesToContract(rules, { tableName: "users", databaseName: "mydb" });
    expect(roundTrip.rules.length).toBe(rules.length);

    const sql = generateCleaningSQL(rules, "mysql", "users", "mydb", ["name", "email"]);
    expect(sql.steps.length).toBeGreaterThan(0);
    expect(sql.targetDialect).toBe("mysql");

    const executeMock = vi.fn(async (sqlText: string) => {
      if (/SELECT/i.test(sqlText)) {
        return { affectedRows: 0, rows: [{ cnt: 5 }] };
      }
      return { affectedRows: 0, rows: [] };
    });

    const executor: SqlExecutor = { execute: executeMock };

    const result = await runSqlSteps({
      sessionId: "test_sess",
      steps: sql.steps,
      executor,
      dryRun: true,
      metricsBefore: {
        overall: 70,
        completeness: 70,
        uniqueness: 80,
        consistency: 75,
        validity: 70,
        accuracy: 70,
      },
    });

    expect(result.overallStatus).toBe("success");
    expect(executeMock).toHaveBeenCalled();
  });

  it("PostgreSQL 方言可生成 SQL", () => {
    const yaml = readFileSync(fixturePath, "utf8");
    const rules = contractToRules(parseCleaningContract(yaml, "yaml")).map((r) => ({
      ...r,
      status: "confirmed" as const,
    }));
    const sql = generateCleaningSQL(rules, "postgresql", "users", "mydb", ["name"]);
    expect(sql.targetDialect).toBe("postgresql");
    expect(sql.steps.some((s) => s.sql.length > 0)).toBe(true);
  });
});
