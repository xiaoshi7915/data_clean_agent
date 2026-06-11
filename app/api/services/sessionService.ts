import { eq, desc } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { cleanupSession } from "./dataSourceService";
import {
  cleaningSessions,
  chatMessages,
  explorationResults,
  qualityReports,
  cleaningRules,
  sqlSteps,
  executionLogs,
} from "@db/schema";
import { getDataSourceById, upsertDataSource, findDataSourceByConnection } from "./dataSourceStoreService";
import type {
  CleaningPhase,
  DataSourceConfig,
  SessionState,
  ChatMessage,
  ChatMessageAction,
  ExplorationResult,
  QualityReport,
  CleaningRule,
  SQLGenerationResult,
  ExecutionResult,
  CleaningAction,
  RuleStatus,
} from "@contracts/types";

function defaultSessionTitle(): string {
  return `清洗对话 ${new Date().toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

async function buildDataSourceFromSession(
  row: typeof cleaningSessions.$inferSelect
): Promise<DataSourceConfig | undefined> {
  // 优先从已保存数据源加载完整凭证（含密码）
  if (row.dataSourceId) {
    const saved = await getDataSourceById(row.dataSourceId);
    if (saved) return saved;
  }

  if (!row.dataSourceType) return undefined;

  const dataSource: DataSourceConfig = {
    type: row.dataSourceType as DataSourceConfig["type"],
    name: row.dataSourceName || "",
  };

  if (row.dbHost) {
    // 会话未关联 ID 时，尝试按连接信息找回 saved_data_sources 中的凭证
    const matched = await findDataSourceByConnection(
      row.dataSourceType,
      row.dbHost,
      row.dbPort || 3306,
      row.dbDatabase || ""
    );
    if (matched?.dbConfig) {
      dataSource.dbConfig = matched.dbConfig;
    } else {
      dataSource.dbConfig = {
        host: row.dbHost,
        port: row.dbPort || 3306,
        database: row.dbDatabase || "",
        username: "",
        password: "",
        schema: row.dbSchema || undefined,
      };
    }
  }

  if (row.fileName) {
    dataSource.fileConfig = {
      fileName: row.fileName,
      fileSize: 0,
      fileType: (row.fileType as "csv" | "json" | "xml" | "xlsx") || "csv",
      filePath: row.filePath || "",
    };
  }

  return dataSource;
}

export async function createSession(
  dataSource: DataSourceConfig,
  targetTable?: string,
  options?: { dataSourceId?: string; title?: string; initialPhase?: CleaningPhase }
): Promise<string> {
  const db = getDb();
  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const dataSourceId = options?.dataSourceId ?? (await upsertDataSource(dataSource));
  const isDbSource = ["mysql", "postgresql", "sqlite", "sqlserver", "oracle"].includes(dataSource.type);
  const initialPhase = options?.initialPhase ?? (isDbSource ? "explore" : "explore");

  await db.insert(cleaningSessions).values({
    sessionId,
    dataSourceId,
    sessionTitle: options?.title || defaultSessionTitle(),
    currentPhase: initialPhase,
    dataSourceType: dataSource.type,
    dataSourceName: dataSource.name,
    targetTable: targetTable || null,
    dbHost: dataSource.dbConfig?.host || null,
    dbPort: dataSource.dbConfig?.port || null,
    dbDatabase: dataSource.dbConfig?.database || null,
    dbSchema: dataSource.dbConfig?.schema || null,
    fileName: dataSource.fileConfig?.fileName || null,
    fileType: dataSource.fileConfig?.fileType || null,
    filePath: dataSource.fileConfig?.filePath || null,
    retryCount: 0,
    lastAction: "session_created",
  });

  return sessionId;
}

export async function createSessionFromDataSource(dataSourceId: string): Promise<string | null> {
  const config = await getDataSourceById(dataSourceId);
  if (!config) return null;
  return createSession(config, undefined, { dataSourceId, initialPhase: "explore" });
}

export async function updateSessionTitle(sessionId: string, title: string): Promise<void> {
  const db = getDb();
  await db
    .update(cleaningSessions)
    .set({ sessionTitle: title, updatedAt: new Date() })
    .where(eq(cleaningSessions.sessionId, sessionId));
}

export async function updateSessionTargetTable(sessionId: string, targetTable: string): Promise<void> {
  const db = getDb();
  await db
    .update(cleaningSessions)
    .set({ targetTable, updatedAt: new Date() })
    .where(eq(cleaningSessions.sessionId, sessionId));
}

export async function getSession(sessionId: string): Promise<SessionState | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(cleaningSessions)
    .where(eq(cleaningSessions.sessionId, sessionId))
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];
  const dataSource = await buildDataSourceFromSession(row);
  const messages = await loadMessages(sessionId);

  return {
    sessionId: row.sessionId,
    currentPhase: row.currentPhase as CleaningPhase,
    dataSource,
    targetTable: row.targetTable || undefined,
    confirmedRules: [],
    lastAction: row.lastAction || "",
    retryCount: row.retryCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    messages,
  };
}

async function loadMessages(sessionId: string): Promise<ChatMessage[]> {
  const db = getDb();
  const msgs = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(chatMessages.createdAt);

  return msgs.map((m) => {
    const metadata = (m.metadata as Record<string, unknown>) || undefined;
    const actions = metadata?.actions as ChatMessageAction[] | undefined;
    return {
      id: m.messageId,
      role: m.role as "agent" | "user" | "system",
      phase: m.phase as CleaningPhase,
      content: m.content,
      timestamp: m.createdAt.toISOString(),
      metadata,
      actions,
    };
  });
}

export async function getFullSession(sessionId: string) {
  const base = await getSession(sessionId);
  if (!base) return null;

  const db = getDb();
  const row = (
    await db.select().from(cleaningSessions).where(eq(cleaningSessions.sessionId, sessionId)).limit(1)
  )[0];

  const exploreRows = await db
    .select()
    .from(explorationResults)
    .where(eq(explorationResults.sessionId, sessionId))
    .orderBy(desc(explorationResults.createdAt))
    .limit(1);

  const qualityRows = await db
    .select()
    .from(qualityReports)
    .where(eq(qualityReports.sessionId, sessionId))
    .orderBy(desc(qualityReports.createdAt))
    .limit(1);

  const ruleRows = await db
    .select()
    .from(cleaningRules)
    .where(eq(cleaningRules.sessionId, sessionId))
    .orderBy(cleaningRules.ruleIndex);

  const stepRows = await db
    .select()
    .from(sqlSteps)
    .where(eq(sqlSteps.sessionId, sessionId))
    .orderBy(sqlSteps.stepNumber);

  const execRows = await db
    .select()
    .from(executionLogs)
    .where(eq(executionLogs.sessionId, sessionId))
    .orderBy(desc(executionLogs.createdAt))
    .limit(1);

  let explorationResult: ExplorationResult | undefined;
  if (exploreRows[0]) {
    const e = exploreRows[0];
    explorationResult = {
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

  let qualityReport: QualityReport | undefined;
  if (qualityRows[0]) {
    const q = qualityRows[0];
    qualityReport = {
      score: {
        overall: q.overallScore,
        completeness: q.completenessScore,
        uniqueness: q.uniquenessScore,
        consistency: q.consistencyScore,
        validity: q.validityScore,
        accuracy: q.accuracyScore,
      },
      issues: [],
      highPriorityIssues: q.highPriorityIssues as QualityReport["highPriorityIssues"],
      mediumPriorityIssues: q.mediumPriorityIssues as QualityReport["mediumPriorityIssues"],
      lowPriorityIssues: q.lowPriorityIssues as QualityReport["lowPriorityIssues"],
      summary: q.summary || "",
    };
  }

  const cleaningRulesList: CleaningRule[] = ruleRows.map((r) => ({
    id: r.ruleId,
    index: r.ruleIndex,
    name: r.name,
    field: r.field,
    action: r.action as CleaningAction,
    issueDescription: r.issueDescription || undefined,
    strategy: r.strategy || undefined,
    affectedRows: r.affectedRows,
    affectedPercent: parseFloat(r.affectedPercent || "0"),
    parameters: (r.parameters as Record<string, unknown>) || {},
    status: r.status as RuleStatus,
    preview: r.preview as CleaningRule["preview"],
    riskNote: r.riskNote || undefined,
  }));

  let generatedSQL: SQLGenerationResult | undefined;
  if (stepRows.length > 0 && base.dataSource) {
    const dialect = (base.dataSource.type === "mysql"
      ? "mysql"
      : base.dataSource.type === "postgresql"
      ? "postgresql"
      : base.dataSource.type === "sqlite"
      ? "sqlite"
      : base.dataSource.type === "sqlserver"
      ? "sqlserver"
      : base.dataSource.type === "oracle"
      ? "oracle"
      : "mysql") as SQLGenerationResult["targetDialect"];

    const sourceTable =
      base.targetTable || base.dataSource.fileConfig?.fileName.replace(/\.[^.]+$/, "") || "data";
    const insertStep = stepRows.find((s) => s.operationType === "INSERT");
    generatedSQL = {
      targetDialect: dialect,
      targetTable: `${sourceTable}_cleaned`,
      targetDatabase: base.dataSource.dbConfig?.database || "default",
      steps: stepRows.map((s) => ({
        stepNumber: s.stepNumber,
        name: s.name,
        operationType: s.operationType,
        sql: s.sql,
        rollbackSql: s.rollbackSql || undefined,
        affectedRows: s.affectedRows,
        estimatedTime: s.estimatedTime || undefined,
        riskLevel: s.riskLevel,
      })),
      consolidatedSql: insertStep?.sql || "",
      backupSql: stepRows[0]?.sql || "",
      rollbackSql: "",
      totalAffectedRows: stepRows.reduce((sum, s) => sum + s.affectedRows, 0),
    };
  }

  let executionResult: ExecutionResult | undefined;
  if (execRows[0]) {
    const x = execRows[0];
    executionResult = {
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

  return {
    ...base,
    dataSourceId: row?.dataSourceId || undefined,
    sessionTitle: row?.sessionTitle || undefined,
    explorationResult,
    qualityReport,
    cleaningRules: cleaningRulesList,
    generatedSQL,
    executionResult,
  };
}

export async function updateSessionPhase(
  sessionId: string,
  phase: CleaningPhase,
  lastAction?: string
): Promise<void> {
  const db = getDb();
  await db
    .update(cleaningSessions)
    .set({
      currentPhase: phase,
      lastAction: lastAction || `phase_${phase}`,
      updatedAt: new Date(),
    })
    .where(eq(cleaningSessions.sessionId, sessionId));
}

export async function incrementRetryCount(sessionId: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ count: cleaningSessions.retryCount })
    .from(cleaningSessions)
    .where(eq(cleaningSessions.sessionId, sessionId));

  const newCount = (rows[0]?.count || 0) + 1;
  await db
    .update(cleaningSessions)
    .set({ retryCount: newCount, updatedAt: new Date() })
    .where(eq(cleaningSessions.sessionId, sessionId));

  return newCount;
}

export async function addMessage(sessionId: string, message: ChatMessage): Promise<void> {
  const db = getDb();
  const metadata = {
    ...(message.metadata || {}),
    ...(message.actions ? { actions: message.actions } : {}),
  };

  await db.insert(chatMessages).values({
    sessionId,
    messageId: message.id,
    role: message.role,
    phase: message.phase,
    content: message.content,
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
  });

  await db
    .update(cleaningSessions)
    .set({ updatedAt: new Date() })
    .where(eq(cleaningSessions.sessionId, sessionId));
}

export async function listSessions(): Promise<
  {
    sessionId: string;
    sessionTitle: string | null;
    dataSourceId: string | null;
    currentPhase: string;
    dataSourceName: string | null;
    targetTable: string | null;
    createdAt: Date;
    updatedAt: Date;
  }[]
> {
  const db = getDb();
  return db
    .select({
      sessionId: cleaningSessions.sessionId,
      sessionTitle: cleaningSessions.sessionTitle,
      dataSourceId: cleaningSessions.dataSourceId,
      currentPhase: cleaningSessions.currentPhase,
      dataSourceName: cleaningSessions.dataSourceName,
      targetTable: cleaningSessions.targetTable,
      createdAt: cleaningSessions.createdAt,
      updatedAt: cleaningSessions.updatedAt,
    })
    .from(cleaningSessions)
    .orderBy(desc(cleaningSessions.updatedAt));
}

export async function listSessionsByDataSource(dataSourceId: string) {
  const all = await listSessions();
  return all.filter((s) => s.dataSourceId === dataSourceId);
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ sessionId: cleaningSessions.sessionId })
    .from(cleaningSessions)
    .where(eq(cleaningSessions.sessionId, sessionId))
    .limit(1);

  if (rows.length === 0) return false;

  await db.delete(chatMessages).where(eq(chatMessages.sessionId, sessionId));
  await db.delete(explorationResults).where(eq(explorationResults.sessionId, sessionId));
  await db.delete(qualityReports).where(eq(qualityReports.sessionId, sessionId));
  await db.delete(cleaningRules).where(eq(cleaningRules.sessionId, sessionId));
  await db.delete(sqlSteps).where(eq(sqlSteps.sessionId, sessionId));
  await db.delete(executionLogs).where(eq(executionLogs.sessionId, sessionId));
  await db.delete(cleaningSessions).where(eq(cleaningSessions.sessionId, sessionId));

  await cleanupSession(sessionId);
  return true;
}
