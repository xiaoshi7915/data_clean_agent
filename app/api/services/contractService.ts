import { eq, and } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { cleaningRules, cleaningSessions } from "@db/schema";
import { getCurrentRunIndex } from "./pipelineRunService";
import {
  contractToRules,
  parseCleaningContract,
  rulesToContract,
  serializeCleaningContractYaml,
  serializeCleaningContractJson,
} from "@contracts/contractParser";
import type { CleaningContract } from "@contracts/cleaning-contract.schema";
import type { CleaningRule } from "@contracts/types";
import { getFullSession } from "./sessionService";

function mapDbRuleToCleaningRule(row: typeof cleaningRules.$inferSelect): CleaningRule {
  return {
    id: row.ruleId,
    index: row.ruleIndex,
    name: row.name,
    field: row.field,
    action: row.action,
    issueDescription: row.issueDescription || undefined,
    strategy: row.strategy || undefined,
    affectedRows: row.affectedRows,
    affectedPercent: parseFloat(row.affectedPercent || "0"),
    parameters: (row.parameters as Record<string, unknown>) || {},
    status: row.status,
    preview: (row.preview as CleaningRule["preview"] | null) ?? undefined,
    riskNote: row.riskNote || undefined,
  };
}

/** 从会话规则导出 CleaningContract */
export async function exportSessionContract(sessionId: string): Promise<CleaningContract | null> {
  const session = await getFullSession(sessionId);
  if (!session) return null;

  const rules = session.cleaningRules ?? [];
  return rulesToContract(rules, {
    sessionId,
    title: session.sessionTitle,
    tableName: session.targetTable,
    databaseName: session.dataSource?.dbConfig?.database,
    dialect: session.dataSource?.type === "mysql" ? "mysql" : undefined,
  });
}

/** 导出为 YAML 文本 */
export async function exportSessionContractYaml(sessionId: string): Promise<string | null> {
  const contract = await exportSessionContract(sessionId);
  if (!contract) return null;
  return serializeCleaningContractYaml(contract);
}

/** 导出为 JSON 文本 */
export async function exportSessionContractJson(sessionId: string): Promise<string | null> {
  const contract = await exportSessionContract(sessionId);
  if (!contract) return null;
  return serializeCleaningContractJson(contract);
}

/** 将契约 YAML/JSON 持久化到会话 contract_yaml 字段 */
export async function saveSessionContractYaml(sessionId: string, yaml: string): Promise<void> {
  const db = getDb();
  await db
    .update(cleaningSessions)
    .set({ contractYaml: yaml, updatedAt: new Date() })
    .where(eq(cleaningSessions.sessionId, sessionId));
}

/** 从 DB 规则 JSON 重建契约对象（round-trip 读路径） */
export async function loadContractFromDbRules(sessionId: string): Promise<CleaningContract | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(cleaningRules)
    .where(eq(cleaningRules.sessionId, sessionId))
    .orderBy(cleaningRules.ruleIndex);

  if (rows.length === 0) return null;
  return rulesToContract(rows.map(mapDbRuleToCleaningRule));
}

/** 解析外部 YAML/JSON 并写回 cleaning_rules（round-trip 写路径） */
export async function importContractToSession(
  sessionId: string,
  source: string,
  format: "json" | "yaml" | "auto" = "auto"
): Promise<CleaningRule[]> {
  const contract = parseCleaningContract(source, format);
  const rules = contractToRules(contract);
  const db = getDb();
  const runIndex = await getCurrentRunIndex(sessionId);

  await db
    .delete(cleaningRules)
    .where(
      and(eq(cleaningRules.sessionId, sessionId), eq(cleaningRules.runIndex, runIndex))
    );

  for (const rule of rules) {
    await db.insert(cleaningRules).values({
      sessionId,
      runIndex,
      ruleId: rule.id,
      ruleIndex: rule.index,
      name: rule.name,
      field: rule.field,
      action: rule.action,
      issueDescription: rule.issueDescription ?? null,
      strategy: rule.strategy ?? null,
      affectedRows: rule.affectedRows,
      affectedPercent: String(rule.affectedPercent),
      parameters: rule.parameters,
      status: rule.status,
      preview: rule.preview ?? null,
      riskNote: rule.riskNote ?? null,
    });
  }

  const yaml = serializeCleaningContractYaml(contract);
  await saveSessionContractYaml(sessionId, yaml);

  return rules;
}

/** 读取会话已缓存的 contract_yaml */
export async function getSessionContractYaml(sessionId: string): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ contractYaml: cleaningSessions.contractYaml })
    .from(cleaningSessions)
    .where(eq(cleaningSessions.sessionId, sessionId))
    .limit(1);
  return rows[0]?.contractYaml ?? null;
}
