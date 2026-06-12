import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { createRouter, rateLimitedMutation } from "../middleware";
import { getDb } from "../queries/connection";
import { cleaningRules } from "@db/schema";
import {
  resolveChatResponse,
  actionToLabel,
  isTemplateOrPlaceholderMessage,
  keywordFallback,
  type ChatActionIntent,
  type SessionChatContext,
} from "../services/llmService";

const ORCHESTRATOR_ACTIONS: ChatActionIntent[] = [
  "startExplore",
  "startAnalysis",
  "confirmAll",
  "generateSQL",
  "runFullPipeline",
  "exportScripts",
  "viewRules",
];
import {
  applyRuleUpdatesFromNL,
  expandBulkRuleUpdatesFromMessage,
  extractAddDerivedColumnFromMessage,
  extractRuleUpdatesFromMessage,
  isBulkAllFieldsIntent,
} from "../services/ruleIntentService";
import { detectReferenceUploadIntent } from "../services/referenceIntentService";
import { parseCodeTableFile, codeTableToDictMap, buildCodeTableRuleParameters } from "../services/codeTableParser";
import { parseDataStandardFile, dataStandardToRuleParams } from "../services/dataStandardParser";
import { insertReferenceRules } from "./referenceRouter";
import { detectMultiIntent } from "../services/agentService";
import { getCurrentRunIndex } from "../services/pipelineRunService";
import {
  handleUserMessage as handleOrchestratorMessage,
  handleMultiStepPlan,
} from "../agents/orchestrator";
import type { CleaningRule, RuleStatus, RuleUpdateIntent } from "@contracts/types";

function mapActionToClient(action?: ChatActionIntent) {
  if (!action || action === "none") return undefined;
  return {
    id: `action-${action}`,
    label: actionToLabel(action),
    type: action,
  };
}

/** 确保返回给用户的消息为可读中文，过滤 schema 模板泄漏 */
function ensureHumanReadableMessage(message: string, fallback: string): string {
  const trimmed = message.trim();
  if (!trimmed || isTemplateOrPlaceholderMessage(trimmed)) {
    return fallback;
  }
  return trimmed;
}

function loadRulesFromRows(rows: (typeof cleaningRules.$inferSelect)[]): CleaningRule[] {
  return rows.map((r) => ({
    id: r.ruleId,
    index: r.ruleIndex,
    name: r.name,
    field: r.field,
    action: r.action as CleaningRule["action"],
    issueDescription: r.issueDescription || undefined,
    strategy: r.strategy || undefined,
    affectedRows: r.affectedRows,
    affectedPercent: parseFloat(r.affectedPercent || "0"),
    parameters: (r.parameters as Record<string, unknown>) || {},
    status: r.status as RuleStatus,
    preview: r.preview as CleaningRule["preview"],
    riskNote: r.riskNote || undefined,
  }));
}

async function loadRulesForCurrentRun(sessionId: string): Promise<CleaningRule[]> {
  const db = getDb();
  const runIndex = await getCurrentRunIndex(sessionId);
  const ruleRows = await db
    .select()
    .from(cleaningRules)
    .where(and(eq(cleaningRules.sessionId, sessionId), eq(cleaningRules.runIndex, runIndex)))
    .orderBy(cleaningRules.ruleIndex);
  return loadRulesFromRows(ruleRows);
}

function normalizeFieldKey(field: string): string {
  return field.toLowerCase().replace(/[\s_-]+/g, "");
}

/** 将 LLM 返回的 ruleUpdates 与 NL 兜底解析结果合并（补全 fillValue / replaceAll） */
function mergeLlmWithInferredUpdates(
  llmRuleUpdates: RuleUpdateIntent[],
  inferredUpdates?: RuleUpdateIntent[]
): RuleUpdateIntent[] {
  if (!inferredUpdates?.length) return llmRuleUpdates;

  return llmRuleUpdates.map((llm) => {
    const inferred = inferredUpdates.find(
      (item) => normalizeFieldKey(item.field) === normalizeFieldKey(llm.field)
    );
    if (!inferred) return llm;
    return {
      ...llm,
      fillValue: llm.fillValue ?? inferred.fillValue,
      variantKey: llm.variantKey ?? inferred.variantKey,
      replaceAll: llm.replaceAll ?? inferred.replaceAll,
    };
  });
}

function resolveUpdatesToApply(
  userMessage: string,
  existingRules: CleaningRule[],
  llmRuleUpdates?: RuleUpdateIntent[]
): RuleUpdateIntent[] | undefined {
  const derivedUpdates = extractAddDerivedColumnFromMessage(userMessage, existingRules);
  if (derivedUpdates?.length) return derivedUpdates;

  const bulkUpdates = expandBulkRuleUpdatesFromMessage(userMessage, existingRules);
  const inferredUpdates = extractRuleUpdatesFromMessage(userMessage, existingRules);

  if (llmRuleUpdates?.length) {
    return mergeLlmWithInferredUpdates(llmRuleUpdates, inferredUpdates);
  }
  if (bulkUpdates?.length) return bulkUpdates;

  return inferredUpdates?.length ? inferredUpdates : undefined;
}

export const chatRouter = createRouter({
  send: rateLimitedMutation("chat.send")
    .input(
      z.object({
        sessionId: z.string().optional(),
        userMessage: z.string().min(1),
        context: z.object({
          phase: z.string(),
          dataSourceName: z.string().optional(),
          targetTable: z.string().optional(),
          hasExploration: z.boolean(),
          hasQualityReport: z.boolean(),
          rulesCount: z.number(),
          confirmedRulesCount: z.number(),
          hasGeneratedSQL: z.boolean(),
          hasExecutionResult: z.boolean(),
        }),
        history: z
          .array(
            z.object({
              role: z.enum(["user", "assistant", "system"]),
              content: z.string(),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const ctx: SessionChatContext = input.context;
        const history = (input.history || []).map((m) => ({
          role: m.role,
          content: m.content,
        }));

        let result = await resolveChatResponse(input.userMessage, ctx, history);
        let ruleUpdatesApplied = 0;

        if (isTemplateOrPlaceholderMessage(result.message)) {
          result = keywordFallback(input.userMessage, ctx);
        }

        let message = ensureHumanReadableMessage(
          result.message,
          "收到，正在根据您的描述处理清洗规则。"
        );

        const multiIntent = input.sessionId ? detectMultiIntent(input.userMessage, ctx) : false;
        let orchestratorRunId: string | undefined;
        let orchestratorState: string | undefined;

        // 多步 NL：统一走 orchestrator（orchestration_runs 为唯一状态源）
        if (input.sessionId && multiIntent) {
          const existingRules = await loadRulesForCurrentRun(input.sessionId);
          const updatesToApply = resolveUpdatesToApply(
            input.userMessage,
            existingRules,
            result.ruleUpdates
          );

          if (updatesToApply?.length) {
            const applyResult = await applyRuleUpdatesFromNL(
              input.sessionId,
              updatesToApply,
              existingRules,
              { sourceMessage: input.userMessage }
            );
            ruleUpdatesApplied = applyResult.applied;
            if (applyResult.summaries.length > 0) {
              message = `${message}\n\n✅ 已应用 ${applyResult.applied} 条规则修改`;
            }
          }

          const planResult = await handleMultiStepPlan(
            input.sessionId,
            input.userMessage,
            ctx,
            result.ruleUpdates
          );
          if (planResult.orchestrated) {
            message = planResult.message || message;
            orchestratorRunId = planResult.runId;
            orchestratorState = planResult.state;
            if (planResult.actions.length > 0) {
              const first = planResult.actions[0];
              const mappedAction = ORCHESTRATOR_ACTIONS.includes(first.type as ChatActionIntent)
                ? (first.type as ChatActionIntent)
                : undefined;
              if (mappedAction) {
                result = {
                  ...result,
                  action: mappedAction,
                  autoTrigger: first.autoTrigger ?? result.autoTrigger,
                };
              }
            }
          }
        } else if (input.sessionId) {
          // 单步/关键词编排意图
          const orchResult = await handleOrchestratorMessage(
            input.sessionId,
            input.userMessage,
            ctx
          );
          if (orchResult.orchestrated && orchResult.message) {
            message = orchResult.message;
            orchestratorRunId = orchResult.runId;
            orchestratorState = orchResult.state;
            if (orchResult.actions.length > 0 && !result.action) {
              const first = orchResult.actions[0];
              const mappedAction = ORCHESTRATOR_ACTIONS.includes(first.type as ChatActionIntent)
                ? (first.type as ChatActionIntent)
                : undefined;
              if (mappedAction) {
                result = {
                  ...result,
                  action: mappedAction,
                  autoTrigger: first.autoTrigger ?? result.autoTrigger,
                };
              }
            }
          }

          const existingRules = await loadRulesForCurrentRun(input.sessionId);

          const updatesToApply = resolveUpdatesToApply(
            input.userMessage,
            existingRules,
            result.ruleUpdates
          );

          if (updatesToApply?.length) {
            const applyResult = await applyRuleUpdatesFromNL(
              input.sessionId,
              updatesToApply,
              existingRules,
              { sourceMessage: input.userMessage }
            );
            ruleUpdatesApplied = applyResult.applied;

            if (applyResult.applied > 0 && isBulkAllFieldsIntent(input.userMessage)) {
              message = `好的，已将 ${applyResult.applied} 个字段的空值填充策略统一改为 NULL。`;
            }

            if (applyResult.summaries.length > 0) {
              const summaryText = applyResult.summaries.map((s) => `- ${s}`).join("\n");
              message = `${message}\n\n✅ 已应用 ${applyResult.applied} 条规则修改：\n${summaryText}`;
            }
            if (applyResult.errors.length > 0) {
              const errorText = applyResult.errors.map((e) => `- ${e}`).join("\n");
              message = `${message}\n\n⚠️ 部分规则未能更新：\n${errorText}`;
            }

            if (ruleUpdatesApplied > 0 && !result.action) {
              result = { ...result, action: "updateRule" };
            }
          } else if (isBulkAllFieldsIntent(input.userMessage)) {
            message =
              "未找到可批量修改的空值填充规则。请先完成质量分析生成规则，或指定具体字段名。";
          }
        }

        // 码表 / 数据标准上传意图：解析文件并合并清洗规则
        if (input.sessionId) {
          const refIntent = detectReferenceUploadIntent(input.userMessage);
          if (refIntent) {
            try {
              if (refIntent.kind === "code_table") {
                const parsed = parseCodeTableFile(refIntent.filePath);
                if (parsed.entries.length > 0) {
                  const dictByField = codeTableToDictMap(parsed.entries);
                  const items = Object.entries(dictByField).map(([field, dictMap]) => ({
                    field,
                    name: `码表映射：${field}`,
                    action: "standardize" as const,
                    strategy: `码表 ${Object.keys(dictMap).length} 条映射`,
                    parameters: buildCodeTableRuleParameters(field, dictMap),
                  }));
                  const added = await insertReferenceRules(input.sessionId, items);
                  ruleUpdatesApplied += added;
                  message = `${message}\n\n✅ 已导入码表，新增 ${added} 条 standardize 规则`;
                  result = { ...result, action: "updateRule" };
                }
              } else {
                const parsed = parseDataStandardFile(refIntent.filePath);
                if (parsed.rules.length > 0) {
                  const items = parsed.rules.map((r) => {
                    const converted = dataStandardToRuleParams(r);
                    return {
                      field: r.field,
                      name: converted.name,
                      action: converted.action as "format" | "standardize",
                      strategy: r.description ?? `数据标准：${r.field}`,
                      parameters: converted.parameters,
                    };
                  });
                  const added = await insertReferenceRules(input.sessionId, items);
                  ruleUpdatesApplied += added;
                  message = `${message}\n\n✅ 已导入数据标准，新增 ${added} 条规则`;
                  result = { ...result, action: "updateRule" };
                }
              }
            } catch (refErr) {
              message = `${message}\n\n⚠️ 参考文件解析失败：${refErr instanceof Error ? refErr.message : String(refErr)}`;
            }
          }
        }

        const action = mapActionToClient(result.action);

        return {
          success: true,
          message,
          action,
          autoTrigger: result.autoTrigger ?? false,
          usedLlm: result.usedLlm,
          ruleUpdatesApplied,
          orchestratorRunId,
          orchestratorState,
        };
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: errMessage,
          message: "对话处理失败，请稍后重试或使用快捷按钮操作。",
          action: undefined,
          autoTrigger: false,
          usedLlm: false,
          ruleUpdatesApplied: 0,
        };
      }
    }),
});
