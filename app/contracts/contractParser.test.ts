import { describe, expect, it } from "vitest";
import type { CleaningRule } from "./types";
import {
  contractToRules,
  parseCleaningContract,
  rulesToContract,
  serializeCleaningContractYaml,
} from "./contractParser";

const sampleRules: CleaningRule[] = [
  {
    id: "rule_1",
    index: 1,
    name: "空值填充",
    field: "name",
    action: "fill_null",
    strategy: "fixed",
    affectedRows: 10,
    affectedPercent: 5,
    parameters: { strategy: "fixed", fillValue: "UNKNOWN" },
    status: "confirmed",
  },
];

describe("contractParser", () => {
  it("rulesToContract / contractToRules round-trip", () => {
    const contract = rulesToContract(sampleRules, { sessionId: "sess_test", tableName: "users" });
    const back = contractToRules(contract);
    expect(back).toHaveLength(1);
    expect(back[0].field).toBe("name");
    expect(back[0].action).toBe("fill_null");
  });

  it("解析 JSON 契约", () => {
    const json = JSON.stringify({ version: "1.0", rules: sampleRules });
    const contract = parseCleaningContract(json, "json");
    expect(contract.rules[0].id).toBe("rule_1");
  });

  it("序列化为 YAML 并可再解析", () => {
    const contract = rulesToContract(sampleRules);
    const yaml = serializeCleaningContractYaml(contract);
    const parsed = parseCleaningContract(yaml, "yaml");
    expect(parsed.rules[0].field).toBe("name");
  });
});
