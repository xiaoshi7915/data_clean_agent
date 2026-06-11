import { describe, expect, it } from "vitest";
import { isChatActionDisabled } from "./chatActionState";
import type { ChatMessageAction, CleaningRule } from "@contracts/types";

describe("chatActionState", () => {
  const confirmedRule = {
    id: "r1",
    index: 0,
    name: "rule",
    field: "f",
    action: "fill_null" as const,
    affectedRows: 1,
    affectedPercent: 1,
    parameters: {},
    status: "confirmed" as const,
  } satisfies CleaningRule;

  const baseCtx = {
    currentPhase: "generate" as const,
    targetTable: "users",
    explorationResult: { sourceName: "users" } as never,
    qualityReport: { score: { overall: 80 } } as never,
    cleaningRules: [confirmedRule],
    generatedSQL: { steps: [{ stepNumber: 1 }] } as never,
    executionResult: null,
  };

  it("generateSQL 在 SQL 已生成后应禁用", () => {
    const action: ChatMessageAction = {
      id: "1",
      label: "生成清洗SQL",
      type: "generateSQL",
    };
    expect(isChatActionDisabled(action, baseCtx)).toBe(true);
  });

  it("confirmAll 在规则已确认后应禁用", () => {
    const action: ChatMessageAction = {
      id: "2",
      label: "确认全部规则",
      type: "confirmAll",
    };
    expect(isChatActionDisabled(action, baseCtx)).toBe(true);
  });

  it("viewSQL 查看类按钮保持可点", () => {
    const action: ChatMessageAction = {
      id: "3",
      label: "查看清洗SQL",
      type: "viewSQL",
    };
    expect(isChatActionDisabled(action, baseCtx)).toBe(false);
  });
});
