import { env } from "../lib/env";
import type { RuleUpdateIntent } from "@contracts/types";

export type ChatActionIntent =
  | "selectTable"
  | "startExplore"
  | "viewExplore"
  | "startAnalysis"
  | "viewQuality"
  | "viewRules"
  | "confirmAll"
  | "generateSQL"
  | "viewSQL"
  | "runFullPipeline"
  | "runAgentPlan"
  | "updateRule"
  | "skipRule"
  | "confirmRule"
  | "executeSQL"
  | "dryRunSQL"
  | "exportScripts"
  | "none";

export interface LlmChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface SessionChatContext {
  phase: string;
  dataSourceName?: string;
  targetTable?: string;
  hasExploration: boolean;
  hasQualityReport: boolean;
  rulesCount: number;
  confirmedRulesCount: number;
  hasGeneratedSQL: boolean;
  hasExecutionResult: boolean;
}

export interface LlmChatResponse {
  message: string;
  action?: ChatActionIntent;
  autoTrigger?: boolean;
  usedLlm: boolean;
  ruleUpdates?: RuleUpdateIntent[];
}

const ACTION_LABELS: Record<ChatActionIntent, string> = {
  selectTable: "选择数据表",
  startExplore: "开始探查",
  viewExplore: "查看探查报告",
  startAnalysis: "进入质量分析",
  viewQuality: "查看质量报告",
  viewRules: "查看清洗规则",
  confirmAll: "确认全部规则",
  generateSQL: "生成清洗SQL",
  viewSQL: "查看清洗SQL",
  runFullPipeline: "一键生成SQL",
  runAgentPlan: "执行多步计划",
  updateRule: "更新清洗规则",
  skipRule: "跳过规则",
  confirmRule: "确认规则",
  executeSQL: "执行清洗",
  dryRunSQL: "模拟执行",
  exportScripts: "导出脚本包",
  none: "",
};

function buildSystemPrompt(ctx: SessionChatContext): string {
  return `你是「数据工程师的数据清洗智能体」，帮助用户完成数据库/文件的数据探查、质量分析、规则确认、SQL 生成与执行。

当前会话状态：
- 阶段：${ctx.phase}
- 数据源：${ctx.dataSourceName || "未连接"}
- 目标表：${ctx.targetTable || "未选择"}
- 已完成探查：${ctx.hasExploration ? "是" : "否"}
- 已完成质量分析：${ctx.hasQualityReport ? "是" : "否"}
- 清洗规则：${ctx.rulesCount} 条（已确认 ${ctx.confirmedRulesCount} 条）
- 已生成 SQL：${ctx.hasGeneratedSQL ? "是" : "否"}
- 已执行清洗：${ctx.hasExecutionResult ? "是" : "否"}

可用工作流动作（在回复 JSON 的 action 字段中返回其一，无动作则返回 "none"）：
- selectTable：用户需要选择数据表
- startExplore：开始数据探查
- viewExplore：查看探查报告
- startAnalysis：开始质量分析
- viewQuality：查看质量报告
- viewRules：查看/调整清洗规则
- confirmAll：确认全部规则
- generateSQL：生成清洗 SQL
- viewSQL：查看已生成的 SQL
- runFullPipeline：一键完成探查→分析→确认规则→生成 SQL（用户说「一键」「全流程」「从头到尾」时使用）
- runAgentPlan：用户一句话包含多个步骤（如「探查某表并把某字段填成当前时间然后生成SQL」）时使用
- updateRule：用户要用自然语言修改规则参数（必须同时返回 ruleUpdates 数组）
- skipRule：跳过某条规则（ruleUpdates 中 action 设为 "skip"）
- confirmRule：确认某条规则（ruleUpdates 中 action 设为 "confirm"）
- executeSQL：执行清洗 SQL
- dryRunSQL：模拟执行（不写入）

规则自然语言修改（ruleUpdates）：
- 当用户描述字段填充、策略切换、确认/跳过某规则时，action 设为 "updateRule"（或 skipRule/confirmRule）
- 当用户要求「新增/添加字段」「在 X 字段后添加 Y」「Y 作为 X 的映射列」时，返回 addDerivedColumn（新列名）与 field（源字段），可选 insertAfter
- 示例：在 level 后添加 level_code 映射 → {"field":"level","addDerivedColumn":"level_code","insertAfter":"level"}
- ruleUpdates 中 field 必须是用户提到的真实列名，禁止使用「字段名」等占位符
- 用户说「所有字段」「全部字段」且要统一填充时，为每个相关字段各生成一条 ruleUpdates（field 为真实列名）
- 用户说「把 X 都补充为 Y」「填充为 Y」时，返回 variantKey:"fixed"、fillValue:"Y"；「都补充/都填」表示 replaceAll:true
- 理解示例（禁止原样输出到 message）：website→未知；punishment→服刑中；assi_time→NOW()；age→skip
- field 尽量与探查 schema 一致

回复要求：
1. message 必须是自然、简洁的中文，像资深数据工程师与同事对话
2. 禁止在 message 中输出 JSON 结构说明、schema 模板或 ruleUpdates 格式示例
3. 根据当前阶段引导下一步，不要跳步
4. 必须返回合法 JSON（不要 markdown 代码块），结构：message + action + autoTrigger + ruleUpdates（可无）
5. 当用户意图非常明确（如「开始探查」「一键清洗」「生成SQL」）时，可设 autoTrigger 为 true
6. action 只能是上述动作名或 "none"；无规则修改时省略 ruleUpdates 或返回空数组`;
}

/** 检测 LLM 是否把 prompt 中的 schema/占位符当作回复正文 */
export function isTemplateOrPlaceholderMessage(message: string): boolean {
  const text = message.trim();
  if (!text) return true;

  const markers = [
    '"field": "字段名"',
    '"field":"字段名"',
    "variantKey",
    "可选策略",
    "可选填充值",
    "可选 confirm|skip",
    '{"field":',
    "ruleUpdates 元素格式",
    "ruleUpdates 数组",
  ];
  if (markers.some((m) => text.includes(m))) return true;

  if (/^\s*\{[\s\S]*"field"\s*:\s*"字段名"/.test(text)) return true;
  if (text.startsWith("{") && text.includes("fillValue") && !text.includes("message")) return true;

  return false;
}

function isPlaceholderRuleUpdate(update: RuleUpdateIntent): boolean {
  const field = update.field.trim();
  if (!field) return true;
  const placeholders = ["字段名", "列名", "field", "column", "可选", "示例"];
  const lower = field.toLowerCase();
  return placeholders.some((p) => lower === p || field.includes("字段名"));
}

const VALID_ACTIONS: ChatActionIntent[] = [
  "selectTable",
  "startExplore",
  "viewExplore",
  "startAnalysis",
  "viewQuality",
  "viewRules",
  "confirmAll",
  "generateSQL",
  "viewSQL",
  "runFullPipeline",
  "runAgentPlan",
  "updateRule",
  "skipRule",
  "confirmRule",
  "executeSQL",
  "dryRunSQL",
  "none",
];

function parseRuleUpdates(raw: unknown): RuleUpdateIntent[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const updates: RuleUpdateIntent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const field = typeof record.field === "string" ? record.field.trim() : "";
    if (!field) continue;
    const intent: RuleUpdateIntent = { field };
    if (typeof record.variantKey === "string" && record.variantKey.trim()) {
      intent.variantKey = record.variantKey.trim();
    }
    if (record.fillValue !== undefined && record.fillValue !== null) {
      if (typeof record.fillValue === "object" && record.fillValue !== null) {
        const obj = record.fillValue as Record<string, unknown>;
        if (obj.type === "expression" && typeof obj.value === "string") {
          intent.fillValue = obj.value;
        }
      } else {
        intent.fillValue =
          typeof record.fillValue === "number" ? record.fillValue : String(record.fillValue);
      }
    }
    if (typeof record.action === "string" && record.action.trim()) {
      intent.action = record.action.trim();
    }
    if (typeof record.addDerivedColumn === "string" && record.addDerivedColumn.trim()) {
      intent.addDerivedColumn = record.addDerivedColumn.trim();
    }
    if (typeof record.insertAfter === "string" && record.insertAfter.trim()) {
      intent.insertAfter = record.insertAfter.trim();
    }
    updates.push(intent);
  }
  return updates.length > 0 ? updates : undefined;
}

export function parseLlmJson(content: string): {
  message: string;
  action?: ChatActionIntent;
  autoTrigger?: boolean;
  ruleUpdates?: RuleUpdateIntent[];
  rejectedAsTemplate?: boolean;
} {
  const trimmed = content.trim();
  if (!trimmed) {
    return { message: "", rejectedAsTemplate: true };
  }

  if (isTemplateOrPlaceholderMessage(trimmed) && !trimmed.includes('"message"')) {
    return { message: "", rejectedAsTemplate: true };
  }

  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    if (isTemplateOrPlaceholderMessage(trimmed)) {
      return { message: "", rejectedAsTemplate: true };
    }
    return { message: trimmed };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      message?: string;
      action?: string;
      autoTrigger?: boolean;
      ruleUpdates?: unknown;
    };
    const action = parsed.action as ChatActionIntent | undefined;
    const message = parsed.message?.trim() || "";
    const ruleUpdates = parseRuleUpdates(parsed.ruleUpdates);

    if (ruleUpdates?.some(isPlaceholderRuleUpdate)) {
      return { message: "", rejectedAsTemplate: true };
    }

    const finalMessage = message || (isTemplateOrPlaceholderMessage(trimmed) ? "" : trimmed);
    if (!finalMessage || isTemplateOrPlaceholderMessage(finalMessage)) {
      return {
        message: "",
        action: action && VALID_ACTIONS.includes(action) ? action : undefined,
        autoTrigger: Boolean(parsed.autoTrigger),
        ruleUpdates: ruleUpdates?.filter((u) => !isPlaceholderRuleUpdate(u)),
        rejectedAsTemplate: true,
      };
    }

    return {
      message: finalMessage,
      action: action && VALID_ACTIONS.includes(action) ? action : undefined,
      autoTrigger: Boolean(parsed.autoTrigger),
      ruleUpdates,
    };
  } catch {
    if (isTemplateOrPlaceholderMessage(trimmed)) {
      return { message: "", rejectedAsTemplate: true };
    }
    return { message: trimmed };
  }
}

type LlmApiMessage = {
  content?: string | null;
  reasoning?: string | null;
  reasoning_content?: string | null;
  text?: string | null;
};

type LlmApiResponse = {
  choices?: {
    message?: LlmApiMessage;
    finish_reason?: string | null;
  }[];
  error?: { message?: string };
};

/** 从 reasoning 文本末尾提取 JSON 块（部分推理模型在 content 为空时仍会在 reasoning 中写出答案） */
function extractJsonFromReasoning(reasoning: string): string | null {
  const matches = reasoning.match(/\{[\s\S]*?\}/g);
  if (!matches?.length) return null;
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(matches[i]) as { message?: string };
      const msg = parsed.message?.trim() ?? "";
      if (msg && !isTemplateOrPlaceholderMessage(msg)) {
        return matches[i];
      }
    } catch {
      // 继续尝试更早的 JSON 块
    }
  }
  return null;
}

/** 兼容 OpenAI / MiniMax 等网关：content 可能为空，实际文本在 reasoning 等字段 */
function extractLlmText(data: LlmApiResponse): { text: string; source: string } | null {
  const choice = data.choices?.[0];
  const message = choice?.message;
  if (!message) return null;

  const content = typeof message.content === "string" ? message.content.trim() : "";
  if (content) {
    return { text: content, source: "content" };
  }

  const reasoningContent =
    typeof message.reasoning_content === "string" ? message.reasoning_content.trim() : "";
  if (reasoningContent) {
    return { text: reasoningContent, source: "reasoning_content" };
  }

  const reasoning = typeof message.reasoning === "string" ? message.reasoning.trim() : "";
  if (reasoning) {
    const jsonFromReasoning = extractJsonFromReasoning(reasoning);
    if (jsonFromReasoning) {
      return { text: jsonFromReasoning, source: "reasoning" };
    }
    return { text: reasoning, source: "reasoning" };
  }

  const text = typeof message.text === "string" ? message.text.trim() : "";
  if (text) {
    return { text, source: "text" };
  }

  return null;
}

/** LLM 失败或不可用时是否应降级到关键词匹配 */
export function shouldUseKeywordFallback(result: LlmChatResponse): boolean {
  if (!result.usedLlm) return true;
  if (!result.message.trim()) return true;
  if (isTemplateOrPlaceholderMessage(result.message)) return true;
  return false;
}

export function keywordFallback(
  userMessage: string,
  ctx: SessionChatContext
): LlmChatResponse {
  const text = userMessage.toLowerCase();

  if (
    text.includes("一键") ||
    text.includes("全流程") ||
    text.includes("从头到尾") ||
    text.includes("full pipeline")
  ) {
    if (ctx.targetTable || ctx.hasExploration) {
      return {
        message: "好的，将为您一键完成探查、分析、确认规则并生成清洗 SQL。",
        action: "runFullPipeline",
        autoTrigger: true,
        usedLlm: false,
      };
    }
    return {
      message: "一键流程需要先选择数据表，请先选表。",
      action: "selectTable",
      autoTrigger: true,
      usedLlm: false,
    };
  }

  if (
    (text.includes("所有") || text.includes("全部")) &&
    (text.includes("字段") || text.includes("列")) &&
    (text.includes("空") || text.includes("null")) &&
    ctx.rulesCount > 0
  ) {
    return {
      message: "好的，将把相关字段的空值统一填充为 NULL，正在应用规则修改。",
      action: "updateRule",
      autoTrigger: false,
      usedLlm: false,
    };
  }

  if (
    (text.includes("填") || text.includes("空值") || text.includes("填充") || text.includes("替换")) &&
    ctx.rulesCount > 0
  ) {
    return {
      message:
        "我理解您想修改空值填充规则。请说明字段名和填充值，例如：「把 website 空值填成未知」或「所有字段空值替换为 NULL」。",
      action: "updateRule",
      autoTrigger: false,
      usedLlm: false,
    };
  }

  if (text.includes("选表") || text.includes("选择表") || text.includes("select table")) {
    return {
      message: "好的，请先选择要探查的数据表。",
      action: "selectTable",
      autoTrigger: true,
      usedLlm: false,
    };
  }
  if (text.includes("探查") || text.includes("explore")) {
    if (ctx.targetTable) {
      return { message: "正在为您启动数据探查。", action: "startExplore", autoTrigger: true, usedLlm: false };
    }
    return { message: "请先选择数据表，再开始探查。", action: "selectTable", autoTrigger: true, usedLlm: false };
  }
  if (text.includes("分析") || text.includes("analyze")) {
    return { message: "开始质量分析。", action: "startAnalysis", autoTrigger: true, usedLlm: false };
  }
  if (text.includes("确认") && text.includes("规则")) {
    return { message: "已为您确认全部规则。", action: "confirmAll", autoTrigger: true, usedLlm: false };
  }
  if (text.includes("规则")) {
    return { message: "请查看清洗规则列表。", action: "viewRules", autoTrigger: true, usedLlm: false };
  }
  if (text.includes("生成") || text.includes("generate")) {
    return { message: "正在生成清洗 SQL。", action: "generateSQL", autoTrigger: true, usedLlm: false };
  }
  if (text.includes("模拟") || text.includes("dry")) {
    return { message: "将进行模拟执行。", action: "dryRunSQL", autoTrigger: true, usedLlm: false };
  }
  if (text.includes("执行") || text.includes("execute")) {
    return { message: "将执行清洗 SQL。", action: "executeSQL", autoTrigger: true, usedLlm: false };
  }
  if (text.includes("报告")) {
    if (ctx.hasExploration) {
      return { message: "打开探查报告。", action: "viewExplore", autoTrigger: true, usedLlm: false };
    }
    if (ctx.hasQualityReport) {
      return { message: "打开质量报告。", action: "viewQuality", autoTrigger: true, usedLlm: false };
    }
  }
  if (text.includes("sql")) {
    return { message: "查看已生成的 SQL。", action: "viewSQL", autoTrigger: true, usedLlm: false };
  }

  return {
    message:
      "收到！我是您的数据清洗助手。您可以让我帮您选表、探查、分析、确认规则、生成或执行 SQL，也可用自然语言修改规则（如「把官网空值填成未知」）。也可使用消息下方的快捷按钮。",
    action: "none",
    usedLlm: false,
  };
}

export function actionToLabel(action: ChatActionIntent): string {
  return ACTION_LABELS[action] || "";
}

function llmConfigError(): LlmChatResponse {
  const missing: string[] = [];
  if (!env.llmBaseUrl) missing.push("LLM_BASE_URL");
  if (!env.llmApiKey) missing.push("LLM_API_KEY");
  const detail = missing.length > 0 ? missing.join(", ") : "LLM 配置不完整";
  console.error(`[LLM] 未配置或配置无效: ${detail}`);
  return {
    message: `对话服务未就绪：缺少 LLM 环境变量（${detail}）。请在 .env 中配置 LLM_BASE_URL、LLM_API_KEY、LLM_MODEL 后重启服务。`,
    action: undefined,
    usedLlm: false,
  };
}

export async function chatWithLlm(
  userMessage: string,
  ctx: SessionChatContext,
  history: LlmChatMessage[] = []
): Promise<LlmChatResponse> {
  if (!env.llmApiKey || !env.llmBaseUrl) {
    return llmConfigError();
  }

  const messages: LlmChatMessage[] = [
    { role: "system", content: buildSystemPrompt(ctx) },
    ...history.slice(-8),
    { role: "user", content: userMessage },
  ];

  const url = `${env.llmBaseUrl.replace(/\/$/, "")}/v1/chat/completions`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.llmApiKey}`,
      },
      body: JSON.stringify({
        model: env.llmModel,
        messages,
        temperature: 0.3,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[LLM] API error:", response.status, errText);
      return {
        message: `LLM 请求失败（HTTP ${response.status}）。请检查 API Key、模型名称（当前：${env.llmModel}）或网络连接，也可使用消息下方的快捷按钮继续操作。`,
        usedLlm: false,
      };
    }

    const data = (await response.json()) as LlmApiResponse;
    const finishReason = data.choices?.[0]?.finish_reason;
    const extracted = extractLlmText(data);

    if (!extracted?.text) {
      const msgKeys = data.choices?.[0]?.message
        ? Object.keys(data.choices[0].message as object)
        : [];
      console.error("[LLM] Empty response from API", {
        finishReason,
        messageKeys: msgKeys,
        apiError: data.error?.message,
      });
      const hint =
        finishReason === "length"
          ? "模型输出被 token 上限截断，请缩短对话上下文后重试。"
          : "请稍后重试或使用快捷按钮操作。";
      return {
        message: `LLM 返回了空响应（finish_reason=${finishReason ?? "unknown"}）。${hint}`,
        usedLlm: false,
      };
    }

    if (extracted.source !== "content") {
      console.warn(`[LLM] 使用 ${extracted.source} 字段作为回复文本`);
    }

    const parsed = parseLlmJson(extracted.text);
    if (parsed.rejectedAsTemplate) {
      return {
        message: "",
        usedLlm: false,
      };
    }
    const replyMessage = parsed.message || extracted.text;
    if (!replyMessage.trim() || isTemplateOrPlaceholderMessage(replyMessage)) {
      return {
        message: "",
        usedLlm: false,
      };
    }

    return {
      message: replyMessage,
      action: parsed.action && parsed.action !== "none" ? parsed.action : undefined,
      autoTrigger: parsed.autoTrigger,
      usedLlm: true,
      ruleUpdates: parsed.ruleUpdates,
    };
  } catch (error) {
    console.error("[LLM] Request failed:", error);
    const detail = error instanceof Error ? error.message : String(error);
    return {
      message: `LLM 连接失败：${detail}。请确认 LLM_BASE_URL 可访问后重试。`,
      usedLlm: false,
    };
  }
}

/** LLM 主路径 + 失败时 keywordFallback 降级 */
export async function resolveChatResponse(
  userMessage: string,
  ctx: SessionChatContext,
  history: LlmChatMessage[] = []
): Promise<LlmChatResponse> {
  const llmResult = await chatWithLlm(userMessage, ctx, history);
  if (shouldUseKeywordFallback(llmResult)) {
    console.warn("[LLM] 降级到 keywordFallback");
    return keywordFallback(userMessage, ctx);
  }
  return llmResult;
}
