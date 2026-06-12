import { eq, and, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { sqlSteps, pipelineSnapshots } from "@db/schema";
import type { CleaningRule, SQLGenerationResult } from "@contracts/types";
import { resolveRunIndex } from "./pipelineRunService";
import { loadRulesForSessionRun } from "./rulesLoadService";
import { getSession } from "./sessionService";
import { buildConsolidatedCleaningSql } from "./sqlGenerationService";

export interface PipelineSnapshotData {
  revisionIndex: number;
  runIndex: number;
  cleaningRules: CleaningRule[];
  generatedSQL?: SQLGenerationResult;
  trigger?: string;
  createdAt: string;
}

async function buildGeneratedSQLFromDb(
  sessionId: string,
  runIndex: number
): Promise<SQLGenerationResult | undefined> {
  const base = await getSession(sessionId);
  if (!base?.dataSource) return undefined;

  const db = getDb();
  const stepRows = await db
    .select()
    .from(sqlSteps)
    .where(and(eq(sqlSteps.sessionId, sessionId), eq(sqlSteps.runIndex, runIndex)))
    .orderBy(sqlSteps.stepNumber);

  if (stepRows.length === 0) return undefined;

  const dialect = (
    base.dataSource.type === "mysql"
      ? "mysql"
      : base.dataSource.type === "postgresql"
        ? "postgresql"
        : base.dataSource.type === "sqlite"
          ? "sqlite"
          : base.dataSource.type === "sqlserver"
            ? "sqlserver"
            : base.dataSource.type === "oracle"
              ? "oracle"
              : "mysql"
  ) as SQLGenerationResult["targetDialect"];

  const sourceTable =
    base.targetTable || base.dataSource.fileConfig?.fileName.replace(/\.[^.]+$/, "") || "data";
  const mappedSteps = stepRows.map((s) => ({
    stepNumber: s.stepNumber,
    name: s.name,
    operationType: s.operationType,
    sql: s.sql,
    rollbackSql: s.rollbackSql || undefined,
    affectedRows: s.affectedRows,
    estimatedTime: s.estimatedTime || undefined,
    riskLevel: s.riskLevel,
  }));

  return {
    targetDialect: dialect,
    targetTable: `${sourceTable}_cleaned`,
    targetDatabase: base.dataSource.dbConfig?.database || "default",
    steps: mappedSteps,
    consolidatedSql: buildConsolidatedCleaningSql(mappedSteps),
    backupSql: stepRows[0]?.sql || "",
    rollbackSql: "",
    totalAffectedRows: stepRows.reduce((sum, s) => sum + s.affectedRows, 0),
  };
}

/** 当前 run 的最大 revision_index（无快照时为 0） */
export async function getLatestRevisionIndex(
  sessionId: string,
  runIndex?: number
): Promise<number> {
  const db = getDb();
  const effectiveRunIndex = await resolveRunIndex(sessionId, runIndex);
  const rows = await db
    .select({ maxRev: sql<number>`max(${pipelineSnapshots.revisionIndex})` })
    .from(pipelineSnapshots)
    .where(
      and(
        eq(pipelineSnapshots.sessionId, sessionId),
        eq(pipelineSnapshots.runIndex, effectiveRunIndex)
      )
    );

  const maxRev = rows[0]?.maxRev;
  return typeof maxRev === "number" && maxRev > 0 ? maxRev : 0;
}

/**
 * 从当前 DB 状态创建不可变快照（规则 + 可选 SQL），供聊天里程碑按钮绑定 revision。
 */
export async function createPipelineSnapshot(
  sessionId: string,
  runIndex?: number,
  trigger?: string
): Promise<{ revisionIndex: number; runIndex: number }> {
  const db = getDb();
  const effectiveRunIndex = await resolveRunIndex(sessionId, runIndex);
  const cleaningRules = await loadRulesForSessionRun(sessionId, effectiveRunIndex);
  const generatedSQL = await buildGeneratedSQLFromDb(sessionId, effectiveRunIndex);

  const latest = await getLatestRevisionIndex(sessionId, effectiveRunIndex);
  const revisionIndex = latest + 1;

  await db.insert(pipelineSnapshots).values({
    sessionId,
    runIndex: effectiveRunIndex,
    revisionIndex,
    trigger: trigger ?? null,
    rules: cleaningRules,
    generatedSql: generatedSQL ?? null,
  });

  return { revisionIndex, runIndex: effectiveRunIndex };
}

/** 按 revision 加载快照 */
export async function getPipelineSnapshot(
  sessionId: string,
  runIndex: number,
  revisionIndex: number
): Promise<PipelineSnapshotData | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(pipelineSnapshots)
    .where(
      and(
        eq(pipelineSnapshots.sessionId, sessionId),
        eq(pipelineSnapshots.runIndex, runIndex),
        eq(pipelineSnapshots.revisionIndex, revisionIndex)
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    revisionIndex: row.revisionIndex,
    runIndex: row.runIndex,
    cleaningRules: row.rules as CleaningRule[],
    generatedSQL: (row.generatedSql as SQLGenerationResult | null) ?? undefined,
    trigger: row.trigger ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 列出某 run 的全部快照（revision 升序） */
export async function listPipelineSnapshots(
  sessionId: string,
  runIndex?: number
): Promise<PipelineSnapshotData[]> {
  const db = getDb();
  const effectiveRunIndex = await resolveRunIndex(sessionId, runIndex);
  const rows = await db
    .select()
    .from(pipelineSnapshots)
    .where(
      and(
        eq(pipelineSnapshots.sessionId, sessionId),
        eq(pipelineSnapshots.runIndex, effectiveRunIndex)
      )
    )
    .orderBy(pipelineSnapshots.revisionIndex);

  return rows.map((row) => ({
    revisionIndex: row.revisionIndex,
    runIndex: row.runIndex,
    cleaningRules: row.rules as CleaningRule[],
    generatedSQL: (row.generatedSql as SQLGenerationResult | null) ?? undefined,
    trigger: row.trigger ?? undefined,
    createdAt: row.createdAt.toISOString(),
  }));
}
