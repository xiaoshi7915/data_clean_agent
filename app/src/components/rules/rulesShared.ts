import type { CleaningAction, CleaningRule, RuleQualityCategory } from "@contracts/types";

export const RULE_CATEGORY_LABELS: Record<RuleQualityCategory, string> = {
  integrity: "完整性",
  accuracy: "准确性",
  consistency: "一致性",
  uniqueness: "唯一性",
  validity: "有效性",
  text: "文本",
  document: "文档",
  skeleton: "骨架",
  metrics: "质量指标",
};

export function getRuleCategoryLabel(rule: CleaningRule): string | undefined {
  const cat = rule.parameters.ruleCategory as RuleQualityCategory | undefined;
  return cat ? RULE_CATEGORY_LABELS[cat] : undefined;
}

export function isCustomRule(rule: CleaningRule): boolean {
  return rule.parameters?.isCustom === true;
}

export function isAdvancedDisabledRule(rule: CleaningRule): boolean {
  const type = rule.parameters.type as string | undefined;
  if (type === "mice_impute") return true;
  if (rule.parameters.recommended === false && rule.parameters.ruleCategory === "skeleton") {
    return true;
  }
  return rule.parameters.enabled === false;
}

export function getAdvancedRuleLabel(rule: CleaningRule): string {
  return String(rule.parameters.advancedLabel ?? "高级(未启用)");
}

export const actionOptions: { value: CleaningAction; label: string }[] = [
  { value: "fill_null", label: "填充空值" },
  { value: "dedup", label: "去重" },
  { value: "format", label: "格式化" },
  { value: "truncate", label: "截断" },
  { value: "convert_type", label: "类型转换" },
  { value: "standardize", label: "标准化" },
  { value: "split", label: "拆分" },
  { value: "merge", label: "合并" },
  { value: "remove", label: "删除" },
];

export function defaultParametersForAction(action: CleaningAction): Record<string, unknown> {
  switch (action) {
    case "fill_null":
      return { strategy: "fixed", fillValue: "UNKNOWN" };
    case "truncate":
      return { maxLength: 255 };
    case "format":
      return { pattern: "", replacement: "" };
    case "standardize":
      return { targetFormat: "lower" };
    case "split":
      return { delimiter: ",", targetColumn: "" };
    case "dedup":
      return { scope: "column" };
    case "convert_type":
      return { targetType: "VARCHAR(255)" };
    case "remove":
      return { condition: "IS NULL" };
    default:
      return {};
  }
}

export const fillStrategyLabels: Record<string, string> = {
  fixed: "固定值",
  default: "默认占位",
  mean: "列均值",
  variable: "变量占位",
};

export const variantLabels: Record<string, string> = {
  fixed: "固定值填充",
  default: "默认占位符",
  mean: "列均值填充",
  variable: "变量占位符",
  remove: "删除空值行",
  null_literal: "填充 NULL",
  ffill: "前向填充",
  bfill: "后向填充",
  keep_first: "保留首条",
  keep_last: "保留最新",
  iqr: "IQR 异常值",
  zscore: "Z-score 3σ",
  winsorize: "Winsorize 截断",
  code_value: "码表文本值",
  code_number: "码表数字编码",
  lower: "统一小写",
};

export const actionLabels: Record<string, string> = {
  dedup: "去重",
  fill_null: "填充空值",
  format: "格式化",
  truncate: "截断",
  convert_type: "类型转换",
  remove: "删除",
  standardize: "标准化",
  split: "拆分",
  merge: "合并",
};
