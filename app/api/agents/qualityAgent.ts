import { generateCleaningRules, generateQualityReport } from "../services/analysisService";
import type { AgentInput, AgentOutput, QualityAgentOutput, VerificationResult } from "./types";
import type { CleaningRule, ExplorationResult } from "@contracts/types";

/** 质量分析 Agent：生成质量报告与清洗规则 */
export function runQualityAgent(
  input: AgentInput & { exploration: ExplorationResult }
): AgentOutput<QualityAgentOutput> {
  try {
    const report = generateQualityReport(input.exploration);
    const rules = generateCleaningRules(input.exploration, report);
    return { success: true, data: { report, rules } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface RulePatchSuggestion {
  ruleId: string;
  field: string;
  suggestion: string;
  patchedParameters?: Record<string, unknown>;
}

/**
 * 根据外部校验失败结果，建议规则修补方案
 */
export function diagnose(
  verification: VerificationResult,
  rules: CleaningRule[]
): RulePatchSuggestion[] {
  const suggestions: RulePatchSuggestion[] = [];
  const details = verification.details ?? verification.rawOutput ?? "";

  for (const rule of rules.filter((r) => r.status === "confirmed")) {
    if (details.includes(rule.field) || details.includes(rule.name)) {
      switch (rule.action) {
        case "fill_null":
          suggestions.push({
            ruleId: rule.id,
            field: rule.field,
            suggestion: `字段 ${rule.field} 仍有空值，建议将 fillValue 改为更严格的默认值或增加 not_null 前置过滤`,
            patchedParameters: { ...rule.parameters, fillValue: "UNKNOWN" },
          });
          break;
        case "format":
          suggestions.push({
            ruleId: rule.id,
            field: rule.field,
            suggestion: `字段 ${rule.field} 格式校验失败，建议收紧正则或增加 standardize 步骤`,
          });
          break;
        case "dedup":
          suggestions.push({
            ruleId: rule.id,
            field: rule.field,
            suggestion: `字段 ${rule.field} 仍存在重复，建议增加唯一键约束或扩展 dedup 范围`,
          });
          break;
        default:
          suggestions.push({
            ruleId: rule.id,
            field: rule.field,
            suggestion: `规则「${rule.name}」可能需要调整参数以通过校验`,
          });
      }
    }
  }

  if (suggestions.length === 0 && verification.status === "fail") {
    suggestions.push({
      ruleId: "global",
      field: "*",
      suggestion: "校验未通过但未定位到具体字段，建议重新运行质量分析并检查 Soda checks 配置",
    });
  }

  return suggestions;
}
