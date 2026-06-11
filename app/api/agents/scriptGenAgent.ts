import { stringify as stringifyYaml } from "yaml";
import type { CleaningRule, ExplorationResult, QualityReport } from "@contracts/types";
import type { AgentOutput, ScriptGenAgentOutput } from "./types";

/** 将清洗规则与质量指标转为 Soda Core 契约格式 checks YAML */
export function rulesToSodaChecksYaml(input: {
  dataset: string;
  exploration?: ExplorationResult;
  qualityReport?: QualityReport;
  rules: CleaningRule[];
}): string {
  const columns = input.exploration?.schema ?? [];
  const columnChecks: Array<Record<string, unknown>> = [];

  for (const col of columns) {
    const colRules = input.rules.filter(
      (r) => r.status === "confirmed" && (r.field === col.name || r.field === "*")
    );
    const checks: Array<Record<string, unknown>> = [];

    const nullRate =
      input.exploration?.columnStats.find((s) => s.columnName === col.name)?.nullRate ?? 0;
    if (nullRate > 0 || colRules.some((r) => r.action === "fill_null")) {
      checks.push({ missing: { name: `${col.name} 空值检查` } });
    }

    for (const rule of colRules) {
      switch (rule.action) {
        case "dedup":
          checks.push({ duplicate: { name: `${col.name} 重复检查` } });
          break;
        case "format":
          if (rule.parameters.pattern) {
            checks.push({
              invalid: {
                name: `${col.name} 格式校验`,
                "valid regex": String(rule.parameters.pattern),
              },
            });
          }
          break;
        case "fill_null":
          if (!checks.some((c) => "missing" in c)) {
            checks.push({ missing: { name: `${col.name} 空值检查` } });
          }
          break;
        default:
          break;
      }
    }

    if (checks.length > 0) {
      columnChecks.push({
        name: col.name,
        data_type: col.type,
        checks,
      });
    }
  }

  const datasetChecks: Array<Record<string, unknown>> = [{ schema: {} }];
  if (input.qualityReport) {
    datasetChecks.push({
      row_count:
        input.exploration?.totalRows != null
          ? { warn: { "when less than": Math.max(1, Math.floor(input.exploration.totalRows * 0.9)) } }
          : {},
    });
  }

  const contract = {
    dataset: input.dataset,
    columns: columnChecks,
    checks: datasetChecks,
  };

  return stringifyYaml(contract, { sortMapEntries: true });
}

/** ScriptGen Agent：生成 Soda checks YAML */
export function runScriptGenAgent(input: {
  dataset: string;
  exploration?: ExplorationResult;
  qualityReport?: QualityReport;
  rules: CleaningRule[];
}): AgentOutput<ScriptGenAgentOutput> {
  try {
    const checksYaml = rulesToSodaChecksYaml(input);
    return {
      success: true,
      data: {
        checksYaml,
        sodaChecksPath: "soda/checks.yml",
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
