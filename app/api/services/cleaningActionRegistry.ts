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
  | "filter"
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
  filter: "过滤",
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

/** 支持 invalidAction 配置的 parameters.type 子类型 */
export const INVALID_ACTION_RULE_TYPES = new Set([
  "email_validate",
  "phone_validate",
  "regex_validate",
  "length_validate",
  "length_range",
  "range_validate",
  "id_card_transform",
  "decimal_precision",
  "integer_validate",
  "credit_code_validate",
  "landline_validate",
  "mac_validate",
  "ip_validate",
  "longitude_validate",
  "latitude_validate",
]);

/** 支持 unmatchedStrategy 的 dictMap / 码表规则 */
export const UNMATCHED_STRATEGY_RULE_TYPES = new Set(["dictMap", "fk_reference"]);

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
  // --- planned: true — 对齐 stub，见 docs/CLEANING_RULES_REDESIGN.md P0/P1 ---
  id_card_transform: {
    type: "id_card_transform",
    label: "身份证校验转换",
    description: "15 位升 18 位、校验位、结尾 x 大写（GB 11643）；支持 invalidAction",
    category: "validity",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: true,
    recommended: true,
  },
  decimal_precision: {
    type: "decimal_precision",
    label: "精度标准化",
    description: "数值保留指定小数位（scale）；支持 invalidAction",
    category: "accuracy",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: false,
    recommended: false,
  },
  integer_validate: {
    type: "integer_validate",
    label: "整型校验",
    description: "判断并处理非整型值；支持 invalidAction",
    category: "validity",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: false,
    recommended: false,
  },
  strip_chars: {
    type: "strip_chars",
    label: "去除特定字符",
    description: "format 分支：去除字母/数字/中文等（charClasses）",
    category: "text",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: false,
    recommended: false,
  },
  substring: {
    type: "substring",
    label: "字符串截取",
    description: "format 分支：按 start/end 截取",
    category: "text",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: false,
    recommended: false,
  },
  length_range: {
    type: "length_range",
    label: "长度区间过滤",
    description: "min/max 长度校验或 reject 删行；区别于 length_validate 精确长度",
    category: "filter",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: true,
    recommended: true,
  },
  compare_filter: {
    type: "compare_filter",
    label: "比较过滤",
    description: "固定值/列比较后删行（eq/ne/gt/lt/gte/lte）；支持 invalidAction=reject",
    category: "filter",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: true,
    recommended: true,
  },
  regex_filter: {
    type: "regex_filter",
    label: "正则过滤",
    description: "正则不匹配则删行（区别于 regex_validate 单元格转换）",
    category: "filter",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: true,
    recommended: true,
  },
  domain_filter: {
    type: "domain_filter",
    label: "标准值域过滤",
    description: "枚举/数值域不满足则分流；dataStandardParser 自动生成",
    category: "filter",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: false,
    recommended: true,
  },
  credit_code_validate: {
    type: "credit_code_validate",
    label: "统一社会信用代码校验",
    description: "18 位信用代码校验位；支持 invalidAction",
    category: "validity",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: true,
    recommended: true,
  },
  org_code_validate: {
    type: "org_code_validate",
    label: "组织机构代码校验",
    description: "planned: 命名实体规则集（未实现）",
    category: "validity",
    sqlSupported: false,
    fileSupported: false,
    analysisDetector: false,
    recommended: false,
  },
  landline_validate: {
    type: "landline_validate",
    label: "固定电话校验",
    description: "7-12 位固话；支持 invalidAction",
    category: "validity",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: true,
    recommended: true,
  },
  longitude_validate: {
    type: "longitude_validate",
    label: "经度校验",
    description: "经度 [-180,180]；支持 invalidAction",
    category: "validity",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: true,
    recommended: true,
  },
  latitude_validate: {
    type: "latitude_validate",
    label: "纬度校验",
    description: "纬度 [-90,90]；支持 invalidAction",
    category: "validity",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: true,
    recommended: true,
  },
  mac_validate: {
    type: "mac_validate",
    label: "MAC 地址校验",
    description: "MAC 格式校验；支持 invalidAction",
    category: "validity",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: false,
    recommended: false,
  },
  ip_validate: {
    type: "ip_validate",
    label: "IP 地址校验",
    description: "IPv4/IPv6 简化校验；支持 invalidAction",
    category: "validity",
    sqlSupported: true,
    fileSupported: true,
    analysisDetector: false,
    recommended: false,
  },
  custom_expression: {
    type: "custom_expression",
    label: "自定义表达式",
    description: "defer stub：受控 SQL/JS 表达式待 sandbox 实现（P2-R6）",
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
  "custom_expression",
]);

/** 对齐规划中、尚未实现 SQL/文件/分析的子类型 */
export const PLANNED_RULE_TYPES = new Set([
  "org_code_validate",
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
