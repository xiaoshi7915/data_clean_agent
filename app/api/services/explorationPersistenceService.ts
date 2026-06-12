import { desc, eq, and } from "drizzle-orm";
import { explorationResults, qualityReports, cleaningRules } from "@db/schema";
import { getDb } from "../queries/connection";
import {
  updateSessionPhase,
  updateSessionTargetTable,
  updateSessionTitle,
} from "./sessionService";
import { getCurrentRunIndex } from "./pipelineRunService";
import type {
  CleaningAction,
  CleaningRule,
  ExplorationResult,
  QualityReport,
  RuleStatus,
} from "@contracts/types";

/** 质量报告阶段：清洗前基线 / 清洗后对比 */
export type QualityReportPhase = "before" | "after";

export interface PersistExplorationOptions {
  /** 目标表名（数据库探查时写入会话） */
  tableName?: string;
  /** 会话 last_action 标记 */
  lastAction?: "db_explored" | "file_explored";
  /** 探查完成后更新会话标题 */
  sessionTitle?: string;
}

/**
 * 将探查结果写入 exploration_results，并同步会话阶段/目标表。
 * exploreRouter 与 orchestrator 共用此逻辑，避免双轨持久化。
 */
export async function persistExploration(
  sessionId: string,
  result: ExplorationResult,
  options: PersistExplorationOptions = {}
): Promise<void> {
  const db = getDb();
  const runIndex = await getCurrentRunIndex(sessionId);

  // 同一 run 内重新探查时替换旧结果
  await db
    .delete(explorationResults)
    .where(
      and(
        eq(explorationResults.sessionId, sessionId),
        eq(explorationResults.runIndex, runIndex)
      )
    );

  await db.insert(explorationResults).values({
    sessionId,
    runIndex,
    sourceType: result.sourceType,
    sourceName: result.sourceName,
    totalRows: result.totalRows,
    totalCols: result.totalCols,
    schema: result.schema,
    sampleData: result.sampleData,
    columnStats: result.columnStats,
    issues: result.issues,
  });

  await updateSessionPhase(sessionId, "explore", options.lastAction ?? "db_explored");

  if (options.tableName) {
    await updateSessionTargetTable(sessionId, options.tableName);
  }

  if (options.sessionTitle) {
    await updateSessionTitle(sessionId, options.sessionTitle);
  } else if (options.tableName) {
    await updateSessionTitle(sessionId, `${options.tableName} · 探查完成`);
  }
}

export interface PersistAnalysisOptions {
  /** 报告阶段：before=清洗前基线，after=清洗后对比 */
  phase?: QualityReportPhase;
  /** 重新分析时是否替换已有规则（默认 true） */
  replaceRules?: boolean;
}

/**
 * 将质量报告与清洗规则写入会话表。
 * analyzeRouter 与 orchestrator 共用此逻辑。
 */
export async function persistAnalysis(
  sessionId: string,
  report: QualityReport,
  rules: CleaningRule[],
  options: PersistAnalysisOptions = {}
): Promise<void> {
  const phase = options.phase ?? "before";
  const replaceRules = options.replaceRules !== false;

  const db = getDb();
  const runIndex = await getCurrentRunIndex(sessionId);

  await db.insert(qualityReports).values({
    sessionId,
    runIndex,
    phase,
    overallScore: report.score.overall,
    completenessScore: report.score.completeness,
    uniquenessScore: report.score.uniqueness,
    consistencyScore: report.score.consistency,
    validityScore: report.score.validity,
    accuracyScore: report.score.accuracy,
    highPriorityIssues: report.highPriorityIssues,
    mediumPriorityIssues: report.mediumPriorityIssues,
    lowPriorityIssues: report.lowPriorityIssues,
    summary: report.summary,
  });

  if (replaceRules) {
    await db
      .delete(cleaningRules)
      .where(
        and(
          eq(cleaningRules.sessionId, sessionId),
          eq(cleaningRules.runIndex, runIndex)
        )
      );
  }

  for (const rule of rules) {
    await db.insert(cleaningRules).values({
      sessionId,
      runIndex,
      ruleId: rule.id,
      ruleIndex: rule.index,
      name: rule.name,
      field: rule.field,
      action: rule.action as CleaningAction,
      issueDescription: rule.issueDescription ?? null,
      strategy: rule.strategy ?? null,
      affectedRows: rule.affectedRows,
      affectedPercent: String(rule.affectedPercent),
      parameters: rule.parameters,
      status: rule.status as RuleStatus,
      riskNote: rule.riskNote ?? null,
    });
  }

  await updateSessionPhase(sessionId, "analyze", "analyzed");
}

/** 从 DB 加载最新探查结果（编排器 slim context 回退用） */
export async function loadLatestExploration(
  sessionId: string,
  runIndex?: number
): Promise<ExplorationResult | null> {
  const db = getDb();
  const effectiveRunIndex = runIndex ?? (await getCurrentRunIndex(sessionId));
  const rows = await db
    .select()
    .from(explorationResults)
    .where(
      and(
        eq(explorationResults.sessionId, sessionId),
        eq(explorationResults.runIndex, effectiveRunIndex)
      )
    )
    .orderBy(desc(explorationResults.createdAt))
    .limit(1);

  const e = rows[0];
  if (!e) return null;

  return {
    sourceType: e.sourceType as ExplorationResult["sourceType"],
    sourceName: e.sourceName,
    totalRows: e.totalRows,
    totalCols: e.totalCols,
    schema: e.schema as ExplorationResult["schema"],
    sampleData: e.sampleData as ExplorationResult["sampleData"],
    columnStats: e.columnStats as ExplorationResult["columnStats"],
    sampleSize: (e.sampleData as unknown[]).length,
    issues: (e.issues as ExplorationResult["issues"]) || [],
  };
}
