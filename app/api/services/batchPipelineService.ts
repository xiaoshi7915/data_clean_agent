import { eq, and } from "drizzle-orm";
import type { CleaningRule, DatabaseDialect, DataSourceConfig } from "@contracts/types";
import { runSchemaAgent } from "../agents/schemaAgent";
import { runQualityAgent } from "../agents/qualityAgent";
import { runRepairAgent } from "../agents/repairAgent";
import { listDatabaseTables } from "./dataSourceService";
import { persistExploration, persistAnalysis } from "./explorationPersistenceService";
import { createSession, updateSessionPhase } from "./sessionService";
import { resolveDbConfigInput } from "./sessionCredentialService";
import { getSession } from "./sessionService";
import { getCurrentRunIndex } from "./pipelineRunService";
import { getDb } from "../queries/connection";
import { sqlSteps } from "@db/schema";
import { isSqlDialectSupported } from "@contracts/dataSourceSupport";

export interface BatchTableResult {
  tableName: string;
  sessionId?: string;
  success: boolean;
  overallScore?: number;
  ruleCount?: number;
  targetTable?: string;
  error?: string;
}

export interface BatchPipelineResult {
  totalTables: number;
  processed: number;
  results: BatchTableResult[];
}

async function persistSqlSteps(
  sessionId: string,
  runIndex: number,
  steps: Array<{
    stepNumber: number;
    name: string;
    operationType: "CREATE" | "UPDATE" | "DELETE" | "INSERT" | "SELECT";
    sql: string;
    affectedRows: number;
    estimatedTime?: string;
    riskLevel: "high" | "medium" | "low";
    rollbackSql?: string;
  }>
): Promise<void> {
  const db = getDb();
  await db
    .delete(sqlSteps)
    .where(and(eq(sqlSteps.sessionId, sessionId), eq(sqlSteps.runIndex, runIndex)));

  for (const step of steps) {
    await db.insert(sqlSteps).values({
      sessionId,
      runIndex,
      stepNumber: step.stepNumber,
      name: step.name,
      operationType: step.operationType,
      sql: step.sql,
      rollbackSql: step.rollbackSql ?? null,
      affectedRows: step.affectedRows,
      estimatedTime: step.estimatedTime ?? null,
      riskLevel: step.riskLevel,
    });
  }
}

/**
 * 整库批量：为数据源内各表创建独立会话并生成 SQL（MVP，默认最多 10 张表）。
 */
export async function runBatchPipelineForDatabase(
  sessionId: string,
  options?: { maxTables?: number; skipTables?: string[] }
): Promise<BatchPipelineResult> {
  const session = await getSession(sessionId);
  if (!session?.dataSource?.dbConfig) {
    throw new Error("整库批量仅支持数据库数据源");
  }
  if (session.dataSource.fileConfig) {
    throw new Error("文件数据源请使用单文件清洗流程");
  }

  const dialect = session.dataSource.type as DatabaseDialect;
  if (!isSqlDialectSupported(dialect)) {
    throw new Error(`暂不支持 ${dialect} 方言的整库批量`);
  }

  const dbConfig = await resolveDbConfigInput(sessionId, session.dataSource.dbConfig);
  const allTables = await listDatabaseTables(dbConfig, dialect);
  const skip = new Set(options?.skipTables ?? []);
  const maxTables = options?.maxTables ?? 10;
  const tableNames = allTables
    .map((t) => t.name)
    .filter((name) => !skip.has(name) && !name.endsWith("_cleaned") && !name.endsWith("_backup"))
    .slice(0, maxTables);

  const results: BatchTableResult[] = [];
  const dataSource = session.dataSource as DataSourceConfig;

  for (const tableName of tableNames) {
    try {
      const childSessionId = await createSession(dataSource, tableName, {
        title: `${tableName} · 整库批量`,
        initialPhase: "explore",
      });

      const exploreResult = await runSchemaAgent({
        sessionId: childSessionId,
        dataSource,
        tableName,
        limit: 100,
      });
      if (!exploreResult.success || !exploreResult.data) {
        throw new Error(exploreResult.error ?? "探查失败");
      }
      const exploration = exploreResult.data.exploration;
      await persistExploration(childSessionId, exploration, {
        tableName,
        lastAction: "db_explored",
        sessionTitle: `${tableName} · 整库批量`,
      });

      const qualityResult = runQualityAgent({ sessionId: childSessionId, exploration });
      if (!qualityResult.success || !qualityResult.data) {
        throw new Error(qualityResult.error ?? "质量分析失败");
      }

      const confirmedRules: CleaningRule[] = qualityResult.data.rules.map((rule) => ({
        ...rule,
        status: rule.status === "skipped" ? "skipped" : "confirmed",
      }));

      await persistAnalysis(childSessionId, qualityResult.data.report, confirmedRules, {
        phase: "before",
      });
      await updateSessionPhase(childSessionId, "confirm", "batch_confirmed");

      const repairResult = runRepairAgent({
        sessionId: childSessionId,
        rules: confirmedRules,
        dialect,
        tableName,
        databaseName: dbConfig.database,
        columns: exploration.schema.map((c) => c.name),
      });
      if (!repairResult.success || !repairResult.data) {
        throw new Error(repairResult.error ?? "SQL 生成失败");
      }

      const runIndex = await getCurrentRunIndex(childSessionId);
      await persistSqlSteps(childSessionId, runIndex, repairResult.data.sqlResult.steps);
      await updateSessionPhase(childSessionId, "generate", "batch_sql_generated");

      results.push({
        tableName,
        sessionId: childSessionId,
        success: true,
        overallScore: qualityResult.data.report.score.overall,
        ruleCount: confirmedRules.filter((r) => r.status === "confirmed").length,
        targetTable: repairResult.data.sqlResult.targetTable,
      });
    } catch (error) {
      results.push({
        tableName,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    totalTables: allTables.length,
    processed: results.length,
    results,
  };
}
