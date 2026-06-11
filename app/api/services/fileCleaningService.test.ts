import { describe, expect, it } from "vitest";
import type { CleaningRule } from "@contracts/types";
import { applyCleaningRulesToRows } from "./fileCleaningService";

function makeRule(partial: Partial<CleaningRule> & Pick<CleaningRule, "field" | "action">): CleaningRule {
  const { parameters: ruleParams, ...rest } = partial;
  return {
    id: "R1",
    index: 1,
    name: "test",
    issueDescription: "",
    strategy: "",
    affectedRows: 1,
    affectedPercent: 1,
    status: "confirmed",
    ...rest,
    parameters: { ...ruleParams },
  };
}

describe("fileCleaningService P1 rule handlers", () => {
  it("flags encoding_detect mojibake", () => {
    const rules = [
      makeRule({
        field: "text",
        action: "standardize",
        parameters: { type: "encoding_detect", invalidAction: "flag" },
      }),
    ];
    const rows = [{ text: "Ã©Â®" }];
    const out = applyCleaningRulesToRows(rows, rules, ["text"]);
    expect(String(out[0].text)).toContain("ENCODING_ERROR");
  });

  it("validates cross_field birth < hire", () => {
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
    const rows = [
      { birth_date: "2020-01-01", hire_date: "2019-01-01" },
      { birth_date: "1990-01-01", hire_date: "2020-01-01" },
    ];
    const out = applyCleaningRulesToRows(rows, rules, ["birth_date", "hire_date"]);
    expect(out[0].hire_date).toBeNull();
    expect(out[1].hire_date).toBe("2020-01-01");
  });

  it("maps fk_reference via dictMap", () => {
    const rules = [
      makeRule({
        field: "code",
        action: "standardize",
        parameters: {
          type: "fk_reference",
          dictMap: { "1": "active", "2": "inactive" },
        },
      }),
    ];
    const rows = [{ code: "1" }];
    const out = applyCleaningRulesToRows(rows, rules, ["code"]);
    expect(out[0].code).toBe("active");
  });

  it("marks duplicate_timestamp rows", () => {
    const rules = [
      makeRule({
        field: "ts",
        action: "standardize",
        parameters: { type: "duplicate_timestamp" },
      }),
    ];
    const rows = [{ ts: "2024-01-01" }, { ts: "2024-01-01" }];
    const out = applyCleaningRulesToRows(rows, rules, ["ts"]);
    expect(out[1].ts_dup_flag).toBe("DUPLICATE_TIMESTAMP");
  });
});
