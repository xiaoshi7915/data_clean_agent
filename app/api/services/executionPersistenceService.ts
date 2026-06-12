import { eq, and, desc } from "drizzle-orm";
import { executionLogs } from "@db/schema";
import { getDb } from "../queries/connection";
import { getCurrentRunIndex } from "./pipelineRunService";
import type { ExecutionResult } from "@contracts/types";

export interface PersistExecutionOptions {
  /** dry-run 也写入日志，便于对比历史 */
  dryRun?: boolean;
}

/**
 * 将 SQL/文件清洗执行结果写入 execution_logs（按当前 run_index）。
 * executeRouter 与 orchestrator 共用，便于切换运行版本时加载执行历史。
 */
export async function persistExecution(
  sessionId: string,
  result: ExecutionResult,
  _options: PersistExecutionOptions = {}
): Promise<void> {
  const db = getDb();
  const runIndex = await getCurrentRunIndex(sessionId);

  // 同一 run 内再次执行时保留多条记录；加载时取最新一条
  await db.insert(executionLogs).values({
    sessionId,
    runIndex,
    executionId: result.executionId,
    overallStatus: result.overallStatus,
    stepResults: result.stepResults,
    metricsBefore: result.metricsBefore,
    metricsAfter: result.metricsAfter ?? null,
    backupTableName: result.backupTableName ?? null,
    startedAt: new Date(result.startedAt),
    completedAt: result.completedAt ? new Date(result.completedAt) : null,
    error: result.error ?? null,
  });
}

/** 读取指定 run 的执行记录（最新在前） */
export async function loadExecutionHistory(
  sessionId: string,
  runIndex?: number,
  limit: number = 10
): Promise<ExecutionResult[]> {
  const db = getDb();
  const effectiveRunIndex = runIndex ?? (await getCurrentRunIndex(sessionId));
  const rows = await db
    .select()
    .from(executionLogs)
    .where(
      and(
        eq(executionLogs.sessionId, sessionId),
        eq(executionLogs.runIndex, effectiveRunIndex)
      )
    )
    .orderBy(desc(executionLogs.createdAt))
    .limit(limit);

  return rows.map((x) => ({
    executionId: x.executionId,
    overallStatus: x.overallStatus,
    stepResults: (x.stepResults as ExecutionResult["stepResults"]) || [],
    metricsBefore: x.metricsBefore as ExecutionResult["metricsBefore"],
    metricsAfter: x.metricsAfter as ExecutionResult["metricsAfter"],
    backupTableName: x.backupTableName || undefined,
    startedAt: x.startedAt.toISOString(),
    completedAt: x.completedAt?.toISOString(),
    error: x.error || undefined,
  }));
}

/** 读取指定 run 最新一条执行记录 */
export async function loadLatestExecution(
  sessionId: string,
  runIndex?: number
): Promise<ExecutionResult | null> {
  const db = getDb();
  const effectiveRunIndex = runIndex ?? (await getCurrentRunIndex(sessionId));
  const rows = await db
    .select()
    .from(executionLogs)
    .where(
      and(
        eq(executionLogs.sessionId, sessionId),
        eq(executionLogs.runIndex, effectiveRunIndex)
      )
    )
    .orderBy(desc(executionLogs.createdAt))
    .limit(1);

  const x = rows[0];
  if (!x) return null;

  return {
    executionId: x.executionId,
    overallStatus: x.overallStatus,
    stepResults: (x.stepResults as ExecutionResult["stepResults"]) || [],
    metricsBefore: x.metricsBefore as ExecutionResult["metricsBefore"],
    metricsAfter: x.metricsAfter as ExecutionResult["metricsAfter"],
    backupTableName: x.backupTableName || undefined,
    startedAt: x.startedAt.toISOString(),
    completedAt: x.completedAt?.toISOString(),
    error: x.error || undefined,
  };
}
