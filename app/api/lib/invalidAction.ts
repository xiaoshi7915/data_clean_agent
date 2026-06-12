import type { CleaningRule, InvalidAction } from "@contracts/types";

/** 支持 invalidAction 的校验类 parameters.type */
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

/** 解析 invalidAction，兼容旧版 parameters.action === "flag" */
export function resolveInvalidAction(rule: CleaningRule): InvalidAction {
  const explicit = rule.parameters.invalidAction as InvalidAction | undefined;
  if (explicit && isInvalidAction(explicit)) return explicit;
  // 旧版 cross_field 等使用 parameters.action 表示 flag/null
  if (rule.parameters.action === "flag") return "flag";
  return "null";
}

function isInvalidAction(value: string): value is InvalidAction {
  return (
    value === "reject" ||
    value === "keep" ||
    value === "null" ||
    value === "empty_string" ||
    value === "custom" ||
    value === "flag"
  );
}

/** 规则是否配置了 invalidAction=reject（删行） */
export function isRejectInvalidAction(rule: CleaningRule): boolean {
  return resolveInvalidAction(rule) === "reject";
}

/** 校验规则是否支持 invalidAction 配置 */
export function supportsInvalidAction(rule: CleaningRule): boolean {
  const type = rule.parameters.type as string | undefined;
  return !!type && INVALID_ACTION_RULE_TYPES.has(type);
}

/** 无效值时的 SQL CASE 分支表达式（validCond 为真时保留 validExpr） */
export function buildInvalidCaseSql(
  validCond: string,
  validExpr: string,
  rawExpr: string,
  invalidAction: InvalidAction,
  customValue?: string,
  flagSuffix = "[INVALID]"
): string {
  switch (invalidAction) {
    case "keep":
      return `CASE WHEN ${validCond} THEN ${validExpr} ELSE ${rawExpr} END`;
    case "null":
      return `CASE WHEN ${validCond} THEN ${validExpr} ELSE NULL END`;
    case "empty_string":
      return `CASE WHEN ${validCond} THEN ${validExpr} ELSE '' END`;
    case "custom": {
      const escaped = String(customValue ?? "").replace(/'/g, "''");
      return `CASE WHEN ${validCond} THEN ${validExpr} ELSE '${escaped}' END`;
    }
    case "flag": {
      const suffix = flagSuffix.replace(/'/g, "''");
      return `CASE WHEN ${validCond} THEN ${validExpr} ELSE CONCAT(CAST(${rawExpr} AS CHAR), '${suffix}') END`;
    }
    case "reject":
      // reject 由 WHERE 删行处理，此处无效值仍置 NULL 作为兜底
      return `CASE WHEN ${validCond} THEN ${validExpr} ELSE NULL END`;
    default: {
      const _exhaustive: never = invalidAction;
      return _exhaustive;
    }
  }
}

/** 文件清洗：根据 invalidAction 写入无效单元格值 */
export function applyInvalidCellValue(
  rawValue: unknown,
  isValid: boolean,
  invalidAction: InvalidAction,
  options?: { customValue?: string; flagSuffix?: string }
): unknown {
  if (isValid) return rawValue;
  switch (invalidAction) {
    case "keep":
      return rawValue;
    case "null":
      return null;
    case "empty_string":
      return "";
    case "custom":
      return options?.customValue ?? "";
    case "flag": {
      const suffix = options?.flagSuffix ?? "[INVALID]";
      return `${String(rawValue ?? "")}${suffix}`;
    }
    case "reject":
      return rawValue;
    default: {
      const _exhaustive: never = invalidAction;
      return _exhaustive;
    }
  }
}

/** 各校验类型的 flag 后缀标签 */
export function invalidFlagSuffix(ruleType: string): string {
  switch (ruleType) {
    case "email_validate":
      return "[INVALID_EMAIL]";
    case "phone_validate":
      return "[INVALID_PHONE]";
    case "regex_validate":
      return "[REGEX_INVALID]";
    case "length_validate":
      return "[LENGTH_INVALID]";
    case "length_range":
      return "[LENGTH_RANGE_INVALID]";
    case "range_validate":
      return "[RANGE_INVALID]";
    case "id_card_transform":
      return "[ID_CARD_INVALID]";
    default:
      return "[INVALID]";
  }
}
