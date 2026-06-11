import { describe, expect, it } from "vitest";
import path from "node:path";
import { parseArgs, resolveDialect, loadContractRules } from "./args";
import { generateCleaningSQL } from "../api/services/sqlGenerationService";

describe("cli args", () => {
  it("parseArgs 解析 flag 与键值", () => {
    const args = parseArgs(["--contract", "a.yaml", "--dry-run", "--table", "users"]);
    expect(args.contract).toBe("a.yaml");
    expect(args["dry-run"]).toBe(true);
    expect(args.table).toBe("users");
  });

  it("parseArgs 布尔 flag 无值", () => {
    const args = parseArgs(["--dry-run"]);
    expect(args["dry-run"]).toBe(true);
  });

  it("resolveDialect 优先 CLI type", () => {
    expect(resolveDialect({ type: "postgresql" }, "mysql")).toBe("postgresql");
    expect(resolveDialect({}, "postgresql")).toBe("postgresql");
    expect(resolveDialect({})).toBe("mysql");
  });
});

describe("cli compile fixture", () => {
  it("从契约模版编译 SQL（无真实数据库）", () => {
    const fixture = path.join(import.meta.dirname, "../contracts/contract-template.yaml");
    const { contract, rules } = loadContractRules(fixture);
    expect(contract.version).toBe("1.0");
    expect(rules.length).toBeGreaterThan(0);

    const tableName = contract.metadata?.tableName ?? "data";
    const databaseName = contract.metadata?.databaseName ?? "default";
    const dialect = resolveDialect({}, contract.metadata?.dialect);

    const sql = generateCleaningSQL(
      rules,
      dialect,
      tableName,
      databaseName,
      rules.map((r) => r.field).filter((f) => f !== "*")
    );

    expect(sql.steps.length).toBeGreaterThan(0);
    expect(sql.targetTable).toContain("_cleaned");
  });
});
