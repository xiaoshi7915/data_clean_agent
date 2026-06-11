import { z } from "zod";
import { eq } from "drizzle-orm";
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
import {
  applyRuleUpdatesFromNL,
  expandBulkRuleUpdatesFromMessage,
  isBulkAllFieldsIntent,
} from "../services/ruleIntentService";
import { detectMultiIntent, runAgentPlan } from "../services/agentService";
import type { CleaningRule, RuleStatus } from "@contracts/types";

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

        const multiIntent = detectMultiIntent(input.userMessage, ctx);
        let agentPlanSteps: Awaited<ReturnType<typeof runAgentPlan>>["steps"] | undefined;

        if (input.sessionId && multiIntent) {
          const agentResult = await runAgentPlan(
            input.sessionId,
            input.userMessage,
            ctx,
            result.ruleUpdates
          );
          agentPlanSteps = agentResult.steps;
          ruleUpdatesApplied = agentResult.ruleUpdatesApplied;

          if (agentResult.executedSteps.includes("updateRule") && agentResult.ruleUpdatesApplied > 0) {
            const summaryText =
              agentResult.message.includes("已应用") ? agentResult.message : `${agentResult.message}`;
            message = `${message}\n\n✅ ${summaryText}`;
          } else {
            message = `${message}\n\n📋 ${agentResult.message}`;
          }

          if (agentResult.suggestAction) {
            result = {
              ...result,
              action: agentResult.suggestAction,
              autoTrigger: true,
            };
          }
        } else if (input.sessionId) {
          const db = getDb();
          const ruleRows = await db
            .select()
            .from(cleaningRules)
            .where(eq(cleaningRules.sessionId, input.sessionId))
            .orderBy(cleaningRules.ruleIndex);
          const existingRules = loadRulesFromRows(ruleRows);

          const bulkUpdates = expandBulkRuleUpdatesFromMessage(input.userMessage, existingRules);
          const updatesToApply =
            result.ruleUpdates?.length
              ? result.ruleUpdates
              : bulkUpdates?.length
                ? bulkUpdates
                : undefined;

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

        const action = mapActionToClient(result.action);

        return {
          success: true,
          message,
          action,
          autoTrigger: result.autoTrigger ?? false,
          usedLlm: result.usedLlm,
          ruleUpdatesApplied,
          agentPlanSteps,
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
