import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

/** 数据标准单字段约束 */
export interface DataStandardFieldRule {
  field: string;
  /** 数据类型 hint */
  dataType?: string;
  /** 允许取值枚举 */
  enumValues?: string[];
  /** 数值范围 */
  min?: number;
  max?: number;
  /** 正则格式 */
  pattern?: string;
  /** 是否必填 */
  required?: boolean;
  /** 字段说明 */
  description?: string;
}

export interface DataStandardParseResult {
  rules: DataStandardFieldRule[];
  standardName?: string;
  errors: string[];
}

/** 从单条原始记录提取字段规则 */
function normalizeFieldRule(raw: Record<string, unknown>, index: number): DataStandardFieldRule | null {
  const field = String(raw.field ?? raw.name ?? raw.字段 ?? raw.列名 ?? "").trim();
  if (!field) {
    return null;
  }

  const rule: DataStandardFieldRule = { field };

  if (raw.dataType ?? raw.type ?? raw.数据类型) {
    rule.dataType = String(raw.dataType ?? raw.type ?? raw.数据类型);
  }
  if (raw.enum ?? raw.enumValues ?? raw.枚举) {
    const ev = raw.enum ?? raw.enumValues ?? raw.枚举;
    rule.enumValues = Array.isArray(ev) ? ev.map(String) : [String(ev)];
  }
  if (raw.min !== undefined) rule.min = Number(raw.min);
  if (raw.max !== undefined) rule.max = Number(raw.max);
  if (raw.pattern ?? raw.regex ?? raw.格式) {
    rule.pattern = String(raw.pattern ?? raw.regex ?? raw.格式);
  }
  if (raw.required !== undefined || raw.必填 !== undefined) {
    rule.required = Boolean(raw.required ?? raw.必填);
  }
  if (raw.description ?? raw.desc ?? raw.说明) {
    rule.description = String(raw.description ?? raw.desc ?? raw.说明);
  }

  void index;
  return rule;
}

/** 解析 JSON 数据标准 */
export function parseDataStandardJson(content: string): DataStandardParseResult {
  const errors: string[] = [];
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const standardName =
      typeof parsed.name === "string"
        ? parsed.name
        : typeof parsed.standardName === "string"
        ? parsed.standardName
        : undefined;

    const fieldsRaw =
      parsed.fields ??
      parsed.rules ??
      parsed.columns ??
      parsed.字段 ??
      (Array.isArray(parsed) ? parsed : null);

    if (!fieldsRaw || !Array.isArray(fieldsRaw)) {
      return { rules: [], errors: ["JSON 需包含 fields/rules 数组或顶层为数组"] };
    }

    const rules: DataStandardFieldRule[] = [];
    for (let i = 0; i < fieldsRaw.length; i++) {
      const item = fieldsRaw[i];
      if (!item || typeof item !== "object") continue;
      const rule = normalizeFieldRule(item as Record<string, unknown>, i);
      if (rule) rules.push(rule);
      else errors.push(`第 ${i + 1} 条字段规则缺少 field，已跳过`);
    }

    return { rules, standardName, errors };
  } catch {
    return { rules: [], errors: ["JSON 解析失败"] };
  }
}

/** 解析 YAML 数据标准 */
export function parseDataStandardYaml(content: string): DataStandardParseResult {
  const errors: string[] = [];
  try {
    const parsed = parseYaml(content) as Record<string, unknown> | unknown[];
    if (Array.isArray(parsed)) {
      const rules: DataStandardFieldRule[] = [];
      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        if (!item || typeof item !== "object") continue;
        const rule = normalizeFieldRule(item as Record<string, unknown>, i);
        if (rule) rules.push(rule);
      }
      return { rules, errors };
    }

    if (!parsed || typeof parsed !== "object") {
      return { rules: [], errors: ["YAML 根节点需为对象或数组"] };
    }

    return parseDataStandardJson(JSON.stringify(parsed));
  } catch {
    return { rules: [], errors: ["YAML 解析失败"] };
  }
}

/** 根据扩展名解析数据标准文件 */
export function parseDataStandardFile(filePath: string): DataStandardParseResult {
  const ext = path.extname(filePath).toLowerCase();
  const content = readFileSync(filePath, "utf8");
  if (ext === ".yaml" || ext === ".yml") return parseDataStandardYaml(content);
  return parseDataStandardJson(content);
}

/** 将数据标准字段规则转为清洗规则参数（供 rulesRouter 创建） */
export function dataStandardToRuleParams(
  rule: DataStandardFieldRule
): { action: "format" | "standardize"; parameters: Record<string, unknown>; name: string } {
  if (rule.enumValues && rule.enumValues.length > 0) {
    return {
      action: "standardize",
      name: `标准值域过滤：${rule.field}`,
      parameters: {
        type: "domain_filter",
        allowedValues: rule.enumValues,
        invalidAction: "reject",
        fromDataStandard: true,
      },
    };
  }
  if (rule.pattern) {
    return {
      action: "standardize",
      name: `正则过滤：${rule.field}`,
      parameters: {
        type: "regex_filter",
        pattern: rule.pattern,
        invalidAction: "reject",
        fromDataStandard: true,
      },
    };
  }
  if (rule.min !== undefined || rule.max !== undefined) {
    return {
      action: "standardize",
      name: `标准值域过滤：${rule.field}`,
      parameters: {
        type: "domain_filter",
        min: rule.min,
        max: rule.max,
        invalidAction: "reject",
        fromDataStandard: true,
      },
    };
  }
  return {
    action: "format",
    name: `标准约束：${rule.field}`,
    parameters: { fromDataStandard: true, required: rule.required ?? false },
  };
}
