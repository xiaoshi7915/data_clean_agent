import type { QualityReport, QualityScore } from "@contracts/types";
import { persistAnalysis, type QualityReportPhase } from "./explorationPersistenceService";

/** 清洗前后质量指标差值 */
export interface QualityMetricsDiff {
  overall: number;
  completeness: number;
  uniqueness: number;
  consistency: number;
  validity: number;
  accuracy: number;
}

/** 计算 after - before 各维度差值 */
export function computeQualityDiff(
  before: QualityScore,
  after: QualityScore
): QualityMetricsDiff {
  return {
    overall: after.overall - before.overall,
    completeness: after.completeness - before.completeness,
    uniqueness: after.uniqueness - before.uniqueness,
    consistency: after.consistency - before.consistency,
    validity: after.validity - before.validity,
    accuracy: after.accuracy - before.accuracy,
  };
}

/** 将差值格式化为可读摘要（中文） */
export function formatQualityDiffSummary(diff: QualityMetricsDiff): string {
  const parts: string[] = [];
  const labels: Array<[keyof QualityMetricsDiff, string]> = [
    ["overall", "总分"],
    ["completeness", "完整性"],
    ["consistency", "一致性"],
    ["accuracy", "准确性"],
    ["validity", "有效性"],
    ["uniqueness", "唯一性"],
  ];
  for (const [key, label] of labels) {
    const delta = diff[key];
    if (delta === 0) continue;
    const sign = delta > 0 ? "+" : "";
    parts.push(`${label}${sign}${delta}`);
  }
  return parts.length > 0 ? parts.join("，") : "各维度无变化";
}

/**
 * 清洗执行完成后，将 after 质量报告持久化到 quality_reports（phase=after）。
 * 不替换已有清洗规则。
 */
export async function persistAfterQualityReport(
  sessionId: string,
  metricsBefore: QualityScore,
  metricsAfter: QualityScore,
  options?: { highPriorityIssues?: QualityReport["highPriorityIssues"] }
): Promise<QualityMetricsDiff> {
  const diff = computeQualityDiff(metricsBefore, metricsAfter);
  const summary = `清洗后质量对比：${formatQualityDiffSummary(diff)}`;

  const report: QualityReport = {
    score: metricsAfter,
    issues: [],
    highPriorityIssues: options?.highPriorityIssues ?? [],
    mediumPriorityIssues: [],
    lowPriorityIssues: [],
    summary,
  };

  await persistAnalysis(sessionId, report, [], {
    phase: "after" as QualityReportPhase,
    replaceRules: false,
  });

  return diff;
}
