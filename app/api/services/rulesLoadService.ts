import { eq, and } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { cleaningRules } from "@db/schema";
import type { CleaningRule, RuleStatus } from "@contracts/types";
import { getCurrentRunIndex } from "./pipelineRunService";

/** 将 DB 行映射为契约 CleaningRule */
export function cleaningRuleFromRow(row: typeof cleaningRules.$inferSelect): CleaningRule {
  return {
    id: row.ruleId,
    index: row.ruleIndex,
    name: row.name,
    field: row.field,
    action: row.action as CleaningRule["action"],
    issueDescription: row.issueDescription || undefined,
    strategy: row.strategy || undefined,
    affectedRows: row.affectedRows,
    affectedPercent: parseFloat(row.affectedPercent || "0"),
    parameters: (row.parameters as Record<string, unknown>) || {},
    status: row.status as RuleStatus,
    preview: row.preview as CleaningRule["preview"],
    riskNote: row.riskNote || undefined,
  };
}

/** 从 DB 加载指定会话 run 的清洗规则（SQL 生成等应以 DB 为准） */
export async function loadRulesForSessionRun(
  sessionId: string,
  runIndex?: number
): Promise<CleaningRule[]> {
  const db = getDb();
  const effectiveRunIndex = runIndex ?? (await getCurrentRunIndex(sessionId));
  const rows = await db
    .select()
    .from(cleaningRules)
    .where(
      and(eq(cleaningRules.sessionId, sessionId), eq(cleaningRules.runIndex, effectiveRunIndex))
    )
    .orderBy(cleaningRules.ruleIndex);
  return rows.map(cleaningRuleFromRow);
}
