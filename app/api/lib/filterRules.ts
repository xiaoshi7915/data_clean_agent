import type { CleaningRule, DatabaseDialect } from "@contracts/types";
import { resolveInvalidAction } from "./invalidAction";

export type CompareOperator = "eq" | "ne" | "gt" | "lt" | "gte" | "lte";

const FILTER_RULE_TYPES = new Set([
  "compare_filter",
  "length_range",
  "regex_filter",
  "domain_filter",
]);

/** 是否为删行分流类过滤规则 */
export function isFilterRuleType(type: string | undefined): boolean {
  return !!type && FILTER_RULE_TYPES.has(type);
}

function sqlOperator(op: CompareOperator): string {
  switch (op) {
    case "eq":
      return "=";
    case "ne":
      return "<>";
    case "gt":
      return ">";
    case "lt":
      return "<";
    case "gte":
      return ">=";
    case "lte":
      return "<=";
    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

function jsCompare(a: unknown, b: unknown, op: CompareOperator): boolean {
  const numA = Number(a);
  const numB = Number(b);
  const useNum = !Number.isNaN(numA) && !Number.isNaN(numB) && String(a).trim() !== "" && String(b).trim() !== "";
  const left = useNum ? numA : String(a ?? "");
  const right = useNum ? numB : String(b ?? "");
  switch (op) {
    case "eq":
      return left === right;
    case "ne":
      return left !== right;
    case "gt":
      return left > right;
    case "lt":
      return left < right;
    case "gte":
      return left >= right;
    case "lte":
      return left <= right;
    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

/** 过滤规则：行是否应保留（true=保留） */
export function isFilterRulePass(rule: CleaningRule, row: Record<string, unknown>): boolean {
  const type = rule.parameters.type as string | undefined;
  const field = rule.field;
  const value = row[field];

  if (value === null || value === undefined || value === "") return true;

  switch (type) {
    case "compare_filter": {
      const op = (rule.parameters.operator as CompareOperator) || "eq";
      const compareColumn = rule.parameters.compareColumn as string | undefined;
      const compareValue = rule.parameters.compareValue;
      const rhs = compareColumn ? row[compareColumn] : compareValue;
      if (rhs === undefined && compareColumn) return true;
      return jsCompare(value, rhs, op);
    }
    case "length_range": {
      const len = String(value).trim().length;
      const min = rule.parameters.minLength as number | undefined;
      const max = rule.parameters.maxLength as number | undefined;
      if (min !== undefined && len < min) return false;
      if (max !== undefined && len > max) return false;
      return true;
    }
    case "regex_filter": {
      try {
        const pattern = new RegExp(String(rule.parameters.pattern ?? ".*"));
        return pattern.test(String(value));
      } catch {
        return true;
      }
    }
    case "domain_filter": {
      const allowed = rule.parameters.allowedValues as string[] | undefined;
      const str = String(value).trim();
      if (allowed && allowed.length > 0) {
        return allowed.includes(str);
      }
      const num = Number(value);
      if (Number.isNaN(num)) return false;
      const min = rule.parameters.min as number | undefined;
      const max = rule.parameters.max as number | undefined;
      if (min !== undefined && num < min) return false;
      if (max !== undefined && num > max) return false;
      return true;
    }
    default:
      return true;
  }
}

/** SQL WHERE：过滤规则保留条件（空值保留） */
export function buildFilterKeepWhereSql(
  rule: CleaningRule,
  expr: string,
  dialect: DatabaseDialect
): string | null {
  if (resolveInvalidAction(rule) !== "reject") return null;
  const type = rule.parameters.type as string | undefined;
  if (!isFilterRuleType(type)) return null;

  const trimmed = dialect === "postgresql" ? `TRIM(${expr}::text)` : `TRIM(${expr})`;
  const nullOrEmpty = `(${expr} IS NULL OR ${trimmed} = '')`;
  let keepCond: string | null = null;

  switch (type) {
    case "compare_filter": {
      const op = (rule.parameters.operator as CompareOperator) || "eq";
      const compareColumn = rule.parameters.compareColumn as string | undefined;
      if (compareColumn) {
        const rhs = `src.${quoteIdent(compareColumn, dialect)}`;
        keepCond = `${expr} ${sqlOperator(op)} ${rhs}`;
      } else if (rule.parameters.compareValue !== undefined) {
        const rhs = formatSqlLiteral(rule.parameters.compareValue);
        keepCond = `${expr} ${sqlOperator(op)} ${rhs}`;
      }
      break;
    }
    case "length_range": {
      const min = rule.parameters.minLength as number | undefined;
      const max = rule.parameters.maxLength as number | undefined;
      const lenExpr = `CHAR_LENGTH(${trimmed})`;
      const parts: string[] = [];
      if (min !== undefined) parts.push(`${lenExpr} >= ${min}`);
      if (max !== undefined) parts.push(`${lenExpr} <= ${max}`);
      if (parts.length > 0) keepCond = parts.join(" AND ");
      break;
    }
    case "regex_filter": {
      const pattern = String(rule.parameters.pattern ?? ".*").replace(/'/g, "''");
      const regexpOp = dialect === "postgresql" ? "~" : "REGEXP";
      keepCond = `${expr} ${regexpOp} '${pattern}'`;
      break;
    }
    case "domain_filter": {
      const allowed = rule.parameters.allowedValues as string[] | undefined;
      if (allowed && allowed.length > 0) {
        const inList = allowed.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(", ");
        keepCond = `${expr} IN (${inList})`;
      } else {
        const min = rule.parameters.min as number | undefined;
        const max = rule.parameters.max as number | undefined;
        const parts: string[] = [];
        if (min !== undefined) parts.push(`CAST(${expr} AS SIGNED) >= ${min}`);
        if (max !== undefined) parts.push(`CAST(${expr} AS SIGNED) <= ${max}`);
        if (parts.length > 0) keepCond = parts.join(" AND ");
      }
      break;
    }
    default:
      break;
  }

  if (!keepCond) return null;
  return `(${nullOrEmpty} OR (${keepCond}))`;
}

/** length_range 校验（invalidAction 非 reject 时单元格级） */
export function isLengthRangePass(rule: CleaningRule, value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  const len = String(value).trim().length;
  const min = rule.parameters.minLength as number | undefined;
  const max = rule.parameters.maxLength as number | undefined;
  if (min !== undefined && len < min) return false;
  if (max !== undefined && len > max) return false;
  return true;
}

function quoteIdent(name: string, dialect: DatabaseDialect): string {
  switch (dialect) {
    case "mysql":
      return `\`${name}\``;
    case "postgresql":
    case "sqlite":
      return `"${name}"`;
    case "sqlserver":
      return `[${name}]`;
    default:
      return name;
  }
}

function formatSqlLiteral(value: unknown): string {
  if (typeof value === "number") return String(value);
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

/** 问题表 err_type 标签 */
export function filterRuleErrType(type: string | undefined): string {
  switch (type) {
    case "compare_filter":
      return "COMPARE_FILTER";
    case "length_range":
      return "LENGTH_RANGE";
    case "regex_filter":
      return "REGEX_FILTER";
    case "domain_filter":
      return "DOMAIN_FILTER";
    default:
      return "FILTER";
  }
}
