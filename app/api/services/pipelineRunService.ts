import { asc, eq } from "drizzle-orm";
import { cleaningSessions, pipelineRuns } from "@db/schema";
import { getDb } from "../queries/connection";

export interface PipelineRunSummary {
  runIndex: number;
  createdAt: string;
}

/** 读取会话当前运行序号（默认 1） */
export async function getCurrentRunIndex(sessionId: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ currentRunIndex: cleaningSessions.currentRunIndex })
    .from(cleaningSessions)
    .where(eq(cleaningSessions.sessionId, sessionId))
    .limit(1);
  return rows[0]?.currentRunIndex ?? 1;
}

/** 确保 run_index=1 的 pipeline_runs 记录存在（兼容历史会话） */
export async function ensureInitialPipelineRun(sessionId: string): Promise<void> {
  const db = getDb();
  const existing = await db
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.sessionId, sessionId))
    .limit(1);
  if (existing.length > 0) return;

  await db.insert(pipelineRuns).values({
    sessionId,
    runIndex: 1,
  });
}

/** 列出会话全部运行版本（按 runIndex 升序） */
export async function listPipelineRuns(sessionId: string): Promise<PipelineRunSummary[]> {
  await ensureInitialPipelineRun(sessionId);
  const db = getDb();
  const rows = await db
    .select({
      runIndex: pipelineRuns.runIndex,
      createdAt: pipelineRuns.createdAt,
    })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.sessionId, sessionId))
    .orderBy(asc(pipelineRuns.runIndex));

  return rows.map((r) => ({
    runIndex: r.runIndex,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * 在本会话内开始新一轮流水线（重试）：保留历史，递增 runIndex，不删除旧数据。
 */
export async function startNewPipelineRun(
  sessionId: string
): Promise<{ runIndex: number; retryCount: number } | null> {
  const db = getDb();
  const rows = await db
    .select({
      sessionId: cleaningSessions.sessionId,
      currentRunIndex: cleaningSessions.currentRunIndex,
      retryCount: cleaningSessions.retryCount,
    })
    .from(cleaningSessions)
    .where(eq(cleaningSessions.sessionId, sessionId))
    .limit(1);

  if (rows.length === 0) return null;

  const prevRun = rows[0].currentRunIndex ?? 1;
  const newRunIndex = prevRun + 1;
  const newRetryCount = (rows[0].retryCount ?? 0) + 1;

  await ensureInitialPipelineRun(sessionId);

  await db.insert(pipelineRuns).values({
    sessionId,
    runIndex: newRunIndex,
  });

  await db
    .update(cleaningSessions)
    .set({
      currentRunIndex: newRunIndex,
      retryCount: newRetryCount,
      currentPhase: "explore",
      lastAction: "pipeline_retry",
      updatedAt: new Date(),
    })
    .where(eq(cleaningSessions.sessionId, sessionId));

  return { runIndex: newRunIndex, retryCount: newRetryCount };
}

/** 解析要加载/写入的 runIndex（缺省为当前运行） */
export async function resolveRunIndex(
  sessionId: string,
  runIndex?: number
): Promise<number> {
  if (runIndex != null && runIndex > 0) return runIndex;
  return getCurrentRunIndex(sessionId);
}

export class HistoricalRunWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoricalRunWriteError";
  }
}

/**
 * 写操作前校验：客户端声明的 runIndex 必须与当前活跃 run 一致。
 * 防止用户在查看历史快照时误写入当前 run。
 */
export async function assertWritableRun(
  sessionId: string,
  clientRunIndex?: number
): Promise<number> {
  const current = await getCurrentRunIndex(sessionId);
  if (clientRunIndex != null && clientRunIndex !== current) {
    throw new HistoricalRunWriteError(
      `无法写入第 ${clientRunIndex} 次运行（历史快照）。请切换到第 ${current} 次（当前）后再操作。`
    );
  }
  return current;
}
