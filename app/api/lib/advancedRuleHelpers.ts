import type { CleaningRule, DatabaseDialect } from "@contracts/types";
import { wrapValidateSql } from "./validateRuleSql";
import { isEntityValidatorPass } from "./entityValidators";

/** decimal_precision / integer_validate SQL 表达式 */
export function buildNumericValidateSql(rule: CleaningRule, expr: string): string | null {
  const type = rule.parameters.type as string | undefined;
  if (type === "decimal_precision") {
    const scale = (rule.parameters.scale as number) ?? 2;
    const rounded = `ROUND(CAST(${expr} AS DECIMAL(18,6)), ${scale})`;
    const cond = `${expr} IS NULL OR TRIM(${expr}) = '' OR CAST(${expr} AS DECIMAL(18,6)) IS NOT NULL`;
    return wrapValidateSql(rule, cond, rounded, expr);
  }
  if (type === "integer_validate") {
    const cond = `${expr} REGEXP '^-?[0-9]+$'`;
    return wrapValidateSql(rule, cond, expr, expr);
  }
  return null;
}

export function isNumericValidatePass(rule: CleaningRule, value: unknown): boolean {
  const type = rule.parameters.type as string | undefined;
  if (value === null || value === undefined || value === "") return true;
  const str = String(value).trim();
  if (type === "integer_validate") return /^-?\d+$/.test(str);
  if (type === "decimal_precision") return !Number.isNaN(Number(str));
  return true;
}

export function buildEntityValidateSql(
  rule: CleaningRule,
  expr: string,
  dialect: DatabaseDialect
): string | null {
  const type = rule.parameters.type as string | undefined;
  if (!type?.endsWith("_validate")) return null;
  if (["email_validate", "phone_validate", "regex_validate", "length_validate", "range_validate", "id_card_transform"].includes(type)) {
    return null;
  }

  const patterns: Record<string, string> = {
    credit_code_validate: "^[0-9A-HJ-NPQRTUWXY]{2}\\d{6}[0-9A-HJ-NPQRTUWXY]{10}$",
    landline_validate: "^[0-9\\-\\(\\)\\s]{7,20}$",
    mac_validate: "^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$",
    ip_validate: "^([0-9a-fA-F.:]+)$",
    longitude_validate: "^-?(180|(1[0-7]\\d|[1-9]?\\d)(\\.\\d+)?)$",
    latitude_validate: "^-?(90|([1-8]?\\d)(\\.\\d+)?)$",
  };

  const pattern = patterns[type];
  if (!pattern) return null;
  const regexpOp = dialect === "postgresql" ? "~" : "REGEXP";
  const cond = `UPPER(TRIM(${expr})) ${regexpOp} '${pattern}' OR ${expr} IS NULL OR TRIM(${expr}) = ''`;
  return wrapValidateSql(rule, cond, expr, expr);
}

export function isEntityValidatePass(rule: CleaningRule, value: unknown): boolean {
  const type = rule.parameters.type as string | undefined;
  if (!type) return true;
  return isEntityValidatorPass(type, value);
}

/** 自定义表达式（P2-R6 defer stub）— 仅记录模板，不执行 */
export function isCustomExpressionStub(rule: CleaningRule): boolean {
  return rule.parameters.type === "custom_expression";
}

/** 分区内去重 dedupScope=partition（P2-R7 partial） */
export function buildPartitionDedupPartitionCols(
  rule: CleaningRule,
  columns: string[],
  dedupField: string
): string[] {
  const scope = rule.parameters.dedupScope as string | undefined;
  if (scope !== "partition") return [dedupField];
  const partitionBy = rule.parameters.partitionBy as string[] | undefined;
  if (partitionBy && partitionBy.length > 0) {
    return partitionBy.filter((c) => columns.includes(c));
  }
  return [dedupField];
}

export function supportsPartitionDedup(dialect: DatabaseDialect): boolean {
  return dialect === "mysql" || dialect === "postgresql" || dialect === "sqlserver";
}
