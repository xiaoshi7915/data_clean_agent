import { describe, expect, it } from "vitest";
import {
  parseLlmJson,
  keywordFallback,
  shouldUseKeywordFallback,
  isTemplateOrPlaceholderMessage,
} from "./llmService";

describe("parseLlmJson", () => {
  it("解析标准 JSON 回复", () => {
    const parsed = parseLlmJson(
      '{"message":"好的","action":"updateRule","autoTrigger":false,"ruleUpdates":[{"field":"website","fillValue":"未知"}]}'
    );
    expect(parsed.message).toBe("好的");
    expect(parsed.action).toBe("updateRule");
    expect(parsed.ruleUpdates?.[0].field).toBe("website");
    expect(parsed.ruleUpdates?.[0].fillValue).toBe("未知");
  });

  it("从 markdown 包裹文本中提取 JSON", () => {
    const parsed = parseLlmJson(
      '说明如下：\n```json\n{"message":"已更新","action":"none","ruleUpdates":[]}\n```'
    );
    expect(parsed.message).toBe("已更新");
  });

  it("解析 expression 类型 fillValue", () => {
    const parsed = parseLlmJson(
      '{"message":"ok","ruleUpdates":[{"field":"assi_time","fillValue":{"type":"expression","value":"NOW()"}}]}'
    );
    expect(parsed.ruleUpdates?.[0].fillValue).toBe("NOW()");
  });

  it("无 JSON 时回退为纯文本 message", () => {
    const parsed = parseLlmJson("这是一条普通回复");
    expect(parsed.message).toBe("这是一条普通回复");
    expect(parsed.action).toBeUndefined();
  });

  it("拒绝 schema 模板占位符回复", () => {
    const template =
      '{"field": "字段名", "variantKey": "可选策略", "fillValue": "可选填充值", "action": "可选 confirm|skip"}';
    const parsed = parseLlmJson(template);
    expect(parsed.rejectedAsTemplate).toBe(true);
    expect(parsed.message).toBe("");
    expect(isTemplateOrPlaceholderMessage(template)).toBe(true);
  });

  it("拒绝含占位 field 的 ruleUpdates", () => {
    const parsed = parseLlmJson(
      '{"message":"好的","action":"updateRule","ruleUpdates":[{"field":"字段名","fillValue":"NULL"}]}'
    );
    expect(parsed.rejectedAsTemplate).toBe(true);
  });
});

describe("keywordFallback", () => {
  it("识别一键全流程", () => {
    const result = keywordFallback("请一键完成清洗", {
      phase: "explore",
      hasExploration: false,
      hasQualityReport: false,
      rulesCount: 0,
      confirmedRulesCount: 0,
      hasGeneratedSQL: false,
      hasExecutionResult: false,
      targetTable: "orders",
    });
    expect(result.action).toBe("runFullPipeline");
    expect(result.autoTrigger).toBe(true);
  });
});

describe("shouldUseKeywordFallback", () => {
  it("LLM 未使用或空 message 时降级", () => {
    expect(shouldUseKeywordFallback({ message: "", usedLlm: true })).toBe(true);
    expect(shouldUseKeywordFallback({ message: "有内容", usedLlm: false })).toBe(true);
    expect(shouldUseKeywordFallback({ message: "有内容", usedLlm: true })).toBe(false);
  });
});
