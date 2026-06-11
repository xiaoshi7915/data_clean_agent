import { describe, expect, it } from "vitest";
import type { CleaningRule } from "@contracts/types";
import { generateCleaningSQL } from "./sqlGenerationService";

function makeRule(partial: Partial<CleaningRule> & Pick<CleaningRule, "field" | "action">): CleaningRule {
  const { parameters: ruleParams, ...rest } = partial;
  return {
    id: "R1",
    index: 1,
    name: "test",
    issueDescription: "",
    strategy: "",
    affectedRows: 10,
    affectedPercent: 5,
    status: "confirmed",
    ...rest,
    parameters: { ...ruleParams },
  };
}

describe("sqlGenerationService P1 rule generators", () => {
  it("generates FULLWIDTH REPLACE chain for format FULLWIDTH", () => {
    const rules = [
      makeRule({
        field: "code",
        action: "format",
        parameters: { format: "FULLWIDTH" },
      }),
    ];
    const result = generateCleaningSQL(rules, "mysql", "t_users", "db", ["code"]);
    expect(result.consolidatedSql).toContain("REPLACE");
    expect(result.consolidatedSql).toContain("'０'");
    expect(result.consolidatedSql).toContain("'0'");
  });

  it("generates window FIRST_VALUE ffill expression", () => {
    const rules = [
      makeRule({
        field: "value",
        action: "fill_null",
        parameters: { strategy: "ffill", treatEmptyAsNull: true },
      }),
    ];
    const result = generateCleaningSQL(rules, "mysql", "t_ts", "db", ["value", "id"]);
    expect(result.consolidatedSql).toContain("FIRST_VALUE");
  });

  it("generates cross_field CASE WHEN SQL", () => {
    const rules = [
      makeRule({
        field: "hire_date",
        action: "standardize",
        parameters: {
          type: "cross_field",
          fields: ["birth_date", "hire_date"],
          operator: "<",
          action: "null",
        },
      }),
    ];
    const result = generateCleaningSQL(
      rules,
      "mysql",
      "t_emp",
      "db",
      ["birth_date", "hire_date"]
    );
    expect(result.consolidatedSql).toContain("birth_date");
    expect(result.consolidatedSql).toContain("hire_date");
    expect(result.consolidatedSql).toMatch(/THEN NULL/);
  });

  it("generates fk_reference allowedValues IN list", () => {
    const rules = [
      makeRule({
        field: "status_code",
        action: "standardize",
        parameters: {
          type: "fk_reference",
          allowedValues: ["A", "B"],
        },
      }),
    ];
    const result = generateCleaningSQL(rules, "mysql", "t_status", "db", ["status_code"]);
    expect(result.consolidatedSql).toContain("'A'");
    expect(result.consolidatedSql).toContain("'B'");
    expect(result.consolidatedSql).toContain("IN (");
  });

  it("generates encoding_detect and encoding_fix branches", () => {
    const rules = [
      makeRule({
        field: "note",
        action: "standardize",
        parameters: { type: "encoding_detect" },
      }),
    ];
    const result = generateCleaningSQL(rules, "mysql", "t_note", "db", ["note"]);
    expect(result.consolidatedSql).toContain("ENCODING_ERROR");
    expect(result.consolidatedSql).toContain("utf8mb4");
  });
});
