import type { CleaningRule, DatabaseDialect } from "@contracts/types";
import {
  buildInvalidCaseSql,
  invalidFlagSuffix,
  resolveInvalidAction,
} from "./invalidAction";
import { buildIdCardTransformSql, transformIdCard } from "./idCardTransform";

/** 将校验规则包装为 invalidAction 语义 SQL */
export function wrapValidateSql(
  rule: CleaningRule,
  validCond: string,
  validExpr: string,
  rawExpr: string
): string {
  const invalidAction = resolveInvalidAction(rule);
  const customValue = rule.parameters.customValue as string | undefined;
  const ruleType = String(rule.parameters.type ?? "");
  const flagSuffix = invalidFlagSuffix(ruleType);
  return buildInvalidCaseSql(validCond, validExpr, rawExpr, invalidAction, customValue, flagSuffix);
}

/** 校验规则 reject 时的 WHERE 保留条件（空值保留，无效值删行） */
export function buildValidateRejectWhereSql(
  rule: CleaningRule,
  expr: string,
  dialect: DatabaseDialect
): string | null {
  if (resolveInvalidAction(rule) !== "reject") return null;
  const trimmed = dialect === "postgresql" ? `TRIM(${expr}::text)` : `TRIM(${expr})`;
  const nullOrEmpty = `(${expr} IS NULL OR ${trimmed} = '')`;
  const validCond = buildValidateConditionSql(rule, expr, dialect);
  if (!validCond) return null;
  return `(${nullOrEmpty} OR (${validCond}))`;
}

function buildValidateConditionSql(
  rule: CleaningRule,
  expr: string,
  dialect: DatabaseDialect
): string | null {
  const type = rule.parameters.type as string | undefined;
  const trimmed = dialect === "postgresql" ? `TRIM(${expr}::text)` : `TRIM(${expr})`;
  const regexpOp = dialect === "postgresql" ? "~" : "REGEXP";

  switch (type) {
    case "email_validate":
      return `${expr} ${regexpOp} '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'`;
    case "phone_validate": {
      const cleaned =
        dialect === "postgresql"
          ? `REGEXP_REPLACE(${expr}::text, '[^0-9]', '', 'g')`
          : `REGEXP_REPLACE(${expr}, '[^0-9]', '')`;
      return `CHAR_LENGTH(${cleaned}) BETWEEN 7 AND 15`;
    }
    case "regex_validate": {
      const pattern = String(rule.parameters.pattern ?? ".*").replace(/'/g, "''");
      return `${expr} ${regexpOp} '${pattern}'`;
    }
    case "length_validate": {
      const expected = (rule.parameters.expectedLength as number) ?? 11;
      return `CHAR_LENGTH(${trimmed}) = ${expected}`;
    }
    case "length_range": {
      const min = rule.parameters.minLength as number | undefined;
      const max = rule.parameters.maxLength as number | undefined;
      const lenExpr = `CHAR_LENGTH(${trimmed})`;
      const parts: string[] = [];
      if (min !== undefined) parts.push(`${lenExpr} >= ${min}`);
      if (max !== undefined) parts.push(`${lenExpr} <= ${max}`);
      return parts.length > 0 ? parts.join(" AND ") : null;
    }
    case "range_validate": {
      const min = rule.parameters.min ?? 0;
      const max = rule.parameters.max ?? 150;
      return `CAST(${expr} AS SIGNED) >= ${min} AND CAST(${expr} AS SIGNED) <= ${max}`;
    }
    case "id_card_transform": {
      const inner = buildIdCardTransformSql(expr, dialect);
      return `(${inner}) IS NOT NULL`;
    }
    default:
      return null;
  }
}

/** 生成带 invalidAction 的校验/转换 SQL 表达式 */
export function buildValidateExpressionSql(
  rule: CleaningRule,
  expr: string,
  dialect: DatabaseDialect
): string | null {
  const type = rule.parameters.type as string | undefined;
  const regexpOp = dialect === "postgresql" ? "~" : "REGEXP";

  switch (type) {
    case "email_validate": {
      const cond = `${expr} ${regexpOp} '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'`;
      return wrapValidateSql(rule, cond, expr, expr);
    }
    case "phone_validate": {
      const cleaned =
        dialect === "postgresql"
          ? `REGEXP_REPLACE(${expr}::text, '[^0-9]', '', 'g')`
          : `REGEXP_REPLACE(${expr}, '[^0-9]', '')`;
      const cond = `CHAR_LENGTH(${cleaned}) BETWEEN 7 AND 15`;
      return wrapValidateSql(rule, cond, cleaned, expr);
    }
    case "regex_validate": {
      const pattern = String(rule.parameters.pattern ?? ".*").replace(/'/g, "''");
      const cond = `${expr} ${regexpOp} '${pattern}'`;
      return wrapValidateSql(rule, cond, expr, expr);
    }
    case "length_validate": {
      const expected = (rule.parameters.expectedLength as number) ?? 11;
      const trimmed = dialect === "postgresql" ? `TRIM(${expr}::text)` : `TRIM(${expr})`;
      const cond = `CHAR_LENGTH(${trimmed}) = ${expected}`;
      return wrapValidateSql(rule, cond, expr, expr);
    }
    case "length_range": {
      const min = rule.parameters.minLength as number | undefined;
      const max = rule.parameters.maxLength as number | undefined;
      const trimmed = dialect === "postgresql" ? `TRIM(${expr}::text)` : `TRIM(${expr})`;
      const lenExpr = `CHAR_LENGTH(${trimmed})`;
      const parts: string[] = [];
      if (min !== undefined) parts.push(`${lenExpr} >= ${min}`);
      if (max !== undefined) parts.push(`${lenExpr} <= ${max}`);
      if (parts.length === 0) return null;
      const cond = parts.join(" AND ");
      return wrapValidateSql(rule, cond, expr, expr);
    }
    case "range_validate": {
      const min = rule.parameters.min ?? 0;
      const max = rule.parameters.max ?? 150;
      const cond = `CAST(${expr} AS SIGNED) >= ${min} AND CAST(${expr} AS SIGNED) <= ${max}`;
      return wrapValidateSql(rule, cond, expr, expr);
    }
    case "id_card_transform": {
      const transformed = buildIdCardTransformSql(expr, dialect);
      const cond = `(${transformed}) IS NOT NULL`;
      return wrapValidateSql(rule, cond, transformed, expr);
    }
    default:
      return null;
  }
}

/** 文件清洗：判断校验规则是否通过 */
export function isValidateRulePass(rule: CleaningRule, value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  const str = String(value);
  const type = rule.parameters.type as string | undefined;

  switch (type) {
    case "email_validate":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
    case "phone_validate": {
      const digits = str.replace(/\D/g, "");
      return digits.length >= 7 && digits.length <= 15;
    }
    case "regex_validate": {
      try {
        return new RegExp(String(rule.parameters.pattern ?? ".*")).test(str);
      } catch {
        return true;
      }
    }
    case "length_validate": {
      const expected = (rule.parameters.expectedLength as number) ?? 11;
      return str.trim().length === expected;
    }
    case "length_range": {
      const len = str.trim().length;
      const min = rule.parameters.minLength as number | undefined;
      const max = rule.parameters.maxLength as number | undefined;
      if (min !== undefined && len < min) return false;
      if (max !== undefined && len > max) return false;
      return true;
    }
    case "range_validate": {
      const num = Number(value);
      const min = (rule.parameters.min as number) ?? 0;
      const max = (rule.parameters.max as number) ?? 150;
      return !Number.isNaN(num) && num >= min && num <= max;
    }
    case "id_card_transform":
      return transformIdCard(str) !== null;
    default:
      return true;
  }
}
