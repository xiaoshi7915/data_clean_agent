import type { CleaningRule, ExplorationResult, QualityReport } from "@contracts/types";
import { generateCleaningRules } from "./analysisService";

/**
 * 元数据驱动智能清洗（P2-R1 MVP stub）
 * 从探查 schema/stats 生成推荐规则，供后续 LLM 或一键应用。
 */
export function metadataRulesFromExploration(
  exploration: ExplorationResult,
  report: QualityReport
): CleaningRule[] {
  return generateCleaningRules(exploration, report);
}

/** 是否具备可推断的 schema 元数据 */
export function hasExplorationMetadata(exploration: ExplorationResult): boolean {
  return exploration.schema.length > 0 && exploration.columnStats.length > 0;
}
