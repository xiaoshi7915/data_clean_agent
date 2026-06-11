import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  cleaningContractSchema,
  type CleaningContract,
} from "./cleaning-contract.schema";
import type { CleaningRule } from "./types";

export class ContractParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractParseError";
  }
}

/** 解析 JSON 或 YAML 文本为 CleaningContract */
export function parseCleaningContract(source: string, format: "json" | "yaml" | "auto" = "auto"): CleaningContract {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new ContractParseError("契约内容为空");
  }

  let raw: unknown;
  const resolvedFormat =
    format === "auto"
      ? trimmed.startsWith("{") || trimmed.startsWith("[")
        ? "json"
        : "yaml"
      : format;

  try {
    if (resolvedFormat === "json") {
      raw = JSON.parse(trimmed);
    } else {
      raw = parseYaml(trimmed);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ContractParseError(`无法解析 ${resolvedFormat.toUpperCase()}：${message}`);
  }

  const parsed = cleaningContractSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ContractParseError(parsed.error.message);
  }
  return parsed.data;
}

/** CleaningContract → JSON 字符串 */
export function serializeCleaningContractJson(contract: CleaningContract): string {
  return JSON.stringify(contract, null, 2);
}

/** CleaningContract → YAML 字符串 */
export function serializeCleaningContractYaml(contract: CleaningContract): string {
  return stringifyYaml(contract, { sortMapEntries: true });
}

/** 数据库 cleaning_rules 行 → CleaningContract */
export function rulesToContract(
  rules: CleaningRule[],
  metadata?: CleaningContract["metadata"]
): CleaningContract {
  const contract = cleaningContractSchema.parse({
    version: "1.0",
    metadata: {
      exportedAt: new Date().toISOString(),
      ...metadata,
    },
    rules: rules.map((rule) => ({
      ...rule,
      parameters: rule.parameters ?? {},
    })),
  });
  return contract;
}

/** CleaningContract → CleaningRule[]（供写回 DB） */
export function contractToRules(contract: CleaningContract): CleaningRule[] {
  return contract.rules.map((rule, idx) => ({
    ...rule,
    index: rule.index ?? idx + 1,
    parameters: rule.parameters ?? {},
  }));
}
