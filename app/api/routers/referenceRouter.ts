import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { createRouter, protectedMutation } from "../middleware";
import { getDb } from "../queries/connection";
import { cleaningRules } from "@db/schema";
import { getCurrentRunIndex } from "../services/pipelineRunService";
import {
  parseCodeTableFile,
  codeTableToDictMap,
  buildCodeTableRuleParameters,
  type CodeTableEntry,
  type CodeTableRuleOptions,
} from "../services/codeTableParser";
import {
  parseDataStandardFile,
  dataStandardToRuleParams,
  type DataStandardFieldRule,
} from "../services/dataStandardParser";
import type { CleaningAction, RuleStatus } from "@contracts/types";
import { resolveExistingUploadPath } from "../services/uploadPathService";

/** 将码表/数据标准条目合并为 cleaning_rules */
export async function insertReferenceRules(
  sessionId: string,
  items: Array<{
    field: string;
    name: string;
    action: CleaningAction;
    parameters: Record<string, unknown>;
    strategy?: string;
  }>
): Promise<number> {
  const db = getDb();
  const runIndex = await getCurrentRunIndex(sessionId);
  const existing = await db
    .select({ ruleIndex: cleaningRules.ruleIndex })
    .from(cleaningRules)
    .where(
      and(eq(cleaningRules.sessionId, sessionId), eq(cleaningRules.runIndex, runIndex))
    );

  let nextIndex =
    existing.length > 0 ? Math.max(...existing.map((r) => r.ruleIndex)) + 1 : 1;

  for (const item of items) {
    const ruleId = `ref_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await db.insert(cleaningRules).values({
      sessionId,
      runIndex,
      ruleId,
      ruleIndex: nextIndex++,
      name: item.name,
      field: item.field,
      action: item.action,
      issueDescription: item.strategy ?? null,
      strategy: item.strategy ?? null,
      affectedRows: 0,
      affectedPercent: "0",
      parameters: item.parameters,
      status: "pending" as RuleStatus,
      riskNote: "来自码表/数据标准导入",
    });
  }

  return items.length;
}

/** 码表条目 → standardize 清洗规则 */
function codeTableEntriesToRules(
  entries: CodeTableEntry[],
  options?: CodeTableRuleOptions
) {
  const dictByField = codeTableToDictMap(entries);
  return Object.entries(dictByField).map(([field, dictMap]) => ({
    field,
    name: `码表映射：${field}`,
    action: "standardize" as CleaningAction,
    strategy: `码表 ${Object.keys(dictMap).length} 条映射`,
    parameters: buildCodeTableRuleParameters(field, dictMap, options),
  }));
}

/** 数据标准 → format/standardize 规则 */
function dataStandardRulesToCleaningRules(rules: DataStandardFieldRule[]) {
  return rules.map((r) => {
    const converted = dataStandardToRuleParams(r);
    return {
      field: r.field,
      name: converted.name,
      action: converted.action as CleaningAction,
      strategy: r.description ?? `数据标准约束：${r.field}`,
      parameters: converted.parameters,
    };
  });
}

export const referenceRouter = createRouter({
  /** 从已上传文件解析并应用码表 */
  applyCodeTableFromFile: protectedMutation
    .input(
      z.object({
        sessionId: z.string(),
        filePath: z.string(),
        unmatchedStrategy: z.enum(["keep", "null", "custom", "reject"]).optional(),
        customUnmatchedValue: z.string().optional(),
        whitelist: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const parsed = parseCodeTableFile(resolveExistingUploadPath(input.filePath));
        if (parsed.entries.length === 0) {
          return {
            success: false,
            error: parsed.errors.join("；") || "码表为空",
            rulesAdded: 0,
          };
        }
        const options: CodeTableRuleOptions = {
          unmatchedStrategy: input.unmatchedStrategy,
          customUnmatchedValue: input.customUnmatchedValue,
          whitelist: input.whitelist,
        };
        const ruleItems = codeTableEntriesToRules(parsed.entries, options);
        const rulesAdded = await insertReferenceRules(input.sessionId, ruleItems);
        return {
          success: true,
          rulesAdded,
          entryCount: parsed.entries.length,
          warnings: parsed.errors,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, rulesAdded: 0 };
      }
    }),

  /** 直接提交码表 JSON 条目 */
  applyCodeTable: protectedMutation
    .input(
      z.object({
        sessionId: z.string(),
        entries: z.array(
          z.object({
            field: z.string(),
            sourceValue: z.string(),
            targetValue: z.string(),
          })
        ),
        unmatchedStrategy: z.enum(["keep", "null", "custom", "reject"]).optional(),
        customUnmatchedValue: z.string().optional(),
        whitelist: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      if (input.entries.length === 0) {
        return { success: false, error: "码表条目为空", rulesAdded: 0 };
      }
      const options: CodeTableRuleOptions = {
        unmatchedStrategy: input.unmatchedStrategy,
        customUnmatchedValue: input.customUnmatchedValue,
        whitelist: input.whitelist,
      };
      const ruleItems = codeTableEntriesToRules(input.entries, options);
      const rulesAdded = await insertReferenceRules(input.sessionId, ruleItems);
      return { success: true, rulesAdded, entryCount: input.entries.length };
    }),

  /** 从已上传文件解析并应用数据标准 */
  applyDataStandardFromFile: protectedMutation
    .input(z.object({ sessionId: z.string(), filePath: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const parsed = parseDataStandardFile(resolveExistingUploadPath(input.filePath));
        if (parsed.rules.length === 0) {
          return {
            success: false,
            error: parsed.errors.join("；") || "数据标准为空",
            rulesAdded: 0,
          };
        }
        const ruleItems = dataStandardRulesToCleaningRules(parsed.rules);
        const rulesAdded = await insertReferenceRules(input.sessionId, ruleItems);
        return {
          success: true,
          rulesAdded,
          standardName: parsed.standardName,
          warnings: parsed.errors,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, rulesAdded: 0 };
      }
    }),
});
