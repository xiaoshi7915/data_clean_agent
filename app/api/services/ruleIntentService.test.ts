import { describe, expect, it } from "vitest";
import type { CleaningRule } from "@contracts/types";
import {
  findRuleByField,
  normalizeFillValue,
  normalizeRuleUpdateIntent,
  isSqlExpressionFillValue,
  isBulkAllFieldsIntent,
  expandBulkRuleUpdatesFromMessage,
} from "./ruleIntentService";

const sampleRules: CleaningRule[] = [
  {
    id: "R1",
    index: 1,
    name: "空值过多 - assi_time",
    field: "assi_time",
    action: "remove",
    issueDescription: "空值率过高",
    strategy: "删除空值行",
    affectedRows: 100,
    affectedPercent: 60,
    parameters: {
      issueCategory: "空值过多",
      selectedVariant: "remove",
      variants: [
        {
          key: "remove",
          action: "remove",
          name: "删除空值行 - assi_time",
          strategy: "删除空值行",
          parameters: { condition: "IS NULL", variant: "remove" },
        },
        {
          key: "fixed",
          action: "fill_null",
          name: "空值填充(固定值) - assi_time",
          strategy: "固定值填充",
          parameters: { strategy: "fixed", fillValue: "UNKNOWN", variant: "fixed" },
        },
      ],
      condition: "IS NULL",
      variant: "remove",
    },
    status: "pending",
  },
  {
    id: "R2",
    index: 2,
    name: "空值过多 - website",
    field: "website",
    action: "fill_null",
    issueDescription: "空值",
    strategy: "固定值填充",
    affectedRows: 10,
    affectedPercent: 5,
    parameters: { strategy: "fixed", fillValue: "UNKNOWN" },
    status: "pending",
  },
];

describe("ruleIntentService", () => {
  it("findRuleByField 精确匹配字段名", () => {
    expect(findRuleByField(sampleRules, "assi_time")?.id).toBe("R1");
  });

  it("findRuleByField 忽略大小写与下划线差异", () => {
    expect(findRuleByField(sampleRules, "ASSI-TIME")?.field).toBe("assi_time");
  });

  it("normalizeFillValue 将「当前时间」映射为 NOW()", () => {
    expect(normalizeFillValue("当前时间")).toBe("NOW()");
    expect(normalizeFillValue("CURRENT_TIMESTAMP")).toBe("NOW()");
  });

  it("normalizeRuleUpdateIntent 填充意图默认切换 fixed 策略", () => {
    const intent = normalizeRuleUpdateIntent({
      field: "assi_time",
      fillValue: "当前时间",
    });
    expect(intent.variantKey).toBe("fixed");
    expect(intent.fillValue).toBe("NOW()");
  });

  it("isSqlExpressionFillValue 识别 SQL 表达式", () => {
    expect(isSqlExpressionFillValue("NOW()")).toBe(true);
    expect(isSqlExpressionFillValue("UNKNOWN")).toBe(false);
  });

  it("isBulkAllFieldsIntent 识别全字段空值意图", () => {
    expect(isBulkAllFieldsIntent("帮我把所有字段的空值都替换为NULL")).toBe(true);
    expect(isBulkAllFieldsIntent("把 website 空值填成未知")).toBe(false);
  });

  it("expandBulkRuleUpdatesFromMessage 展开批量 NULL 填充", () => {
    const updates = expandBulkRuleUpdatesFromMessage(
      "帮我把所有字段的空值都替换为NULL",
      sampleRules
    );
    expect(updates?.length).toBe(2);
    expect(updates?.every((u) => u.variantKey === "fixed" && u.fillValue === "NULL")).toBe(true);
    expect(updates?.map((u) => u.field).sort()).toEqual(["assi_time", "website"]);
  });

  it("findRuleByField 通过手机号别名匹配 phone 列", () => {
    const phoneRules: CleaningRule[] = [
      {
        ...sampleRules[1],
        id: "R3",
        field: "mobile_phone",
        name: "手机号格式 - mobile_phone",
      },
    ];
    expect(findRuleByField(phoneRules, "手机号")?.field).toBe("mobile_phone");
    expect(findRuleByField(phoneRules, "电话")?.field).toBe("mobile_phone");
  });
});

describe("mergeVariantSelection via applyRuleUpdatesFromNL (unit-level expectations)", () => {
  it("normalizeRuleUpdateIntent 支持 expression 对象", () => {
    const intent = normalizeRuleUpdateIntent({
      field: "assi_time",
      fillValue: { type: "expression", value: "NOW()" } as unknown as string,
    });
    expect(intent.fillValue).toBe("NOW()");
    expect(intent.variantKey).toBe("fixed");
  });
});
