import type { CleaningAction, CleaningRule } from "@contracts/types";

export type CleaningChannel = "sql" | "file" | "analysis";

/** 九大类数据质量维度（与用户分类对齐） */
export type RuleQualityCategory =
  | "integrity"
  | "accuracy"
  | "consistency"
  | "uniqueness"
  | "validity"
  | "text"
  | "document"
  | "skeleton"
  | "metrics";

export const RULE_QUALITY_CATEGORY_LABELS: Record<RuleQualityCategory, string> = {
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

export { PLACEHOLDER_NULL_VALUES, isPlaceholderNullValue } from "@contracts/cleaningConstants";

export interface CleaningActionDefinition {
  action: CleaningAction;
  label: string;
  description: string;
  category: RuleQualityCategory;
  sqlSupported: boolean;
  fileSupported: boolean;
  analysisDetector: boolean;
  defaultParameters: Record<string, unknown>;
}

/** 清洗动作注册表：统一 SQL / 文件 / 分析 三通道能力声明 */
export const CLEANING_ACTION_REGISTRY: Record<CleaningAction, CleaningActionDefinition> = {
  dedup: {
    action: "dedup",
    label: "去重",
    description: "按整行或单列去除重复记录，支持 keep first/last",
    category: "uniqueness",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: true,
    defaultParameters: { scope: "column", keep: "first" },
  },
  fill_null: {
    action: "fill_null",
    label: "填充空值",
    description: "固定值、均值、前后填充、变量占位等策略填充 NULL/空字符串",
    category: "integrity",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: true,
    defaultParameters: { strategy: "fixed", fillValue: "UNKNOWN", treatEmptyAsNull: true },
  },
  format: {
    action: "format",
    label: "格式化",
    description: "TRIM/空白折叠/HTML剥离/全半角/手机号/日期 ISO/正则替换",
    category: "text",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: true,
    defaultParameters: { format: "TRIM", pattern: "", replacement: "" },
  },
  truncate: {
    action: "truncate",
    label: "截断",
    description: "按最大长度截断字符串",
    category: "validity",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: false,
    defaultParameters: { maxLength: 255 },
  },
  convert_type: {
    action: "convert_type",
    label: "类型转换",
    description: "CAST 为目标 SQL 类型",
    category: "consistency",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: false,
    defaultParameters: { targetType: "VARCHAR(255)" },
  },
  remove: {
    action: "remove",
    label: "删除行",
    description: "删除空值或不符合条件的行",
    category: "integrity",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: true,
    defaultParameters: { condition: "IS NULL" },
  },
  standardize: {
    action: "standardize",
    label: "标准化",
    description: "占位符置空、码表映射、IQR/Z-score/Winsorize、长度/正则/FK 校验",
    category: "consistency",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: true,
    defaultParameters: { case: "lower" },
  },
  split: {
    action: "split",
    label: "拆分",
    description: "从源列拆出衍生列（如邮箱域名）",
    category: "text",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: true,
    defaultParameters: { part: "domain", targetColumn: "" },
  },
  merge: {
    action: "merge",
    label: "合并",
    description: "多列 CONCAT 合并到目标列",
    category: "text",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: true,
    defaultParameters: { sourceFields: [], separator: "" },
  },
};

/** 参数级子规则（挂在 standardize / format / fill_null 的 parameters.type 上） */
export interface ParameterRuleDefinition {
  type: string;
  label: string;
  description: string;
  category: RuleQualityCategory;
  sqlSupported: boolean;
  fileSupported: boolean;
  analysisDetector: boolean;
  recommended: boolean;
}

export const PARAMETER_RULE_REGISTRY: Record<string, ParameterRuleDefinition> = {
  encoding_detect: {
    type: "encoding_detect",
    label: "编码/乱码检测",
    description: "检测无效 UTF-8、替换字符 及常见乱码模式",
    category: "text",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: true,
    recommended: true,
  },
  encoding_fix: {
    type: "encoding_fix",
    label: "编码修复",
    description: "尝试 latin1→utf8 回转修复乱码",
    category: "text",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: true,
    recommended: false,
  },
  cross_field: {
    type: "cross_field",
    label: "跨字段校验",
    description: "两字段比较（如 birth_date < hire_date）",
    category: "consistency",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: true,
    recommended: true,
  },
  timezone_normalize: {
    type: "timezone_normalize",
    label: "时区规范化",
    description: "将时间戳统一为 UTC 或目标时区",
    category: "document",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: true,
    recommended: true,
  },
  duplicate_timestamp: {
    type: "duplicate_timestamp",
    label: "时间戳重复检测",
    description: "时间序列列重复时间戳标记",
    category: "document",
    sqlSupported: false,
    fileSupported: true,
    analysisDetector: true,
    recommended: true,
  },
  state_transition: {
    type: "state_transition",
    label: "状态机顺序校验",
    description: "按 allowedTransitions 校验枚举状态转移",
    category: "document",
    sqlSupported: false,
    fileSupported: true,
    analysisDetector: true,
    recommended: true,
  },
  mice_impute: {
    type: "mice_impute",
    label: "MICE 多重插补",
    description: "高级缺失值插补（需专门建模环境，未纳入自动推荐）",
    category: "skeleton",
    sqlSupported: false,
    fileSupported: false,
    analysisDetector: false,
    recommended: false,
  },
};

/** 高级算法规则（MICE、Isolation Forest 等）标记为不推荐自动应用 */
export const ADVANCED_RULE_TYPES = new Set([
  "mice_impute",
  "isolation_forest",
  "dbscan_outlier",
]);

/** 高级/未启用规则 UI 标签 */
export const ADVANCED_DISABLED_LABEL = "高级(未启用)";

export function getParameterRuleLabel(type: string | undefined): string | undefined {
  if (!type) return undefined;
  return PARAMETER_RULE_REGISTRY[type]?.label;
}

export function isAdvancedDisabledRule(rule: CleaningRule): boolean {
  const type = rule.parameters.type as string | undefined;
  if (type && ADVANCED_RULE_TYPES.has(type)) return true;
  if (rule.parameters.recommended === false && rule.parameters.ruleCategory === "skeleton") {
    return true;
  }
  return false;
}

export function isActionImplemented(action: CleaningAction, channel: CleaningChannel): boolean {
  const def = CLEANING_ACTION_REGISTRY[action];
  if (!def) return false;
  switch (channel) {
    case "sql":
      return def.sqlSupported;
    case "file":
      return def.fileSupported;
    case "analysis":
      return def.analysisDetector;
    default:
      return false;
  }
}

export function getDefaultParameters(action: CleaningAction): Record<string, unknown> {
  return { ...(CLEANING_ACTION_REGISTRY[action]?.defaultParameters ?? {}) };
}

export function listSupportedActions(channel: CleaningChannel): CleaningAction[] {
  return (Object.keys(CLEANING_ACTION_REGISTRY) as CleaningAction[]).filter((a) =>
    isActionImplemented(a, channel)
  );
}

export function getRuleCategory(rule: CleaningRule): RuleQualityCategory {
  const fromParams = rule.parameters.ruleCategory as RuleQualityCategory | undefined;
  if (fromParams && RULE_QUALITY_CATEGORY_LABELS[fromParams]) return fromParams;
  const def = CLEANING_ACTION_REGISTRY[rule.action];
  return def?.category ?? "integrity";
}

export function getRuleCategoryLabel(rule: CleaningRule): string {
  return RULE_QUALITY_CATEGORY_LABELS[getRuleCategory(rule)];
}

export function describeRuleAction(rule: CleaningRule): string {
  const def = CLEANING_ACTION_REGISTRY[rule.action];
  return def ? `${def.label}（${rule.field}）` : `${rule.action}（${rule.field}）`;
}
