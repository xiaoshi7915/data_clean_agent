import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { orchestrationRuns } from "@db/schema";
import { getDb } from "../queries/connection";
import { env } from "../lib/env";
import { getFullSession } from "../services/sessionService";
import {
  validatePhaseTransition,
  PhaseValidationError,
  type PhaseAction,
} from "../services/phaseValidator";
import { buildArtifactBundle } from "../services/artifactService";
import { runSchemaAgent } from "./schemaAgent";
import { runQualityAgent } from "./qualityAgent";
import { runRepairAgent } from "./repairAgent";
import { runVerifyAgent } from "./verifyAgent";
import { runScriptGenAgent } from "./scriptGenAgent";
import type {
  OrchestratorContext,
  OrchestratorEvent,
  OrchestratorFrontendAction,
  OrchestratorState,
  VerificationResult,
} from "./types";
import type { SessionChatContext } from "../services/llmService";
import {
  parseAgentPlan,
  type AgentPlanStep,
} from "../services/agentService";

/** 状态机合法转移表 */
const TRANSITIONS: Record<OrchestratorState, OrchestratorState[]> = {
  schema_explore: ["quality_analyze", "failed"],
  quality_analyze: ["human_confirm", "failed"],
  human_confirm: ["repair_generate", "failed"],
  repair_generate: ["sql_verify", "failed"],
  sql_verify: ["script_gen", "repair_generate", "failed"],
  script_gen: ["artifact_export", "failed"],
  artifact_export: ["external_verify", "done", "failed"],
  external_verify: ["done", "quality_analyze", "failed"],
  done: [],
  failed: [],
};

/** 事件 → 目标状态映射 */
const EVENT_TARGETS: Partial<Record<OrchestratorEvent, OrchestratorState>> = {
  explore_complete: "quality_analyze",
  analyze_complete: "human_confirm",
  confirm_complete: "repair_generate",
  repair_complete: "sql_verify",
  sql_verify_pass: "script_gen",
  sql_verify_fail: "repair_generate",
  script_complete: "artifact_export",
  export_complete: "external_verify",
  verify_pass: "done",
  verify_fail: "quality_analyze",
  fail: "failed",
};

/** 编排状态 → 阶段校验动作 */
const STATE_PHASE_GUARD: Partial<Record<OrchestratorState, PhaseAction>> = {
  schema_explore: "explore",
  quality_analyze: "analyze",
  human_confirm: "confirm",
  repair_generate: "generate",
  sql_verify: "generate",
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
    repairRound: 0,
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
  "external_verify",
  "done",
];

/** 将上下文序列化写入 DB */
async function persistRun(runId: string, _sessionId: string, ctx: OrchestratorContext): Promise<void> {
  const db = getDb();
  await db
    .update(orchestrationRuns)
    .set({
      state: ctx.state,
      context: ctx as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(orchestrationRuns.runId, runId));
}

/** 从 DB 加载编排运行 */
async function loadRun(runId: string): Promise<{ runId: string; sessionId: string; ctx: OrchestratorContext } | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(orchestrationRuns)
    .where(eq(orchestrationRuns.runId, runId))
    .limit(1);

  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    runId: row.runId,
    sessionId: row.sessionId,
    ctx: row.context as OrchestratorContext,
  };
}

/** 阶段守卫：进入目标状态前校验会话前置条件 */
async function assertPhaseGuard(ctx: OrchestratorContext, target: OrchestratorState): Promise<void> {
  const action = STATE_PHASE_GUARD[target];
  if (!action) return;
  await validatePhaseTransition(ctx.input.sessionId, action);
}

/** 在目标状态执行对应 Agent 处理器 */
async function invokeAgentHandler(
  ctx: OrchestratorContext,
  state: OrchestratorState
): Promise<OrchestratorContext> {
  const session = await getFullSession(ctx.input.sessionId);
  if (!session) {
    return { ...ctx, state: "failed", errors: [...ctx.errors, "会话不存在"] };
  }

  const tableName = ctx.input.tableName ?? session.targetTable ?? "data";
  const databaseName = session.dataSource?.dbConfig?.database ?? "default";
  const dialect =
    session.dataSource?.type === "postgresql" ? "postgresql" : "mysql";

  switch (state) {
    case "schema_explore": {
      if (!session.dataSource) {
        return { ...ctx, state: "failed", errors: [...ctx.errors, "未连接数据源"] };
      }
      const result = await runSchemaAgent({
        sessionId: ctx.input.sessionId,
        dataSource: session.dataSource,
        dbConfig: session.dataSource.dbConfig,
        tableName,
      });
      if (!result.success || !result.data) {
        return { ...ctx, state: "failed", errors: [...ctx.errors, result.error ?? "探查失败"] };
      }
      return {
        ...ctx,
        exploration: result.data.exploration,
        input: { ...ctx.input, tableName, exploration: result.data.exploration },
      };
    }
    case "quality_analyze": {
      const exploration = ctx.exploration ?? session.explorationResult;
      if (!exploration) {
        return { ...ctx, state: "failed", errors: [...ctx.errors, "缺少探查结果"] };
      }
      const result = runQualityAgent({
        sessionId: ctx.input.sessionId,
        exploration,
      });
      if (!result.success || !result.data) {
        return { ...ctx, state: "failed", errors: [...ctx.errors, result.error ?? "质量分析失败"] };
      }
      return {
        ...ctx,
        qualityReport: result.data.report,
        rules: result.data.rules,
      };
    }
    case "repair_generate": {
      const rules = ctx.rules ?? session.cleaningRules ?? [];
      const result = runRepairAgent({
        sessionId: ctx.input.sessionId,
        rules,
        dialect,
        tableName,
        databaseName,
        columns: session.explorationResult?.schema.map((c) => c.name) ?? [],
      });
      if (!result.success || !result.data) {
        return { ...ctx, state: "failed", errors: [...ctx.errors, result.error ?? "SQL 生成失败"] };
      }
      return { ...ctx, sqlResult: result.data.sqlResult };
    }
    case "sql_verify": {
      const steps = ctx.sqlResult?.steps ?? session.generatedSQL?.steps ?? [];
      if (steps.length === 0) {
        return { ...ctx, state: "failed", errors: [...ctx.errors, "无可校验 SQL 步骤"] };
      }
      const result = await runVerifyAgent({
        sessionId: ctx.input.sessionId,
        steps,
        dialect,
        dbConfig: session.dataSource?.dbConfig,
      });
      if (!result.success || !result.data) {
        return { ...ctx, state: "failed", errors: [...ctx.errors, result.error ?? "SQL 校验失败"] };
      }
      return { ...ctx, verifyResult: result.data };
    }
    case "script_gen": {
      const rules = ctx.rules ?? session.cleaningRules ?? [];
      const dataset = session.dataSource?.dbConfig
        ? `datasource/${databaseName}/default/${tableName}`
        : `file/${tableName}`;
      const result = runScriptGenAgent({
        dataset,
        exploration: ctx.exploration ?? session.explorationResult,
        qualityReport: ctx.qualityReport ?? session.qualityReport,
        rules,
      });
      if (!result.success || !result.data) {
        return { ...ctx, state: "failed", errors: [...ctx.errors, result.error ?? "脚本生成失败"] };
      }
      return { ...ctx, scriptGen: result.data };
    }
    case "artifact_export": {
      const rules = ctx.rules ?? session.cleaningRules ?? [];
      const sqlResult = ctx.sqlResult ?? session.generatedSQL;
      if (!sqlResult) {
        return { ...ctx, state: "failed", errors: [...ctx.errors, "缺少 SQL 结果"] };
      }
      const bundle = buildArtifactBundle({
        sessionId: ctx.input.sessionId,
        rules,
        sqlResult,
        dialect,
        tableName,
        databaseName,
        sessionTitle: session.sessionTitle,
      });
      return {
        ...ctx,
        artifacts: { files: bundle.files, manifest: bundle.manifest },
      };
    }
    default:
      return ctx;
  }
}

/** 根据事件解析目标状态（含反馈回环逻辑） */
export function resolveEventTarget(
  ctx: OrchestratorContext,
  event: OrchestratorEvent
): OrchestratorState | null {
  if (event === "verify_fail") {
    const round = ctx.repairRound ?? 0;
    if (round >= env.maxRepairRounds) {
      return "failed";
    }
    return "quality_analyze";
  }

  if (event === "sql_verify_fail") {
    return "repair_generate";
  }

  return EVENT_TARGETS[event] ?? null;
}

/**
 * 创建编排运行并持久化到 DB
 */
export async function startRun(
  sessionId: string,
  tableName?: string
): Promise<{ runId: string; ctx: OrchestratorContext }> {
  const runId = `run_${uuidv4().replace(/-/g, "").slice(0, 16)}`;
  const ctx = createOrchestratorContext(sessionId, tableName);
  const db = getDb();
  await db.insert(orchestrationRuns).values({
    runId,
    sessionId,
    state: ctx.state,
    context: ctx as unknown as Record<string, unknown>,
  });
  return { runId, ctx };
}

/**
 * 推进编排运行：校验转移 → 执行 Agent → 持久化
 */
export async function advanceRun(
  runId: string,
  event: OrchestratorEvent,
  payload?: { verification?: VerificationResult }
): Promise<{ ctx: OrchestratorContext; transitioned: boolean }> {
  const loaded = await loadRun(runId);
  if (!loaded) {
    throw new Error(`编排运行不存在: ${runId}`);
  }

  let ctx = loaded.ctx;

  if (payload?.verification) {
    ctx = { ...ctx, externalVerification: payload.verification };
  }

  const target = resolveEventTarget(ctx, event);
  if (!target) {
    return { ctx, transitioned: false };
  }

  // verify_fail 回环时递增修复轮次
  if (event === "verify_fail" && target === "quality_analyze") {
    ctx = { ...ctx, repairRound: (ctx.repairRound ?? 0) + 1 };
  }

  // sql_verify 事件根据校验结果分支
  if (event === "sql_verify_pass" || event === "sql_verify_fail") {
    // 已由 resolveEventTarget 处理
  } else if (ctx.state === "sql_verify" && ctx.verifyResult) {
    const branch = ctx.verifyResult.valid ? "sql_verify_pass" : "sql_verify_fail";
    const branchTarget = resolveEventTarget(ctx, branch as OrchestratorEvent);
    if (branchTarget && event === "repair_complete") {
      // repair_complete 后自动根据校验结果分支
    }
  }

  try {
    await assertPhaseGuard(ctx, target);
  } catch (error) {
    const msg = error instanceof PhaseValidationError ? error.message : String(error);
    ctx = { ...ctx, state: "failed", errors: [...ctx.errors, msg] };
    await persistRun(runId, loaded.sessionId, ctx);
    return { ctx, transitioned: true };
  }

  const nextCtx = advanceOrchestrator(ctx, target);
  if (nextCtx.state === "failed") {
    await persistRun(runId, loaded.sessionId, nextCtx);
    return { ctx: nextCtx, transitioned: true };
  }

  // 进入新状态后执行 Agent（done/failed/external_verify 除外）
  let enriched = nextCtx;
  const handlerStates: OrchestratorState[] = [
    "schema_explore",
    "quality_analyze",
    "repair_generate",
    "sql_verify",
    "script_gen",
    "artifact_export",
  ];

  if (handlerStates.includes(target)) {
    enriched = await invokeAgentHandler(nextCtx, target);

    // sql_verify 完成后自动分支
    if (target === "sql_verify" && enriched.verifyResult) {
      const branchEvent: OrchestratorEvent = enriched.verifyResult.valid
        ? "sql_verify_pass"
        : "sql_verify_fail";
      const branchTarget = resolveEventTarget(enriched, branchEvent);
      if (branchTarget && canTransition(enriched.state, branchTarget)) {
        enriched = advanceOrchestrator(enriched, branchTarget);
      }
    }
  }

  await persistRun(runId, loaded.sessionId, enriched);
  return { ctx: enriched, transitioned: true };
}

/** 查询编排运行状态 */
export async function getRunStatus(
  runId: string
): Promise<{ runId: string; sessionId: string; state: OrchestratorState; context: OrchestratorContext } | null> {
  const loaded = await loadRun(runId);
  if (!loaded) return null;
  return {
    runId: loaded.runId,
    sessionId: loaded.sessionId,
    state: loaded.ctx.state,
    context: loaded.ctx,
  };
}

/** 按会话列出编排运行 */
export async function listRunsBySession(
  sessionId: string
): Promise<Array<{ runId: string; state: OrchestratorState; createdAt: Date }>> {
  const db = getDb();
  const rows = await db
    .select({
      runId: orchestrationRuns.runId,
      state: orchestrationRuns.state,
      createdAt: orchestrationRuns.createdAt,
    })
    .from(orchestrationRuns)
    .where(eq(orchestrationRuns.sessionId, sessionId));

  return rows.map((r) => ({
    runId: r.runId,
    state: r.state as OrchestratorState,
    createdAt: r.createdAt,
  }));
}

/** 一键/多步流水线在 human_confirm 暂停，等待用户确认规则 */
export const PIPELINE_PAUSE_STATES: OrchestratorState[] = ["human_confirm"];

/** Agent 计划步骤 → 编排事件 */
const PLAN_STEP_EVENT: Partial<Record<AgentPlanStep["type"], OrchestratorEvent>> = {
  explore: "explore_complete",
  analyze: "analyze_complete",
  confirmAll: "confirm_complete",
  generate: "repair_complete",
  verify: "repair_complete",
  scriptGen: "script_complete",
  exportScripts: "export_complete",
};

/** Agent 计划步骤 → 前端动作 */
function planStepToAction(step: AgentPlanStep): OrchestratorFrontendAction | null {
  switch (step.type) {
    case "explore":
      return { type: "startExplore", label: "开始数据探查", autoTrigger: true };
    case "analyze":
      return { type: "startAnalysis", label: "开始质量分析", autoTrigger: true };
    case "confirmAll":
      return { type: "confirmAll", label: "确认全部规则", autoTrigger: false };
    case "generate":
      return { type: "generateSQL", label: "生成清洗 SQL", autoTrigger: false };
    case "verify":
      return { type: "generateSQL", label: "校验 SQL", autoTrigger: false };
    case "scriptGen":
      return { type: "exportScripts", label: "生成校验脚本", autoTrigger: false };
    case "exportScripts":
      return { type: "exportScripts", label: "导出脚本包", autoTrigger: true };
    case "execute":
      return { type: "executeSQL", label: step.dryRun ? "模拟执行" : "执行清洗", autoTrigger: false };
    case "updateRule":
      return null;
    default: {
      const _exhaustive: never = step;
      void _exhaustive;
      return null;
    }
  }
}

/** 沿 SCRIPT_ONLY_PIPELINE 推进，遇到 human_confirm 等暂停态则停止 */
async function advancePipelineUntilPause(
  runId: string,
  startState: OrchestratorState
): Promise<OrchestratorContext> {
  let current = (await getRunStatus(runId))?.context;
  if (!current) {
    throw new Error(`编排运行不存在: ${runId}`);
  }

  const startIdx = SCRIPT_ONLY_PIPELINE.indexOf(startState);
  if (startIdx < 0) return current;

  for (let i = startIdx + 1; i < SCRIPT_ONLY_PIPELINE.length; i++) {
    const step = SCRIPT_ONLY_PIPELINE[i];
    const eventMap: Partial<Record<OrchestratorState, OrchestratorEvent>> = {
      quality_analyze: "explore_complete",
      human_confirm: "analyze_complete",
      repair_generate: "confirm_complete",
      sql_verify: "repair_complete",
      script_gen: "sql_verify_pass",
      artifact_export: "script_complete",
      external_verify: "export_complete",
      done: "verify_pass",
    };
    const event = eventMap[step];
    if (!event) continue;

    try {
      const result = await advanceRun(runId, event);
      current = result.ctx;
      if (current.state === "failed") break;
      if (PIPELINE_PAUSE_STATES.includes(current.state)) break;
    } catch {
      break;
    }
  }

  return current;
}
/** 从用户消息解析编排意图（关键词） */
function parseOrchestratorIntent(
  message: string,
  chatCtx: SessionChatContext
): { event?: OrchestratorEvent; startPipeline?: boolean; actions: OrchestratorFrontendAction[] } {
  const lower = message.toLowerCase();
  const actions: OrchestratorFrontendAction[] = [];

  if (/一键|全流程|完整流程|runFullPipeline|full.?pipeline/i.test(message)) {
    return {
      startPipeline: true,
      event: "explore_complete",
      actions: [
        { type: "runFullPipeline", label: "一键执行清洗流程", autoTrigger: true },
      ],
    };
  }

  if (/探查|explore/i.test(lower) && !chatCtx.hasExploration) {
    actions.push({ type: "startExplore", label: "开始数据探查", autoTrigger: true });
    return { event: "explore_complete", actions };
  }

  if (/质量|分析|analyze/i.test(lower) && chatCtx.hasExploration && !chatCtx.hasQualityReport) {
    actions.push({ type: "startAnalysis", label: "开始质量分析", autoTrigger: true });
    return { event: "analyze_complete", actions };
  }

  if (/确认.*规则|confirm/i.test(lower) && chatCtx.rulesCount > 0) {
    actions.push({ type: "confirmAll", label: "确认全部规则", autoTrigger: true });
    return { event: "confirm_complete", actions };
  }

  if (/生成.*sql|generate/i.test(lower) && chatCtx.confirmedRulesCount > 0) {
    actions.push({ type: "generateSQL", label: "生成清洗 SQL", autoTrigger: true });
    return { event: "repair_complete", actions };
  }

  if (/导出|export|脚本包/i.test(lower)) {
    actions.push({ type: "exportScripts", label: "导出脚本包", autoTrigger: true });
    return { event: "export_complete", actions };
  }

  return { actions };
}

/**
 * 多步 NL 计划：创建/复用 run，按步骤映射前端动作（不在服务端自动越过 human_confirm）
 */
export async function handleMultiStepPlan(
  sessionId: string,
  message: string,
  chatCtx: SessionChatContext,
  ruleUpdates?: import("@contracts/types").RuleUpdateIntent[]
): Promise<{
  runId: string;
  state: OrchestratorState;
  message: string;
  actions: OrchestratorFrontendAction[];
  orchestrated: boolean;
}> {
  const steps = parseAgentPlan(message, chatCtx, ruleUpdates);
  const frontendSteps = steps.filter((s) => s.type !== "updateRule");
  const actions = frontendSteps
    .map(planStepToAction)
    .filter((a): a is OrchestratorFrontendAction => a !== null);

  const existing = await listRunsBySession(sessionId);
  const active = existing.find((r) => r.state !== "done" && r.state !== "failed");
  const { runId, ctx } = active
    ? { runId: active.runId, ctx: (await getRunStatus(active.runId))?.context ?? createOrchestratorContext(sessionId) }
    : await startRun(sessionId, chatCtx.targetTable);

  let current = ctx;
  for (const step of frontendSteps) {
    const event = PLAN_STEP_EVENT[step.type];
    if (!event) continue;
    if (step.type === "confirmAll" || step.type === "generate") {
      // 需用户显式确认后再 advance
      break;
    }
    try {
      const result = await advanceRun(runId, event);
      current = result.ctx;
      if (current.state === "failed" || PIPELINE_PAUSE_STATES.includes(current.state)) break;
    } catch {
      break;
    }
  }

  const planSummary = frontendSteps.map((s) => s.type).join(" → ");
  const pauseHint =
    current.state === "human_confirm"
      ? "请在规则面板确认后再生成 SQL。"
      : "";

  return {
    runId,
    state: current.state,
    message: `编排已规划：${planSummary}${pauseHint ? `。${pauseHint}` : ""}`,
    actions,
    orchestrated: true,
  };
}

/**
 * 处理用户消息：解析意图、启动/推进编排，返回前端动作
 */
export async function handleUserMessage(
  sessionId: string,
  message: string,
  chatCtx: SessionChatContext
): Promise<{
  runId?: string;
  state?: OrchestratorState;
  message: string;
  actions: OrchestratorFrontendAction[];
  orchestrated: boolean;
}> {
  const intent = parseOrchestratorIntent(message, chatCtx);

  if (!intent.startPipeline && intent.actions.length === 0) {
    return {
      message: "",
      actions: [],
      orchestrated: false,
    };
  }

  // 查找活跃运行或创建新运行
  const existing = await listRunsBySession(sessionId);
  const active = existing.find((r) => r.state !== "done" && r.state !== "failed");

  let runId: string;
  let ctx: OrchestratorContext;

  if (intent.startPipeline || !active) {
    const started = await startRun(sessionId, chatCtx.targetTable);
    runId = started.runId;
    ctx = started.ctx;
  } else {
    runId = active.runId;
    const status = await getRunStatus(runId);
    ctx = status?.context ?? createOrchestratorContext(sessionId);
  }

  // 一键流程：推进至 human_confirm 暂停，等待用户确认规则
  if (intent.startPipeline) {
    const current = await advancePipelineUntilPause(runId, ctx.state);
    const pauseActions: OrchestratorFrontendAction[] =
      current.state === "human_confirm"
        ? [
            { type: "viewRules", label: "查看清洗规则", autoTrigger: false },
            { type: "confirmAll", label: "确认全部规则", autoTrigger: false },
          ]
        : intent.actions;

    const pauseMessage =
      current.state === "human_confirm"
        ? "一键流程已暂停于规则确认：请先查看并确认清洗规则，再生成 SQL。"
        : `编排已推进至 ${current.state}`;

    return {
      runId,
      state: current.state,
      message: pauseMessage,
      actions: pauseActions,
      orchestrated: true,
    };
  }

  // 单步事件推进
  if (intent.event) {
    const result = await advanceRun(runId, intent.event);
    return {
      runId,
      state: result.ctx.state,
      message: `编排状态: ${result.ctx.state}`,
      actions: intent.actions,
      orchestrated: true,
    };
  }

  return {
    runId,
    state: ctx.state,
    message: "",
    actions: intent.actions,
    orchestrated: true,
  };
}

/**
 * 脚本-only 编排辅助：从当前状态沿 SCRIPT_ONLY_PIPELINE 推进到 done，并持久化。
 */
export async function runScriptOnlyPipeline(
  ctx: OrchestratorContext,
  runId?: string,
  sessionId?: string
): Promise<OrchestratorContext> {
  let current = ctx;
  const idx = SCRIPT_ONLY_PIPELINE.indexOf(current.state);
  if (idx < 0) return current;

  for (let i = idx + 1; i < SCRIPT_ONLY_PIPELINE.length; i++) {
    const next = SCRIPT_ONLY_PIPELINE[i];
    current = advanceOrchestrator(current, next);
    if (current.state === "failed") break;
  }

  if (runId && sessionId) {
    await persistRun(runId, sessionId, current);
  }

  return current;
}

/** 处理外部校验 webhook 结果 */
export async function ingestVerificationResult(
  runId: string,
  status: "pass" | "fail",
  details?: string
): Promise<{ ctx: OrchestratorContext }> {
  const event: OrchestratorEvent = status === "pass" ? "verify_pass" : "verify_fail";
  const verification: VerificationResult = {
    status: status === "pass" ? "pass" : "fail",
    details,
  };
  const result = await advanceRun(runId, event, { verification });
  return { ctx: result.ctx };
}
