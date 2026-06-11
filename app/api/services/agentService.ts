import type { RuleUpdateIntent } from "@contracts/types";
import { applyRuleUpdatesFromNL } from "./ruleIntentService";
import { getFullSession } from "./sessionService";
import type { SessionChatContext, ChatActionIntent } from "./llmService";

export type AgentPlanStep =
  | { type: "explore"; tableName?: string }
  | { type: "analyze" }
  | { type: "updateRule"; ruleUpdates: RuleUpdateIntent[] }
  | { type: "confirmAll" }
  | { type: "generate" }
  | { type: "verify" }
  | { type: "scriptGen" }
  | { type: "exportScripts" }
  | { type: "execute"; dryRun?: boolean };

export interface AgentPlanResult {
  steps: AgentPlanStep[];
  executedSteps: string[];
  ruleUpdatesApplied: number;
  message: string;
  suggestAction?: ChatActionIntent;
  inlineRuleUpdates?: RuleUpdateIntent[];
}

const DB_TABLE_PATTERN = /(?:表|table)\s*[:：]?\s*[`"']?([\w\u4e00-\u9fff]+)[`"']?/i;
const EXPLORE_TABLE_PATTERN =
  /探查\s+[`"']?([\w\u4e00-\u9fff]+)[`"']?|explore\s+[`"']?([\w\u4e00-\u9fff]+)[`"']?/i;

function extractTableName(message: string, ctx: SessionChatContext): string | undefined {
  const exploreMatch = message.match(EXPLORE_TABLE_PATTERN);
  if (exploreMatch) return exploreMatch[1] || exploreMatch[2];
  const tableMatch = message.match(DB_TABLE_PATTERN);
  if (tableMatch) return tableMatch[1];
  return ctx.targetTable;
}

/** 检测一句话是否包含多步工作流意图 */
export function detectMultiIntent(userMessage: string, _ctx: SessionChatContext): boolean {
  const text = userMessage.toLowerCase();
  const verbs = [
    text.includes("探查") || text.includes("explore"),
    text.includes("分析") || text.includes("analyze"),
    text.includes("规则") || text.includes("填") || text.includes("填充"),
    text.includes("生成") || text.includes("generate") || text.includes("sql"),
    text.includes("执行") || text.includes("execute"),
    text.includes("一键") || text.includes("全流程") || text.includes("然后"),
  ].filter(Boolean).length;
  return verbs >= 2 || (verbs >= 1 && (text.includes("然后") || text.includes("再") || text.includes("并")));
}

/** 从自然语言解析 Agent 执行计划 */
export function parseAgentPlan(
  userMessage: string,
  ctx: SessionChatContext,
  ruleUpdates?: RuleUpdateIntent[]
): AgentPlanStep[] {
  const text = userMessage.toLowerCase();
  const steps: AgentPlanStep[] = [];
  const tableName = extractTableName(userMessage, ctx);

  if (
    text.includes("探查") ||
    text.includes("explore") ||
    (text.includes("一键") && !ctx.hasExploration)
  ) {
    steps.push({ type: "explore", tableName });
  }

  if (text.includes("分析") || text.includes("analyze")) {
    steps.push({ type: "analyze" });
  }

  if (ruleUpdates?.length) {
    steps.push({ type: "updateRule", ruleUpdates });
  } else if (
    (text.includes("填") || text.includes("填充") || text.includes("改成") || text.includes("换成")) &&
    ctx.rulesCount > 0
  ) {
    steps.push({ type: "updateRule", ruleUpdates: [] });
  }

  if (text.includes("确认") && text.includes("规则")) {
    steps.push({ type: "confirmAll" });
  }

  if (text.includes("生成") || text.includes("generate") || text.includes("sql")) {
    steps.push({ type: "generate" });
  }

  if (text.includes("校验") || text.includes("verify") || text.includes("验证")) {
    steps.push({ type: "verify" });
  }

  if (text.includes("soda") || text.includes("脚本") || text.includes("checks")) {
    steps.push({ type: "scriptGen" });
  }

  if (text.includes("导出") && (text.includes("包") || text.includes("bundle") || text.includes("artifact"))) {
    steps.push({ type: "exportScripts" });
  }

  if (text.includes("模拟") || text.includes("dry")) {
    steps.push({ type: "execute", dryRun: true });
  } else if (text.includes("执行") || text.includes("execute")) {
    steps.push({ type: "execute", dryRun: false });
  }

  if (
    steps.length === 0 &&
    (text.includes("一键") || text.includes("全流程") || text.includes("从头到尾"))
  ) {
    return [
      { type: "explore", tableName },
      { type: "analyze" },
      { type: "confirmAll" },
      { type: "generate" },
    ];
  }

  return steps;
}

/**
 * 顺序执行可在服务端完成的步骤；探查/生成/执行由前端 runAgentPlan 继续
 */
export async function runAgentPlan(
  sessionId: string,
  userMessage: string,
  ctx: SessionChatContext,
  ruleUpdates?: RuleUpdateIntent[]
): Promise<AgentPlanResult> {
  const steps = parseAgentPlan(userMessage, ctx, ruleUpdates);
  const executedSteps: string[] = [];
  let ruleUpdatesApplied = 0;
  const messages: string[] = [];

  const session = await getFullSession(sessionId);
  const existingRules = session?.cleaningRules ?? [];

  for (const step of steps) {
    if (step.type === "updateRule" && step.ruleUpdates.length > 0) {
      const result = await applyRuleUpdatesFromNL(sessionId, step.ruleUpdates, existingRules);
      ruleUpdatesApplied += result.applied;
      if (result.summaries.length) {
        messages.push(`已应用 ${result.applied} 条规则修改`);
        executedSteps.push("updateRule");
      }
      if (result.errors.length) {
        messages.push(result.errors.join("；"));
      }
    }
  }

  const needsFrontend = steps.some((s) =>
    ["explore", "analyze", "confirmAll", "generate", "verify", "scriptGen", "exportScripts", "execute"].includes(
      s.type
    )
  );

  const planSummary = steps.map((s) => {
    switch (s.type) {
      case "explore":
        return `探查${s.tableName ? `「${s.tableName}」` : ""}`;
      case "analyze":
        return "质量分析";
      case "updateRule":
        return "更新规则";
      case "confirmAll":
        return "确认规则";
      case "generate":
        return "生成 SQL";
      case "verify":
        return "SQL 校验";
      case "scriptGen":
        return "生成 Soda checks";
      case "exportScripts":
        return "导出脚本包";
      case "execute":
        return s.dryRun ? "模拟执行" : "执行清洗";
      default: {
        const _exhaustive: never = s;
        return _exhaustive;
      }
    }
  });

  const message =
    messages.length > 0
      ? `${messages.join("。")}。后续步骤：${planSummary.join(" → ")}`
      : `已为您规划后续步骤：${planSummary.join(" → ")}`;

  return {
    steps,
    executedSteps,
    ruleUpdatesApplied,
    message,
    suggestAction: needsFrontend ? "runAgentPlan" : undefined,
    inlineRuleUpdates: ruleUpdates,
  };
}
