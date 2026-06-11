import { z } from "zod";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleaningRules } from "@db/schema";

vi.mock("../queries/connection", () => ({
  getDb: () => ({
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  }),
}));

vi.mock("../services/llmService", () => ({
  resolveChatResponse: vi.fn().mockResolvedValue({
    message: "好的",
    action: undefined,
    autoTrigger: false,
    usedLlm: false,
  }),
  actionToLabel: (a: string) => a,
  isTemplateOrPlaceholderMessage: () => false,
  keywordFallback: vi.fn(),
}));

vi.mock("../services/agentService", () => ({
  detectMultiIntent: vi.fn(),
}));

vi.mock("../services/ruleIntentService", () => ({
  applyRuleUpdatesFromNL: vi.fn(),
  expandBulkRuleUpdatesFromMessage: vi.fn(),
  isBulkAllFieldsIntent: vi.fn().mockReturnValue(false),
}));

vi.mock("../agents/orchestrator", () => ({
  handleUserMessage: vi.fn(),
  handleMultiStepPlan: vi.fn(),
}));

import { chatRouter } from "./chatRouter";
import { detectMultiIntent } from "../services/agentService";
import { handleUserMessage, handleMultiStepPlan } from "../agents/orchestrator";
import { resolveChatResponse } from "../services/llmService";

function createCaller() {
  return chatRouter.createCaller({
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
  });
}

const baseInput = {
  sessionId: "sess_1",
  userMessage: "一键全流程",
  context: {
    phase: "explore",
    hasExploration: false,
    hasQualityReport: false,
    rulesCount: 0,
    confirmedRulesCount: 0,
    hasGeneratedSQL: false,
    hasExecutionResult: false,
  },
};

describe("chatRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(detectMultiIntent).mockReturnValue(false);
  });

  it("一键流程委托 orchestrator.handleUserMessage", async () => {
    vi.mocked(handleUserMessage).mockResolvedValue({
      orchestrated: true,
      runId: "run_abc",
      state: "human_confirm",
      message: "请在规则面板确认",
      actions: [{ type: "confirmAll", label: "确认全部规则" }],
    });

    const res = await createCaller().send(baseInput);
    expect(res.success).toBe(true);
    expect(res.orchestratorRunId).toBe("run_abc");
    expect(res.orchestratorState).toBe("human_confirm");
    expect(handleUserMessage).toHaveBeenCalled();
  });

  it("多步意图走 handleMultiStepPlan 而非 agentService.runAgentPlan", async () => {
    vi.mocked(detectMultiIntent).mockReturnValue(true);
    vi.mocked(handleUserMessage).mockResolvedValue({
      orchestrated: false,
      message: "",
      actions: [],
    });
    vi.mocked(handleMultiStepPlan).mockResolvedValue({
      orchestrated: true,
      runId: "run_plan",
      state: "human_confirm",
      message: "已规划",
      actions: [{ type: "startExplore", label: "探查", autoTrigger: true }],
    });

    const res = await createCaller().send({
      ...baseInput,
      userMessage: "先探查再分析然后生成 SQL",
    });

    expect(handleMultiStepPlan).toHaveBeenCalled();
    expect(res.orchestratorRunId).toBe("run_plan");
    expect("agentPlanSteps" in res ? res.agentPlanSteps : undefined).toBeUndefined();
  });

  it("非编排消息仍返回 LLM 结果", async () => {
    vi.mocked(handleUserMessage).mockResolvedValue({
      orchestrated: false,
      message: "",
      actions: [],
    });
    vi.mocked(resolveChatResponse).mockResolvedValue({
      message: "你好，我可以帮你清洗数据",
      action: undefined,
      autoTrigger: false,
      usedLlm: true,
    });

    const res = await createCaller().send({
      ...baseInput,
      userMessage: "你好",
    });
    expect(res.message).toContain("你好");
    expect(res.orchestratorRunId).toBeUndefined();
  });
});
