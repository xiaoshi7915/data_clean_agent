import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { parseArgs, resolveDialect, loadContractRules } from "./args";
import { generateCleaningSQL } from "../api/services/sqlGenerationService";
import { isScriptOnlyExecuteBlocked, SCRIPT_ONLY_EXECUTE_MESSAGE } from "./executeGuard";

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

describe("SCRIPT_ONLY execute guard", () => {
  it("默认拦截非 dry-run 真实执行", async () => {
    vi.stubEnv("ALLOW_EXECUTE", "");
    vi.resetModules();
    const { isScriptOnlyExecuteBlocked: blocked, SCRIPT_ONLY_EXECUTE_MESSAGE: msg } =
      await import("./executeGuard");
    expect(blocked(false)).toBe(true);
    expect(blocked(true)).toBe(false);
    expect(msg).toMatch(/SCRIPT_ONLY/);
  });

  it("ALLOW_EXECUTE=true 时允许真实执行", async () => {
    vi.stubEnv("ALLOW_EXECUTE", "true");
    vi.resetModules();
    const { isScriptOnlyExecuteBlocked: blocked } = await import("./executeGuard");
    expect(blocked(false)).toBe(false);
  });

  it("isScriptOnlyExecuteBlocked 与模块级导出一致", () => {
    vi.stubEnv("ALLOW_EXECUTE", "");
    expect(SCRIPT_ONLY_EXECUTE_MESSAGE).toContain("dry-run");
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
