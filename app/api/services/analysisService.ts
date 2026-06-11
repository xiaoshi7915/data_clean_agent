import type {
  ExplorationResult,
  QualityReport,
  QualityScore,
  CleaningRule,
  CleaningAction,
  DetectedIssue,
  ColumnStats,
} from "@contracts/types";
import { PLACEHOLDER_NULL_VALUES, type RuleQualityCategory } from "./cleaningActionRegistry";
import { isPlaceholderNullValue } from "@contracts/cleaningConstants";
import { metricRegistry } from "../../engine/metrics/metricRegistry";
/** 复用探查阶段的 nullCount，避免从 nullRate 反算产生舍入误差 */
function getNonNullCount(column: ColumnStats, totalRows: number): number {
  const nullCount =
    column.nullCount ??
    Math.round((column.nullRate / 100) * totalRows);
  return Math.max(0, totalRows - nullCount);
}

/** 质量报告生成时登记 MetricRegistry 引用（resolve 去重） */
function collectQualityMetricKeys(exploration: ExplorationResult): string[] {
  const table = exploration.sourceName.includes(".")
    ? exploration.sourceName.split(".").pop()!
    : exploration.sourceName;
  const cacheKeys: string[] = [
    metricRegistry.resolve("row_count", { table }).cacheKey,
  ];
  for (const cs of exploration.columnStats) {
    cacheKeys.push(
      metricRegistry.resolve("null_count", { column: cs.columnName, table }).cacheKey
    );
    cacheKeys.push(
      metricRegistry.resolve("distinct_count", { column: cs.columnName, table }).cacheKey
    );
  }
  return [...new Set(cacheKeys)];
}

function withCategory(
  parameters: Record<string, unknown>,
  category: RuleQualityCategory
): Record<string, unknown> {
  return { ...parameters, ruleCategory: category };
}

function isPlaceholderValue(value: string): boolean {
  return isPlaceholderNullValue(value);
}

function isStringType(dataType: string): boolean {
  const dt = dataType.toLowerCase();
  return ["varchar", "text", "char", "longtext", "mediumtext", "tinytext"].includes(dt);
}

function isNumericType(dataType: string): boolean {
  const dt = dataType.toLowerCase();
  return [
    "numeric", "int", "integer", "bigint", "decimal", "float", "double",
    "tinyint", "smallint", "mediumint", "real",
  ].includes(dt);
}

function columnNameMatches(name: string, patterns: string[]): boolean {
  const lower = name.toLowerCase();
  return patterns.some((p) => lower.includes(p));
}

function isIdLikeColumn(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === "id" ||
    lower.endsWith("_id") ||
    lower.endsWith("_pk") ||
    lower.includes("uuid") ||
    lower.includes("guid")
  );
}

/** P1-5: 乱码 / 混合编码检测 */
function detectEncodingIssues(samples: string[]): {
  hasMojibake: boolean;
  replacementRatio: number;
} {
  if (samples.length === 0) return { hasMojibake: false, replacementRatio: 0 };

  const mojibakeRe = /Ã.|Â.|â€|ï¿½|锟斤拷|쏙|鐨/;
  let replacementCount = 0;
  let totalChars = 0;

  for (const s of samples) {
    replacementCount += (s.match(/\uFFFD/g) || []).length;
    totalChars += s.length;
  }

  const replacementRatio = totalChars > 0 ? replacementCount / totalChars : 0;
  const hasMojibake =
    samples.some((s) => mojibakeRe.test(s)) || replacementRatio > 0.01;

  return { hasMojibake, replacementRatio };
}

interface MergePairHint {
  sourceFields: string[];
  targetField: string;
  separator: string;
  label: string;
}

/** P1-8: 关联列合并推荐 */
function detectMergePairs(columnNames: string[]): MergePairHint[] {
  const hints: MergePairHint[] = [];
  const used = new Set<string>();

  const patterns: Array<{
    a: string[];
    b: string[];
    target: string;
    sep: string;
    label: string;
  }> = [
    {
      a: ["first_name", "firstname", "fname", "名"],
      b: ["last_name", "lastname", "lname", "姓"],
      target: "full_name",
      sep: " ",
      label: "姓名合并",
    },
    {
      a: ["province", "省"],
      b: ["city", "市", "城"],
      target: "province_city",
      sep: "/",
      label: "省市合并",
    },
    {
      a: ["street", "address", "地址"],
      b: ["number", "no", "门牌"],
      target: "full_address",
      sep: " ",
      label: "地址合并",
    },
  ];

  for (const p of patterns) {
    const colA = columnNames.find(
      (c) => !used.has(c) && p.a.some((pa) => c.toLowerCase().includes(pa))
    );
    const colB = columnNames.find(
      (c) =>
        c !== colA &&
        !used.has(c) &&
        p.b.some((pb) => c.toLowerCase().includes(pb))
    );
    if (colA && colB) {
      hints.push({
        sourceFields: [colA, colB],
        targetField: p.target,
        separator: p.sep,
        label: p.label,
      });
      used.add(colA);
      used.add(colB);
    }
  }

  return hints;
}

interface CrossFieldHint {
  fields: [string, string];
  operator: string;
  label: string;
  optionalThird?: string;
}

/** P1-7: 跨字段关系推荐 */
function detectCrossFieldRules(columnNames: string[]): CrossFieldHint[] {
  const hints: CrossFieldHint[] = [];
  const findCol = (patterns: string[]) =>
    columnNames.find((c) => patterns.some((p) => c.toLowerCase().includes(p)));

  const birth = findCol(["birth_date", "birthday", "birth", "出生"]);
  const hire = findCol(["hire_date", "hire", "入职", "join_date"]);
  if (birth && hire) {
    hints.push({
      fields: [birth, hire],
      operator: "<",
      label: "出生日期应早于入职日期",
    });
  }

  const start = findCol(["start_date", "start", "开始"]);
  const end = findCol(["end_date", "end", "结束"]);
  if (start && end) {
    hints.push({
      fields: [start, end],
      operator: "<",
      label: "开始日期应早于结束日期",
    });
  }

  const price = findCol(["price", "单价", "unit_price"]);
  const qty = findCol(["qty", "quantity", "数量"]);
  const amount = findCol(["amount", "total", "金额", "总价"]);
  if (price && qty && amount) {
    hints.push({
      fields: [amount, price],
      operator: ">=",
      label: "金额应不小于单价（与数量一致性校验）",
      optionalThird: qty,
    });
  }

  return hints;
}

const DEFAULT_STATE_TRANSITIONS: Record<string, string[]> = {
  pending: ["active", "cancelled", "canceled"],
  active: ["completed", "done", "cancelled", "canceled"],
  draft: ["published", "active"],
  open: ["closed", "resolved"],
};

export function generateQualityReport(exploration: ExplorationResult): QualityReport {
  const { columnStats, issues, totalRows } = exploration;
  const metricKeys = collectQualityMetricKeys(exploration);

  const completenessScore = calculateCompleteness(columnStats);
  const uniquenessScore = calculateUniqueness(issues, totalRows);
  const consistencyScore = calculateConsistency(columnStats, exploration.sampleData);
  const validityScore = calculateValidity(columnStats, exploration.sampleData);
  const accuracyScore = calculateAccuracy(columnStats, exploration.sampleData);

  const overall = Math.round(
    completenessScore * 0.25 +
    uniquenessScore * 0.2 +
    consistencyScore * 0.2 +
    validityScore * 0.2 +
    accuracyScore * 0.15
  );

  const score: QualityScore = {
    overall,
    completeness: Math.round(completenessScore),
    uniqueness: Math.round(uniquenessScore),
    consistency: Math.round(consistencyScore),
    validity: Math.round(validityScore),
    accuracy: Math.round(accuracyScore),
  };

  const highPriorityIssues = issues.filter((i) => i.severity === "high");
  const mediumPriorityIssues = issues.filter((i) => i.severity === "medium");
  const lowPriorityIssues = issues.filter((i) => i.severity === "low");

  const avgNullRate =
    columnStats.length > 0
      ? columnStats.reduce((sum, cs) => {
          const nullCount = cs.nullCount ?? Math.round((cs.nullRate / 100) * totalRows);
          return sum + (totalRows > 0 ? (nullCount / totalRows) * 100 : cs.nullRate);
        }, 0) / columnStats.length
      : 0;
  const dupIssue = issues.find((i) => i.issueType === "完全重复行");
  const dupRate = totalRows > 0 && dupIssue ? (dupIssue.affectedRows / totalRows) * 100 : 0;

  let summary = `数据质量评分为 ${overall}/100（完整性 ${Math.round(completenessScore)}、有效性 ${Math.round(validityScore)}、唯一性 ${Math.round(uniquenessScore)}）。`;
  summary += `平均空值率 ${avgNullRate.toFixed(1)}%，重复行占比约 ${dupRate.toFixed(1)}%。`;
  if (overall >= 90) {
    summary += " 数据质量优秀，仅需进行轻微优化。";
  } else if (overall >= 70) {
    summary += " 数据质量良好，建议处理发现的问题以提升数据可用性。";
  } else if (overall >= 50) {
    summary += " 数据质量一般，存在较多问题需要处理，建议优先解决高优先级问题。";
  } else {
    summary += " 数据质量较差，需要进行全面的数据清洗操作。";
  }

  return {
    score,
    issues,
    highPriorityIssues,
    mediumPriorityIssues,
    lowPriorityIssues,
    summary,
    metricKeys,
  };
}

function calculateCompleteness(columnStats: { nullRate: number }[]): number {
  if (columnStats.length === 0) return 100;
  const avgNullRate = columnStats.reduce((sum, cs) => sum + cs.nullRate, 0) / columnStats.length;
  return Math.max(0, 100 - avgNullRate * 2);
}

/** 唯一性评分仅基于完全重复行和 id 类字段重复，不惩罚普通列的值重复 */
function calculateUniqueness(issues: DetectedIssue[], totalRows: number): number {
  if (totalRows === 0) return 100;

  const fullDupIssue = issues.find((i) => i.issueType === "完全重复行");
  const idDupIssues = issues.filter((i) => i.issueType === "唯一键重复");

  let penalty = 0;
  if (fullDupIssue) {
    penalty += (fullDupIssue.affectedRows / totalRows) * 100;
  }
  for (const issue of idDupIssues) {
    penalty += (issue.affectedRows / totalRows) * 50;
  }

  return Math.max(0, 100 - penalty);
}

function calculateConsistency(
  columnStats: { sampleValues: (string | number | null)[] }[],
  _sampleData?: Record<string, unknown>[]
): number {
  let inconsistencyScore = 100;

  for (const cs of columnStats) {
    const values = cs.sampleValues.filter((v): v is string => typeof v === "string");
    if (values.length === 0) continue;

    const lowerSet = new Set(values.map((v) => v.toLowerCase()));
    if (lowerSet.size < values.length) {
      inconsistencyScore -= 10;
    }

    const trimmed = values.map((v) => v.trim());
    const hasExtraWhitespace = trimmed.some((v, i) => v !== values[i]);
    if (hasExtraWhitespace) {
      inconsistencyScore -= 5;
    }
  }

  return Math.max(0, inconsistencyScore);
}

function calculateValidity(
  columnStats: { columnName: string; dataType: string; sampleValues: (string | number | null)[] }[],
  _sampleData?: Record<string, unknown>[]
): number {
  let validityScore = 100;

  for (const cs of columnStats) {
    const values = cs.sampleValues.filter((v): v is string => typeof v === "string");
    if (values.length === 0) continue;

    if (cs.columnName.toLowerCase().includes("date") || cs.columnName.toLowerCase().includes("time")) {
      const invalidDates = values.filter((v) => {
        const d = new Date(v);
        return isNaN(d.getTime());
      });
      if (invalidDates.length > 0) {
        validityScore -= 15;
      }
    }

    if (cs.columnName.toLowerCase().includes("email")) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const invalidEmails = values.filter((v) => !emailRegex.test(v));
      if (invalidEmails.length > 0) {
        validityScore -= 10;
      }
    }
  }

  return Math.max(0, validityScore);
}

function calculateAccuracy(
  columnStats: { columnName: string; minValue?: string | number; maxValue?: string | number }[],
  _sampleData?: Record<string, unknown>[]
): number {
  let accuracyScore = 100;

  for (const cs of columnStats) {
    if (cs.columnName.toLowerCase().includes("age") && typeof cs.maxValue === "number" && cs.maxValue > 150) {
      accuracyScore -= 20;
    }
    if (cs.columnName.toLowerCase().includes("age") && typeof cs.minValue === "number" && cs.minValue < 0) {
      accuracyScore -= 20;
    }
  }

  const now = new Date();
  for (const cs of columnStats) {
    if (
      cs.columnName.toLowerCase().includes("date") &&
      typeof cs.maxValue === "string"
    ) {
      const d = new Date(cs.maxValue);
      if (!isNaN(d.getTime()) && d > now) {
        accuracyScore -= 15;
      }
    }
  }

  return Math.max(0, accuracyScore);
}

function nextRuleId(index: number): string {
  return `R${index}`;
}

function makeRule(
  index: number,
  partial: Omit<CleaningRule, "id" | "index">
): CleaningRule {
  return { id: nextRuleId(index), index, ...partial };
}

export interface RuleVariantOption {
  key: string;
  action: CleaningAction;
  name: string;
  strategy: string;
  parameters: Record<string, unknown>;
  riskLevel?: "high" | "medium" | "low";
  riskNote?: string;
}

/** 将分组规则解析为当前选中变体对应的有效规则（SQL 生成时使用） */
export function resolveRuleVariant(rule: CleaningRule): CleaningRule {
  const variants = rule.parameters.variants as RuleVariantOption[] | undefined;
  if (!variants || variants.length === 0) {
    return rule;
  }

  const selectedKey =
    (rule.parameters.selectedVariant as string) || variants[0]?.key;
  const selected =
    variants.find((v) => v.key === selectedKey) || variants[0];

  return {
    ...rule,
    action: selected.action,
    name: selected.name || rule.name,
    strategy: selected.strategy || rule.strategy,
    riskLevel: selected.riskLevel || rule.riskLevel,
    riskNote: selected.riskNote || rule.riskNote,
    parameters: {
      ...selected.parameters,
      issueCategory: rule.parameters.issueCategory,
      selectedVariant: selected.key,
      variants,
    },
  };
}

export function generateCleaningRules(exploration: ExplorationResult, report: QualityReport): CleaningRule[] {
  const rules: CleaningRule[] = [];
  let index = 1;
  const addedFields = new Set<string>();
  const addedGroups = new Set<string>();

  const addRule = (rule: Omit<CleaningRule, "id" | "index">) => {
    const key = `${rule.action}:${rule.field}:${rule.name}`;
    if (addedFields.has(key)) return;
    addedFields.add(key);
    rules.push(makeRule(index++, rule));
  };

  const addGroupedRule = (
    field: string,
    issueCategory: string,
    base: {
      issueDescription: string;
      affectedRows: number;
      affectedPercent: number;
      variants: RuleVariantOption[];
      defaultVariantKey: string;
      category?: RuleQualityCategory;
    }
  ) => {
    const groupKey = `${field}::${issueCategory}`;
    if (addedGroups.has(groupKey)) return;
    addedGroups.add(groupKey);

    const defaultVariant =
      base.variants.find((v) => v.key === base.defaultVariantKey) ||
      base.variants[0];

    rules.push(
      makeRule(index++, {
        name: `${issueCategory} - ${field}`,
        field,
        action: defaultVariant.action,
        issueDescription: base.issueDescription,
        strategy: defaultVariant.strategy,
        affectedRows: base.affectedRows,
        affectedPercent: base.affectedPercent,
        parameters: withCategory(
          {
            issueCategory,
            selectedVariant: defaultVariant.key,
            variants: base.variants,
            ...defaultVariant.parameters,
          },
          base.category ?? "integrity"
        ),
        status: "pending",
        riskLevel: defaultVariant.riskLevel,
        riskNote: defaultVariant.riskNote,
      })
    );
  };

  const buildNullFillVariants = (
    column: string,
    issue: DetectedIssue,
    colStats: { dataType: string } | undefined,
    includeRemove: boolean
  ): RuleVariantOption[] => {
    const isNumeric = colStats ? isNumericType(colStats.dataType) : false;
    const isEmail = columnNameMatches(column, ["email", "mail"]);
    const defaultFill = isEmail ? "unknown@example.com" : isNumeric ? 0 : "UNKNOWN";
    const variants: RuleVariantOption[] = [];

    if (includeRemove) {
      variants.push({
        key: "remove",
        action: "remove",
        name: `删除空值行 - ${column}`,
        strategy: `删除「${column}」为空的行（空值率 ${issue.affectedPercent}%）`,
        parameters: { condition: "IS NULL", variant: "remove" },
        riskLevel: "high",
        riskNote: `将删除 ${issue.affectedRows} 行数据，请确认是否可接受`,
      });
    }

    variants.push(
      {
        key: "fixed",
        action: "fill_null",
        name: `空值填充(固定值) - ${column}`,
        strategy: isNumeric
          ? `使用固定值 0 填充「${column}」空值`
          : `使用固定值 "UNKNOWN" 填充「${column}」空值`,
        parameters: {
          strategy: "fixed",
          fillValue: defaultFill,
          variant: "fixed",
          recommended: !isNumeric && issue.affectedPercent < 30,
        },
        riskLevel: includeRemove ? "medium" : "low",
        riskNote: includeRemove
          ? "高空值率列填充可能扭曲分析结果，建议优先考虑删除或业务默认值"
          : "填充后可能影响统计分析和聚合计算",
      },
      {
        key: "default",
        action: "fill_null",
        name: `空值填充(默认值) - ${column}`,
        strategy: `使用列类型默认占位符填充「${column}」空值`,
        parameters: {
          strategy: "default",
          fillValue: defaultFill,
          variant: "default",
        },
        riskLevel: includeRemove ? "medium" : "low",
        riskNote: includeRemove
          ? "高空值率列填充可能扭曲分析结果"
          : "填充后可能影响统计分析和聚合计算",
      }
    );

    if (isNumeric) {
      variants.push({
        key: "mean",
        action: "fill_null",
        name: `空值填充(均值) - ${column}`,
        strategy: `使用列均值填充「${column}」数值空值（SQL 生成时使用 AVG 窗口函数）`,
        parameters: { strategy: "mean", variant: "mean" },
        riskLevel: includeRemove ? "medium" : "low",
        riskNote: "均值填充适用于数值列，可能受极端值影响",
      });
    }

    variants.push({
      key: "variable",
      action: "fill_null",
      name: `空值填充(变量占位) - ${column}`,
      strategy: `使用变量占位符 \${${column}} 填充「${column}」空值，可在 SQL 中替换为业务变量`,
      parameters: {
        strategy: "variable",
        variableName: column,
        fillValue: `\${${column}}`,
        variant: "variable",
      },
      riskLevel: includeRemove ? "medium" : "low",
      riskNote: "变量占位符需在执行前替换为实际业务值",
    });

    const isTimeSeries =
      columnNameMatches(column, ["time", "date", "日期", "时间", "timestamp", "created", "updated"]);
    if (isTimeSeries) {
      variants.push(
        {
          key: "ffill",
          action: "fill_null",
          name: `空值前向填充 - ${column}`,
          strategy: `按时间序列对「${column}」使用前向填充`,
          parameters: { strategy: "ffill", variant: "ffill", treatEmptyAsNull: true },
          riskLevel: "medium",
          riskNote: "前向填充适用于有序时间序列，乱序数据可能产生偏差",
        },
        {
          key: "bfill",
          action: "fill_null",
          name: `空值后向填充 - ${column}`,
          strategy: `按时间序列对「${column}」使用后向填充`,
          parameters: { strategy: "bfill", variant: "bfill", treatEmptyAsNull: true },
          riskLevel: "medium",
          riskNote: "后向填充适用于有序时间序列，乱序数据可能产生偏差",
        }
      );
    }

    variants.push({
      key: "null_literal",
      action: "fill_null",
      name: `空值填充(NULL) - ${column}`,
      strategy: `将「${column}」空值及空字符串统一保留/填充为 SQL NULL`,
      parameters: {
        strategy: "fixed",
        fillValue: "NULL",
        variant: "null_literal",
        treatEmptyAsNull: true,
        recommended: true,
      },
      riskLevel: "low",
      riskNote: "显式 NULL 便于下游统计区分缺失值",
    });

    return variants;
  };

  // 完全重复行去重（唯一正确的行级去重规则）
  const dupIssue = report.issues.find((i) => i.issueType === "完全重复行");
  const timeColumns = exploration.columnStats
    .filter((cs) => columnNameMatches(cs.columnName.toLowerCase(), ["time", "date", "created", "updated", "timestamp"]))
    .map((cs) => cs.columnName);
  const orderColumn = timeColumns[0];

  if (dupIssue) {
    const dedupVariants: RuleVariantOption[] = [
      {
        key: "keep_first",
        action: "dedup",
        name: "完全重复行去重(保留首条)",
        strategy: "基于所有字段删除完全重复的行，保留最早的一条记录",
        parameters: { keep: "first", scope: "full_row", recommended: true },
        riskLevel: "high",
        riskNote: "删除操作不可逆，建议先执行备份",
      },
    ];
    if (orderColumn) {
      dedupVariants.push({
        key: "keep_last",
        action: "dedup",
        name: `完全重复行去重(保留最新·${orderColumn})`,
        strategy: `基于所有字段去重，按「${orderColumn}」保留最新记录`,
        parameters: { keep: "last", scope: "full_row", orderColumn, recommended: true },
        riskLevel: "high",
        riskNote: "按时间列保留最新记录，请确认时间列可靠",
      });
    }

    addGroupedRule("*", "完全重复行", {
      issueDescription: dupIssue.description,
      affectedRows: dupIssue.affectedRows,
      affectedPercent: dupIssue.affectedPercent,
      variants: dedupVariants,
      defaultVariantKey: orderColumn ? "keep_last" : "keep_first",
      category: "uniqueness",
    });
  }

  // id 类字段重复（可选去重，仅当 dupCount > 0）
  for (const issue of report.issues) {
    if (issue.issueType === "唯一键重复" && isIdLikeColumn(issue.column)) {
      addRule({
        name: `唯一键去重 - ${issue.column}`,
        field: issue.column,
        action: "dedup" as CleaningAction,
        issueDescription: issue.description,
        strategy: `基于「${issue.column}」删除重复记录，保留第一条`,
        affectedRows: issue.affectedRows,
        affectedPercent: issue.affectedPercent,
        parameters: { column: issue.column, keep: "first", scope: "column" },
        status: "pending",
        riskLevel: issue.severity === "high" ? "high" : "medium",
        riskNote: "仅适用于应唯一的标识列，请确认业务逻辑",
      });
    }
  }

  // 空值处理：同字段 + 同问题类型合并为一行，策略通过下拉选择
  for (const issue of report.issues) {
    if (issue.issueType !== "空值过多") continue;

    const colStats = exploration.columnStats.find((cs) => cs.columnName === issue.column);
    const includeRemove = issue.affectedPercent >= 50;
    const variants = buildNullFillVariants(issue.column, issue, colStats, includeRemove);
    const defaultKey =
      includeRemove
        ? "remove"
        : variants.find((v) => v.parameters.recommended)?.key || "fixed";

    addGroupedRule(issue.column, "空值过多", {
      issueDescription: issue.description,
      affectedRows: issue.affectedRows,
      affectedPercent: issue.affectedPercent,
      variants,
      defaultVariantKey: defaultKey,
    });
  }

  // 基于列名和样本值的智能推荐规则
  for (const cs of exploration.columnStats) {
    const colLower = cs.columnName.toLowerCase();
    const sampleStrs = cs.sampleValues.filter((v): v is string => typeof v === "string");
    const nonNullCount = getNonNullCount(cs, exploration.totalRows);

    // 去除首尾空格
    if (isStringType(cs.dataType)) {
      const hasWhitespace = sampleStrs.some((v) => v !== v.trim());
      if (hasWhitespace) {
        addRule({
          name: `去除首尾空格 - ${cs.columnName}`,
          field: cs.columnName,
          action: "format" as CleaningAction,
          issueDescription: `列 "${cs.columnName}" 存在首尾空格`,
          strategy: "使用 TRIM() 去除首尾空格",
          affectedRows: nonNullCount || exploration.totalRows,
          affectedPercent: Math.min(100, parseFloat((100 - cs.nullRate).toFixed(2))),
          parameters: { format: "TRIM", recommended: true },
          status: "pending",
          riskLevel: "low",
          riskNote: "不会影响数据内容，安全性高",
        });
      }
    }

    // 手机号标准化
    if (columnNameMatches(colLower, ["phone", "mobile", "tel", "cellphone", "手机", "电话"])) {
      addRule({
        name: `手机号格式标准化 - ${cs.columnName}`,
        field: cs.columnName,
        action: "format" as CleaningAction,
        issueDescription: `列 "${cs.columnName}" 可能存在格式不一致的手机号`,
        strategy: "统一为 11 位数字格式（去除空格、横线等非数字字符）",
        affectedRows: nonNullCount,
        affectedPercent: parseFloat((100 - cs.nullRate).toFixed(2)),
        parameters: { format: "PHONE", recommended: true },
        status: "pending",
        riskLevel: "low",
        riskNote: "仅保留数字字符，可能改变原始格式",
      });
    }

    // 邮箱域名提取
    if (columnNameMatches(colLower, ["email", "mail", "邮箱"])) {
      addRule({
        name: `提取邮箱域名 - ${cs.columnName}`,
        field: cs.columnName,
        action: "split" as CleaningAction,
        issueDescription: `从 "${cs.columnName}" 提取邮箱域名部分`,
        strategy: "使用 SUBSTRING_INDEX 提取 @ 后的域名",
        affectedRows: nonNullCount,
        affectedPercent: parseFloat((100 - cs.nullRate).toFixed(2)),
        parameters: { delimiter: "@", part: "domain", targetColumn: `${cs.columnName}_domain`, recommended: true },
        status: "pending",
        riskLevel: "low",
        riskNote: "将新增域名列，不修改原邮箱字段",
      });
    }

    // 年龄异常值修正
    if (columnNameMatches(colLower, ["age", "年龄"])) {
      const hasAbnormal = sampleStrs.some((v) => {
        const n = Number(v);
        return !isNaN(n) && (n < 0 || n > 150);
      });
      if (hasAbnormal || cs.nullRate < 100) {
        addRule({
          name: `修正异常年龄值 - ${cs.columnName}`,
          field: cs.columnName,
          action: "standardize" as CleaningAction,
          issueDescription: `列 "${cs.columnName}" 可能存在超出合理范围（0-150）的年龄值`,
          strategy: "将小于 0 或大于 150 的年龄置为 NULL",
          affectedRows: Math.max(1, Math.round(nonNullCount * 0.05)),
          affectedPercent: 5,
          parameters: { type: "age_clamp", min: 0, max: 150, recommended: true },
          status: "pending",
          riskLevel: "medium",
          riskNote: "异常值将被置空，请确认业务规则",
        });
      }
    }

    // 性别 / 状态 / 类型 字典转换
    if (
      columnNameMatches(colLower, ["gender", "sex", "性别"]) ||
      (columnNameMatches(colLower, ["status", "type", "状态", "类型"]) && sampleStrs.length >= 2)
    ) {
      const lowerVariants = new Set(sampleStrs.map((v) => v.toLowerCase().trim()));
      const hasMixedCase = sampleStrs.length > 0 && lowerVariants.size < new Set(sampleStrs).size;
      const genderMapping =
        columnNameMatches(colLower, ["gender", "sex", "性别"])
          ? { m: "男", male: "男", f: "女", female: "女", "1": "男", "2": "女" }
          : undefined;

      if (hasMixedCase || genderMapping) {
        const dictVariants: RuleVariantOption[] = [];

        if (genderMapping) {
          dictVariants.push({
            key: "code_value",
            action: "standardize",
            name: `字典转换(文本值) - ${cs.columnName}`,
            strategy: "统一性别枚举：M/Male→男, F/Female→女",
            parameters: {
              dictionary: true,
              mapping: genderMapping,
              mappingMode: "value",
              recommended: true,
            },
            riskLevel: "low",
            riskNote: "将枚举映射为中文文本值",
          });
          dictVariants.push({
            key: "code_number",
            action: "standardize",
            name: `字典转换(编码值) - ${cs.columnName}`,
            strategy: "统一性别编码：M/Male→1, F/Female→2",
            parameters: {
              dictionary: true,
              mapping: { m: "1", male: "1", f: "2", female: "2", "1": "1", "2": "2" },
              mappingMode: "number",
            },
            riskLevel: "low",
            riskNote: "将枚举映射为数字编码，便于下游系统对接",
          });
        } else {
          dictVariants.push({
            key: "lower",
            action: "standardize",
            name: `字典转换(小写) - ${cs.columnName}`,
            strategy: "统一转换为小写标准值",
            parameters: { dictionary: true, case: "lower", recommended: true },
            riskLevel: "low",
            riskNote: "统一小写可能改变原始大小写语义",
          });
        }

        addGroupedRule(cs.columnName, "字典转换", {
          issueDescription: `列 "${cs.columnName}" 存在大小写或编码不一致的枚举值`,
          affectedRows: nonNullCount,
          affectedPercent: parseFloat((100 - cs.nullRate).toFixed(2)),
          variants: dictVariants,
          defaultVariantKey: dictVariants.find((v) => v.parameters.recommended)?.key || dictVariants[0].key,
        });
      }
    }

    // 大小写不一致（非枚举列）
    if (isStringType(cs.dataType) && !columnNameMatches(colLower, ["gender", "sex", "status", "type"])) {
      const uniqueLower = new Set(sampleStrs.map((v) => v.toLowerCase()));
      if (uniqueLower.size < sampleStrs.length && sampleStrs.length > 3) {
        addRule({
          name: `统一小写 - ${cs.columnName}`,
          field: cs.columnName,
          action: "standardize" as CleaningAction,
          issueDescription: `列 "${cs.columnName}" 存在大小写不一致`,
          strategy: "统一转换为小写",
          affectedRows: nonNullCount,
          affectedPercent: parseFloat((100 - cs.nullRate).toFixed(2)),
          parameters: { case: "lower", recommended: true },
          status: "pending",
          riskNote: "大小写转换可能影响业务逻辑，请确认",
        });
      }
    }

    // P1-2: 日期格式标准化
    const isDateLike =
      columnNameMatches(colLower, ["date", "time", "日期", "时间", "birth", "created", "updated"]) ||
      cs.dataType.toLowerCase().includes("date") ||
      cs.dataType.toLowerCase().includes("time");
    if (isDateLike && sampleStrs.length > 0) {
      const invalidDates = sampleStrs.filter((v) => Number.isNaN(new Date(v).getTime()));
      if (invalidDates.length > 0 || sampleStrs.some((v) => !/^\d{4}-\d{2}-\d{2}/.test(v))) {
        addRule({
          name: `日期格式标准化 - ${cs.columnName}`,
          field: cs.columnName,
          action: "format" as CleaningAction,
          issueDescription: `列 "${cs.columnName}" 存在非标准日期格式`,
          strategy: "解析并统一为 ISO 日期格式 (YYYY-MM-DD)",
          affectedRows: nonNullCount,
          affectedPercent: parseFloat((100 - cs.nullRate).toFixed(2)),
          parameters: { format: "DATE_ISO", recommended: true },
          status: "pending",
          riskLevel: "medium",
          riskNote: "无法解析的日期将置为 NULL",
        });
      }
    }

    // P1-3: 邮箱格式校验
    if (columnNameMatches(colLower, ["email", "mail", "邮箱"])) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const invalidCount = sampleStrs.filter((v) => !emailRegex.test(v)).length;
      if (invalidCount > 0) {
        addRule({
          name: `邮箱格式校验 - ${cs.columnName}`,
          field: cs.columnName,
          action: "standardize" as CleaningAction,
          issueDescription: `列 "${cs.columnName}" 存在无效邮箱格式`,
          strategy: "无效邮箱置为 NULL",
          affectedRows: Math.max(1, Math.round((invalidCount / Math.max(sampleStrs.length, 1)) * nonNullCount)),
          affectedPercent: parseFloat(((invalidCount / Math.max(sampleStrs.length, 1)) * 100).toFixed(2)),
          parameters: { type: "email_validate", invalidAction: "null", recommended: true },
          status: "pending",
          riskLevel: "medium",
          riskNote: "无效邮箱将被清空，请确认业务是否允许",
        });
      }
    }

    // P1-3: 手机号格式校验（与标准化规则互补）
    if (columnNameMatches(colLower, ["phone", "mobile", "tel", "cellphone", "手机", "电话"])) {
      const invalidPhones = sampleStrs.filter((v) => {
        const digits = v.replace(/\D/g, "");
        return digits.length < 7 || digits.length > 15;
      });
      if (invalidPhones.length > 0) {
        addRule({
          name: `手机号格式校验 - ${cs.columnName}`,
          field: cs.columnName,
          action: "standardize" as CleaningAction,
          issueDescription: `列 "${cs.columnName}" 存在位数异常的手机号`,
          strategy: "无效手机号置为 NULL",
          affectedRows: Math.max(1, Math.round((invalidPhones.length / Math.max(sampleStrs.length, 1)) * nonNullCount)),
          affectedPercent: parseFloat(((invalidPhones.length / Math.max(sampleStrs.length, 1)) * 100).toFixed(2)),
          parameters: { type: "phone_validate", invalidAction: "null", recommended: true },
          status: "pending",
          riskLevel: "medium",
          riskNote: "位数不在 7-15 之间的号码将被清空",
        });
      }
    }

    // 占位符伪空值（N/A、--、999 等）
    if (isStringType(cs.dataType) && sampleStrs.length > 0) {
      const placeholderHits = sampleStrs.filter((v) => isPlaceholderValue(v));
      if (placeholderHits.length > 0) {
        addRule({
          name: `占位符置空 - ${cs.columnName}`,
          field: cs.columnName,
          action: "standardize" as CleaningAction,
          issueDescription: `列 "${cs.columnName}" 存在 N/A、--、999 等占位符值`,
          strategy: "将常见占位符统一转换为 NULL",
          affectedRows: Math.max(1, Math.round((placeholderHits.length / sampleStrs.length) * nonNullCount)),
          affectedPercent: parseFloat(((placeholderHits.length / sampleStrs.length) * 100).toFixed(2)),
          parameters: withCategory(
            {
              type: "placeholder_null",
              placeholders: PLACEHOLDER_NULL_VALUES,
              treatEmptyAsNull: true,
              recommended: true,
            },
            "integrity"
          ),
          status: "pending",
          riskLevel: "low",
          riskNote: "占位符将被视为缺失值",
        });
      }
    }

    // 文本：连续空白折叠
    if (isStringType(cs.dataType)) {
      const hasMultiSpace = sampleStrs.some((v) => /\s{2,}/.test(v));
      if (hasMultiSpace) {
        addRule({
          name: `空白折叠 - ${cs.columnName}`,
          field: cs.columnName,
          action: "format" as CleaningAction,
          issueDescription: `列 "${cs.columnName}" 存在连续空白字符`,
          strategy: "TRIM 并折叠连续空白为单个空格",
          affectedRows: nonNullCount,
          affectedPercent: parseFloat((100 - cs.nullRate).toFixed(2)),
          parameters: withCategory({ format: "COLLAPSE_WS", recommended: true }, "text"),
          status: "pending",
          riskLevel: "low",
        });
      }
      const hasHtml = sampleStrs.some((v) => /<[^>]+>/.test(v));
      if (hasHtml) {
        addRule({
          name: `剥离 HTML 标签 - ${cs.columnName}`,
          field: cs.columnName,
          action: "format" as CleaningAction,
          issueDescription: `列 "${cs.columnName}" 含有 HTML 标签`,
          strategy: "移除 HTML 标签保留纯文本",
          affectedRows: nonNullCount,
          affectedPercent: parseFloat((100 - cs.nullRate).toFixed(2)),
          parameters: withCategory({ format: "STRIP_HTML", recommended: true }, "text"),
          status: "pending",
          riskLevel: "low",
        });
      }
      const hasFullWidth = sampleStrs.some((v) => /[\uFF01-\uFF5E]/.test(v));
      if (hasFullWidth) {
        addRule({
          name: `全角转半角 - ${cs.columnName}`,
          field: cs.columnName,
          action: "format" as CleaningAction,
          issueDescription: `列 "${cs.columnName}" 含有全角字符`,
          strategy: "将全角字母数字转为半角",
          affectedRows: nonNullCount,
          affectedPercent: parseFloat((100 - cs.nullRate).toFixed(2)),
          parameters: withCategory({ format: "FULLWIDTH", recommended: true }, "text"),
          status: "pending",
          riskLevel: "low",
        });
      }
    }

    // P1-4: 数值异常值（IQR / Z-score / Winsorize）
    if (isNumericType(cs.dataType)) {
      const nums = cs.sampleValues
        .filter((v) => v !== null && v !== undefined && v !== "" && !Number.isNaN(Number(v)))
        .map((v) => Number(v));
      if (nums.length >= 4) {
        const sorted = [...nums].sort((a, b) => a - b);
        const q1 = sorted[Math.floor(sorted.length * 0.25)] ?? sorted[0];
        const q3 = sorted[Math.floor(sorted.length * 0.75)] ?? sorted[sorted.length - 1];
        const iqr = q3 - q1;
        const lower = q1 - 1.5 * iqr;
        const upper = q3 + 1.5 * iqr;
        const outlierCount = nums.filter((n) => n < lower || n > upper).length;

        const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
        const std = Math.sqrt(nums.reduce((s, n) => s + (n - mean) ** 2, 0) / nums.length);
        const zLower = mean - 3 * std;
        const zUpper = mean + 3 * std;
        const zOutliers = std > 0 ? nums.filter((n) => n < zLower || n > zUpper).length : 0;

        const p1 = sorted[Math.floor(sorted.length * 0.01)] ?? sorted[0];
        const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? sorted[sorted.length - 1];

        if (outlierCount > 0 && iqr > 0) {
          const outlierVariants: RuleVariantOption[] = [
            {
              key: "iqr",
              action: "standardize",
              name: `异常值(IQR) - ${cs.columnName}`,
              strategy: `IQR 法：超出 [${lower.toFixed(2)}, ${upper.toFixed(2)}] 置 NULL`,
              parameters: {
                type: "outlier_iqr",
                min: Number(lower.toFixed(4)),
                max: Number(upper.toFixed(4)),
                recommended: true,
              },
              riskLevel: "medium",
            },
          ];
          if (zOutliers > 0) {
            outlierVariants.push({
              key: "zscore",
              action: "standardize",
              name: `异常值(Z-score 3σ) - ${cs.columnName}`,
              strategy: `3σ 法：超出 [${zLower.toFixed(2)}, ${zUpper.toFixed(2)}] 置 NULL`,
              parameters: {
                type: "outlier_zscore",
                min: Number(zLower.toFixed(4)),
                max: Number(zUpper.toFixed(4)),
                mean,
                std,
              },
              riskLevel: "medium",
            });
          }
          outlierVariants.push({
            key: "winsorize",
            action: "standardize",
            name: `Winsorize(1%/99%) - ${cs.columnName}`,
            strategy: `将值截断到 [${p1}, ${p99}] 百分位区间`,
            parameters: {
              type: "winsorize",
              min: p1,
              max: p99,
            },
            riskLevel: "medium",
            riskNote: "截断而非置空，保留样本量",
          });

          addGroupedRule(cs.columnName, "异常值", {
            issueDescription: `列 "${cs.columnName}" 存在统计异常值`,
            affectedRows: Math.max(1, Math.round((outlierCount / nums.length) * nonNullCount)),
            affectedPercent: parseFloat(((outlierCount / nums.length) * 100).toFixed(2)),
            variants: outlierVariants,
            defaultVariantKey: "iqr",
            category: "accuracy",
          });
        }

        if (typeof cs.minValue === "number" && typeof cs.maxValue === "number") {
          addRule({
            name: `范围校验 - ${cs.columnName}`,
            field: cs.columnName,
            action: "standardize" as CleaningAction,
            issueDescription: `列 "${cs.columnName}" 建议范围 [${cs.minValue}, ${cs.maxValue}]`,
            strategy: "超出统计范围的值置为 NULL",
            affectedRows: Math.max(1, Math.round(nonNullCount * 0.03)),
            affectedPercent: 3,
            parameters: withCategory(
              {
                type: "range_validate",
                min: cs.minValue,
                max: cs.maxValue,
                recommended: true,
              },
              "validity"
            ),
            status: "pending",
            riskLevel: "medium",
          });
        }
      }
    }

    // 长度校验：手机号 11 位、身份证 18 位
    if (columnNameMatches(colLower, ["phone", "mobile", "手机", "电话"])) {
      addRule({
        name: `手机号长度校验(11位) - ${cs.columnName}`,
        field: cs.columnName,
        action: "standardize" as CleaningAction,
        issueDescription: `列 "${cs.columnName}" 手机号应为 11 位`,
        strategy: "非 11 位数字号码置为 NULL",
        affectedRows: nonNullCount,
        affectedPercent: parseFloat((100 - cs.nullRate).toFixed(2)),
        parameters: withCategory({ type: "length_validate", expectedLength: 11, recommended: true }, "validity"),
        status: "pending",
        riskLevel: "medium",
      });
    }
    if (columnNameMatches(colLower, ["idcard", "身份证", "id_no", "identity"])) {
      addRule({
        name: `身份证长度校验(18位) - ${cs.columnName}`,
        field: cs.columnName,
        action: "standardize" as CleaningAction,
        issueDescription: `列 "${cs.columnName}" 身份证号应为 18 位`,
        strategy: "非 18 位证件号置为 NULL",
        affectedRows: nonNullCount,
        affectedPercent: parseFloat((100 - cs.nullRate).toFixed(2)),
        parameters: withCategory({ type: "length_validate", expectedLength: 18, recommended: true }, "validity"),
        status: "pending",
        riskLevel: "medium",
      });
    }

    // 外键/字典引用检查（基于样本唯一值 flag）
    if (columnNameMatches(colLower, ["code", "编码", "status", "type", "category"]) && sampleStrs.length >= 3) {
      const uniqueCodes = [...new Set(sampleStrs.map((v) => v.trim()))];
      if (uniqueCodes.length <= 20) {
        addRule({
          name: `字典码表校验 - ${cs.columnName}`,
          field: cs.columnName,
          action: "standardize" as CleaningAction,
          issueDescription: `列 "${cs.columnName}" 为枚举/编码字段，需与字典对齐`,
          strategy: "未在允许码表中的值标记审查（基础版保留原值）",
          affectedRows: nonNullCount,
          affectedPercent: parseFloat((100 - cs.nullRate).toFixed(2)),
          parameters: withCategory(
            {
              type: "fk_reference",
              allowedValues: uniqueCodes,
              dictMap: Object.fromEntries(uniqueCodes.map((c) => [c, c])),
              recommended: true,
            },
            "consistency"
          ),
          status: "pending",
          riskLevel: "low",
          riskNote: "完整 FK 校验需连接维表，当前为样本码表快照",
        });
      }
    }

    // 正则枚举校验（状态类字段）
    if (columnNameMatches(colLower, ["status", "state", "状态"]) && sampleStrs.length >= 2) {
      addRule({
        name: `状态枚举正则校验 - ${cs.columnName}`,
        field: cs.columnName,
        action: "standardize" as CleaningAction,
        issueDescription: `列 "${cs.columnName}" 状态值应符合枚举格式`,
        strategy: "不匹配 ^[A-Za-z0-9_]+$ 的值置为 NULL",
        affectedRows: nonNullCount,
        affectedPercent: parseFloat((100 - cs.nullRate).toFixed(2)),
        parameters: withCategory(
          { type: "regex_validate", pattern: "^[A-Za-z0-9_]+$", recommended: true },
          "validity"
        ),
        status: "pending",
        riskLevel: "low",
      });
    }

    // P1-5: 编码/乱码检测
    if (isStringType(cs.dataType) && sampleStrs.length > 0) {
      const enc = detectEncodingIssues(sampleStrs);
      if (enc.hasMojibake) {
        const encVariants: RuleVariantOption[] = [
          {
            key: "detect",
            action: "standardize",
            name: `乱码检测 - ${cs.columnName}`,
            strategy: "标记含乱码/替换字符的值为 ENCODING_ERROR",
            parameters: {
              type: "encoding_detect",
              invalidAction: "flag",
              replacementRatio: Number(enc.replacementRatio.toFixed(4)),
              recommended: true,
            },
            riskLevel: "low",
          },
          {
            key: "fix",
            action: "standardize",
            name: `乱码修复 - ${cs.columnName}`,
            strategy: "尝试 latin1→utf8 回转修复常见乱码",
            parameters: { type: "encoding_fix", recommended: false },
            riskLevel: "medium",
            riskNote: "自动修复可能改变语义，建议先抽样验证",
          },
        ];
        addGroupedRule(cs.columnName, "编码乱码", {
          issueDescription: `列 "${cs.columnName}" 存在乱码或无效 UTF-8 序列`,
          affectedRows: Math.max(1, Math.round(nonNullCount * 0.1)),
          affectedPercent: Math.min(100, parseFloat((enc.replacementRatio * 100 + 5).toFixed(2))),
          variants: encVariants,
          defaultVariantKey: "detect",
          category: "text",
        });
      }
    }

    // P1-24: 时区规范化（文档类）
    if (
      columnNameMatches(colLower, ["timezone", "tz", "utc", "时区"]) ||
      (columnNameMatches(colLower, ["time", "timestamp", "日期", "时间"]) &&
        sampleStrs.some((v) => /[+-]\d{2}:?\d{2}|Z$/i.test(v)))
    ) {
      addRule({
        name: `时区规范化 - ${cs.columnName}`,
        field: cs.columnName,
        action: "standardize" as CleaningAction,
        issueDescription: `列 "${cs.columnName}" 含时区信息，建议统一为 UTC`,
        strategy: "将时间戳规范化为 UTC（文件路径完整转换，SQL 尽力标注）",
        affectedRows: nonNullCount,
        affectedPercent: parseFloat((100 - cs.nullRate).toFixed(2)),
        parameters: withCategory(
          { type: "timezone_normalize", targetTimezone: "UTC", recommended: true },
          "document"
        ),
        status: "pending",
        riskLevel: "medium",
        riskNote: "跨时区业务需确认目标时区",
      });
    }

    // P1-24: 状态机顺序校验
    if (columnNameMatches(colLower, ["status", "state", "状态"]) && sampleStrs.length >= 2) {
      const normalized = sampleStrs.map((v) => v.toLowerCase().trim());
      const hasKnown = normalized.some((v) => Object.keys(DEFAULT_STATE_TRANSITIONS).includes(v));
      if (hasKnown) {
        addRule({
          name: `状态转移校验 - ${cs.columnName}`,
          field: cs.columnName,
          action: "standardize" as CleaningAction,
          issueDescription: `列 "${cs.columnName}" 状态值应符合业务状态机顺序`,
          strategy: "按 allowedTransitions 标记非法后继状态",
          affectedRows: nonNullCount,
          affectedPercent: parseFloat((100 - cs.nullRate).toFixed(2)),
          parameters: withCategory(
            {
              type: "state_transition",
              allowedTransitions: DEFAULT_STATE_TRANSITIONS,
              invalidAction: "flag",
              recommended: true,
            },
            "document"
          ),
          status: "pending",
          riskLevel: "medium",
          riskNote: "行级顺序校验在文件清洗路径执行，需有序样本",
        });
      }
    }
  }

  // P1-8: 关联列合并推荐
  const columnNames = exploration.columnStats.map((cs) => cs.columnName);
  for (const hint of detectMergePairs(columnNames)) {
    addRule({
      name: `${hint.label} - ${hint.sourceFields.join("+")}`,
      field: hint.targetField,
      action: "merge" as CleaningAction,
      issueDescription: `检测到关联列 ${hint.sourceFields.join("、")}，可合并为 ${hint.targetField}`,
      strategy: `使用 CONCAT_WS('${hint.separator}') 合并多列`,
      affectedRows: exploration.totalRows,
      affectedPercent: 100,
      parameters: withCategory(
        {
          sourceFields: hint.sourceFields,
          separator: hint.separator,
          recommended: true,
        },
        "text"
      ),
      status: "pending",
      riskLevel: "low",
      riskNote: "将写入目标列，不删除源列",
    });
  }

  // P1-7: 跨字段规则
  for (const hint of detectCrossFieldRules(columnNames)) {
    const [fieldA, fieldB] = hint.fields;
    addRule({
      name: `跨字段校验 - ${fieldA} ${hint.operator} ${fieldB}`,
      field: fieldB,
      action: "standardize" as CleaningAction,
      issueDescription: hint.label,
      strategy: `不满足 ${fieldA} ${hint.operator} ${fieldB} 时置空或标记`,
      affectedRows: Math.max(1, Math.round(exploration.totalRows * 0.05)),
      affectedPercent: 5,
      parameters: withCategory(
        {
          type: "cross_field",
          fields: hint.fields,
          operator: hint.operator,
          action: "null",
          optionalThird: hint.optionalThird,
          recommended: true,
        },
        "consistency"
      ),
      status: "pending",
      riskLevel: "medium",
      riskNote: "跨字段规则在文件路径做行级校验",
    });
  }

  // P1-24: 时间序列重复时间戳
  const timeCols = exploration.columnStats.filter((cs) =>
    columnNameMatches(cs.columnName.toLowerCase(), [
      "time",
      "timestamp",
      "日期",
      "时间",
      "created",
      "updated",
    ])
  );
  for (const tc of timeCols) {
    const values = exploration.sampleData
      .map((r) => r[tc.columnName])
      .filter((v) => v !== null && v !== undefined && v !== "");
    if (values.length < 2) continue;
    const strValues = values.map(String);
    const unique = new Set(strValues);
    if (unique.size < strValues.length) {
      const dupCount = strValues.length - unique.size;
      addRule({
        name: `重复时间戳检测 - ${tc.columnName}`,
        field: tc.columnName,
        action: "standardize" as CleaningAction,
        issueDescription: `时间列 "${tc.columnName}" 样本中存在重复时间戳`,
        strategy: "标记重复时间戳行（文件路径行级检测）",
        affectedRows: dupCount,
        affectedPercent: parseFloat(((dupCount / strValues.length) * 100).toFixed(2)),
        parameters: withCategory(
          { type: "duplicate_timestamp", invalidAction: "flag", recommended: true },
          "document"
        ),
        status: "pending",
        riskLevel: "medium",
        riskNote: "时间序列去重需结合业务确认保留策略",
      });
    }
  }

  // P1-25: MICE 等高级算法不在自动推荐池中（见 cleaningActionRegistry ADVANCED_AUTO_SKIP_TYPES）
  // 待 SQL/文件路径实现后再加入 generateCleaningRules。

  return rules;
}
