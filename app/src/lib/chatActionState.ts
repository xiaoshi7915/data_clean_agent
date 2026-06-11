import type {
  ChatMessageAction,
  CleaningRule,
  ExplorationResult,
  ExecutionResult,
  QualityReport,
  SQLGenerationResult,
} from "@contracts/types";

/** 仅查看类操作，完成后仍可点击 */
const VIEW_ONLY_ACTIONS = new Set<ChatMessageAction["type"]>([
  "viewExplore",
  "viewQuality",
  "viewRules",
  "viewSQL",
  "updateRule",
  "skipRule",
  "confirmRule",
]);

export interface ChatActionSessionContext {
  currentPhase: import("@contracts/types").CleaningPhase;
  targetTable?: string;
  explorationResult?: ExplorationResult | null;
  qualityReport?: QualityReport | null;
  cleaningRules?: CleaningRule[];
  generatedSQL?: SQLGenerationResult | null;
  executionResult?: ExecutionResult | null;
}

/** 判断某条消息上的快捷按钮是否应置灰不可点 */
export function isChatActionDisabled(
  action: ChatMessageAction,
  ctx: ChatActionSessionContext
): boolean {
  if (action.disabled) return true;
  if (VIEW_ONLY_ACTIONS.has(action.type)) return false;

  const rules = ctx.cleaningRules ?? [];
  const allRulesConfirmed =
    rules.length === 0 || rules.every((r) => r.status === "confirmed" || r.status === "skipped");

  switch (action.type) {
    case "selectTable":
      return !!ctx.explorationResult;
    case "startExplore":
      return !!ctx.explorationResult;
    case "startAnalysis":
      return !!ctx.qualityReport;
    case "confirmAll":
      return allRulesConfirmed || !!ctx.generatedSQL;
    case "generateSQL":
      return !!ctx.generatedSQL;
    case "runFullPipeline":
    case "runAgentPlan":
      return !!ctx.generatedSQL;
    case "executeSQL":
    case "dryRunSQL":
      return (
        !ctx.generatedSQL ||
        ctx.executionResult?.overallStatus === "success"
      );
    case "viewExplore":
    case "viewQuality":
    case "viewRules":
    case "viewSQL":
    case "updateRule":
    case "skipRule":
    case "confirmRule":
      return false;
  }
}

/** 批量计算消息列表中各按钮的 disabled 状态 */
export function applyChatActionDisabledState(
  actions: ChatMessageAction[] | undefined,
  ctx: ChatActionSessionContext
): ChatMessageAction[] | undefined {
  if (!actions?.length) return actions;
  return actions.map((action) => ({
    ...action,
    disabled: isChatActionDisabled(action, ctx),
  }));
}
