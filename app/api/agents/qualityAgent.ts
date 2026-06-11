import { generateCleaningRules, generateQualityReport } from "../services/analysisService";
import type { AgentInput, AgentOutput, QualityAgentOutput } from "./types";
import type { ExplorationResult } from "@contracts/types";

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
