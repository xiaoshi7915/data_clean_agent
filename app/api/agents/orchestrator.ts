import type { OrchestratorContext, OrchestratorState } from "./types";

/** 状态机合法转移表 */
const TRANSITIONS: Record<OrchestratorState, OrchestratorState[]> = {
  schema_explore: ["quality_analyze", "failed"],
  quality_analyze: ["human_confirm", "failed"],
  human_confirm: ["repair_generate", "failed"],
  repair_generate: ["sql_verify", "failed"],
  sql_verify: ["script_gen", "repair_generate", "failed"],
  script_gen: ["artifact_export", "failed"],
  artifact_export: ["done", "failed"],
  done: [],
  failed: [],
};

/** 判断状态转移是否合法 */
export function canTransition(from: OrchestratorState, to: OrchestratorState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** 创建初始编排上下文 */
export function createOrchestratorContext(
  sessionId: string,
  tableName?: string
): OrchestratorContext {
  return {
    state: "schema_explore",
    input: { sessionId, tableName },
    errors: [],
  };
}

/** 推进状态机到下一状态（校验转移合法性） */
export function advanceOrchestrator(
  ctx: OrchestratorContext,
  next: OrchestratorState
): OrchestratorContext {
  if (!canTransition(ctx.state, next)) {
    return {
      ...ctx,
      state: "failed",
      errors: [...ctx.errors, `非法状态转移: ${ctx.state} → ${next}`],
    };
  }
  return { ...ctx, state: next };
}

/** 获取当前状态的下一步候选 */
export function nextStates(state: OrchestratorState): OrchestratorState[] {
  return TRANSITIONS[state] ?? [];
}

/** 标准流水线顺序（脚本-only 模式） */
export const SCRIPT_ONLY_PIPELINE: OrchestratorState[] = [
  "schema_explore",
  "quality_analyze",
  "human_confirm",
  "repair_generate",
  "sql_verify",
  "script_gen",
  "artifact_export",
  "done",
];
