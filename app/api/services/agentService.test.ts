import { describe, expect, it } from "vitest";
import { detectMultiIntent, parseAgentPlan } from "./agentService";
import type { SessionChatContext } from "./llmService";
import type { RuleUpdateIntent } from "@contracts/types";

const baseCtx: SessionChatContext = {
  phase: "explore",
  dataSourceName: "mydb",
  targetTable: "users",
  hasExploration: true,
  hasQualityReport: false,
  rulesCount: 3,
  confirmedRulesCount: 0,
  hasGeneratedSQL: false,
  hasExecutionResult: false,
};

describe("detectMultiIntent", () => {
  it("单动词不视为多意图", () => {
    expect(detectMultiIntent("帮我探查 users 表", baseCtx)).toBe(false);
    expect(detectMultiIntent("analyze quality", baseCtx)).toBe(false);
  });

  it("两个及以上动词视为多意图", () => {
    expect(detectMultiIntent("先探查再分析", baseCtx)).toBe(true);
    expect(detectMultiIntent("explore then analyze users", baseCtx)).toBe(true);
  });

  it("连接词 + 单动词视为多意图", () => {
    expect(detectMultiIntent("然后生成 SQL", baseCtx)).toBe(true);
    expect(detectMultiIntent("并执行清洗", baseCtx)).toBe(true);
  });

  it("一键 + 连接词视为多意图", () => {
    expect(detectMultiIntent("一键探查然后分析", baseCtx)).toBe(true);
  });
});

describe("parseAgentPlan", () => {
  it("探查意图", () => {
    const steps = parseAgentPlan("探查 users 表", baseCtx);
    expect(steps).toEqual([{ type: "explore", tableName: "users" }]);
  });

  it("explore 英文 + 表名", () => {
    const steps = parseAgentPlan("explore orders", baseCtx);
    expect(steps[0]).toEqual({ type: "explore", tableName: "orders" });
  });

  it("分析意图", () => {
    const steps = parseAgentPlan("请做质量分析", baseCtx);
    expect(steps).toContainEqual({ type: "analyze" });
  });

  it("生成 SQL", () => {
    const steps = parseAgentPlan("生成清洗 SQL", baseCtx);
    expect(steps).toContainEqual({ type: "generate" });
  });

  it("dry-run 执行", () => {
    const steps = parseAgentPlan("模拟执行 dry run", baseCtx);
    expect(steps).toContainEqual({ type: "execute", dryRun: true });
  });

  it("正式执行", () => {
    const steps = parseAgentPlan("execute cleaning", baseCtx);
    expect(steps).toContainEqual({ type: "execute", dryRun: false });
  });

  it("确认全部规则", () => {
    const steps = parseAgentPlan("确认所有规则", baseCtx);
    expect(steps).toContainEqual({ type: "confirmAll" });
  });

  it("多步：探查 → 分析 → 生成", () => {
    const steps = parseAgentPlan("探查 users 然后分析并生成 SQL", baseCtx);
    expect(steps.map((s) => s.type)).toEqual(
      expect.arrayContaining(["explore", "analyze", "generate"])
    );
  });

  it("传入 ruleUpdates 时包含 updateRule", () => {
    const updates: RuleUpdateIntent[] = [{ field: "name", fillValue: "N/A" }];
    const steps = parseAgentPlan("更新规则", baseCtx, updates);
    expect(steps).toContainEqual({ type: "updateRule", ruleUpdates: updates });
  });

  it("填充类 NL 且无 ruleUpdates 时占位 updateRule", () => {
    const steps = parseAgentPlan("把空值填成 UNKNOWN", baseCtx);
    expect(steps).toContainEqual({ type: "updateRule", ruleUpdates: [] });
  });

  it("从头到尾全流程默认四步", () => {
    const steps = parseAgentPlan("从头到尾完成清洗", {
      ...baseCtx,
      hasExploration: false,
    });
    expect(steps.map((s) => s.type)).toEqual(["explore", "analyze", "confirmAll", "generate"]);
  });

  it("verify / scriptGen / exportScripts 意图", () => {
    const steps = parseAgentPlan("生成 SQL 然后校验并导出脚本包", baseCtx);
    expect(steps.map((s) => s.type)).toEqual(
      expect.arrayContaining(["generate", "verify", "exportScripts"])
    );
  });

  it("soda checks 触发 scriptGen", () => {
    const steps = parseAgentPlan("生成 soda checks", baseCtx);
    expect(steps).toContainEqual({ type: "scriptGen" });
  });
});
