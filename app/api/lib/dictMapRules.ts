import type { UnmatchedStrategy } from "@contracts/types";

/** 码表规则可选参数（未匹配值处理 + 白名单） */
export interface CodeTableRuleOptions {
  unmatchedStrategy?: UnmatchedStrategy;
  customUnmatchedValue?: string;
  whitelist?: string[];
}

/** 从规则 parameters 解析字段级 dictMap（兼容嵌套 { [field]: map } 与扁平 map） */
export function resolveFieldDictMap(
  parameters: Record<string, unknown>,
  field: string
): Record<string, string> {
  const dictMap = parameters.dictMap;
  if (!dictMap || typeof dictMap !== "object") return {};
  const record = dictMap as Record<string, unknown>;
  const nested = record[field];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, string>;
  }
  return record as Record<string, string>;
}

/** 构建码表 standardize 规则 parameters */
export function buildDictMapRuleParameters(
  _field: string,
  dictMap: Record<string, string>,
  options?: CodeTableRuleOptions
): Record<string, unknown> {
  return {
    type: "dictMap",
    dictMap,
    fromCodeTable: true,
    unmatchedStrategy: options?.unmatchedStrategy ?? "keep",
    ...(options?.customUnmatchedValue !== undefined && {
      customUnmatchedValue: options.customUnmatchedValue,
    }),
    ...(options?.whitelist?.length ? { whitelist: options.whitelist } : {}),
  };
}

/** 解析未匹配策略，默认 keep 保持向后兼容 */
export function resolveUnmatchedStrategy(parameters: Record<string, unknown>): UnmatchedStrategy {
  const strategy = parameters.unmatchedStrategy as UnmatchedStrategy | undefined;
  if (strategy === "null" || strategy === "custom" || strategy === "reject" || strategy === "keep") {
    return strategy;
  }
  return "keep";
}

/** 值是否在白名单中（无需映射） */
export function isWhitelistedValue(value: string, whitelist: string[] | undefined): boolean {
  if (!whitelist?.length) return false;
  return whitelist.includes(value);
}

/** 未匹配时的 SQL ELSE 分支表达式 */
export function buildUnmatchedElseSql(
  rawExpr: string,
  strategy: UnmatchedStrategy,
  customValue?: string
): string {
  switch (strategy) {
    case "keep":
      return rawExpr;
    case "null":
      return "NULL";
    case "custom": {
      const escaped = String(customValue ?? "").replace(/'/g, "''");
      return `'${escaped}'`;
    }
    case "reject":
      return "NULL";
    default: {
      const _exhaustive: never = strategy;
      return _exhaustive;
    }
  }
}

/** 未匹配时的文件清洗单元格值 */
export function applyUnmatchedCellValue(
  rawValue: unknown,
  strategy: UnmatchedStrategy,
  customValue?: string
): unknown {
  switch (strategy) {
    case "keep":
      return rawValue;
    case "null":
      return null;
    case "custom":
      return customValue ?? "";
    case "reject":
      return rawValue;
    default: {
      const _exhaustive: never = strategy;
      return _exhaustive;
    }
  }
}

/** 构建 dictMap CASE WHEN SQL */
export function buildDictMapCaseSql(
  expr: string,
  dictMap: Record<string, string>,
  strategy: UnmatchedStrategy,
  whitelist: string[] | undefined,
  customValue?: string
): string {
  const trimmed = `TRIM(${expr})`;
  const cases = Object.entries(dictMap)
    .map(
      ([k, v]) =>
        `WHEN ${trimmed} = '${k.replace(/'/g, "''")}' THEN '${String(v).replace(/'/g, "''")}'`
    )
    .join("\n           ");

  const whitelistChecks =
    whitelist && whitelist.length > 0
      ? whitelist
          .map((w) => `${trimmed} = '${w.replace(/'/g, "''")}'`)
          .join(" OR ")
      : "";

  const elseExpr = buildUnmatchedElseSql(expr, strategy, customValue);
  const nullGuard = `${expr} IS NULL OR ${trimmed} = ''`;

  if (whitelistChecks) {
    return `CASE ${cases}\n           WHEN ${nullGuard} THEN NULL\n           WHEN ${whitelistChecks} THEN ${expr}\n           ELSE ${elseExpr} END`;
  }
  return `CASE ${cases}\n           WHEN ${nullGuard} THEN NULL\n           ELSE ${elseExpr} END`;
}

/** dictMap 未匹配且策略为 reject 时的 SQL WHERE 条件（排除该行） */
export function buildDictMapRejectWhereSql(
  expr: string,
  dictMap: Record<string, string>,
  whitelist: string[] | undefined
): string {
  const trimmed = `TRIM(${expr})`;
  const inKeys = Object.keys(dictMap)
    .map((k) => `'${k.replace(/'/g, "''")}'`)
    .join(", ");
  const whitelistChecks =
    whitelist && whitelist.length > 0
      ? whitelist
          .map((w) => `${trimmed} = '${w.replace(/'/g, "''")}'`)
          .join(" OR ")
      : "";
  const mappedOrEmpty = `${expr} IS NULL OR ${trimmed} = '' OR ${trimmed} IN (${inKeys})`;
  if (whitelistChecks) {
    return `(${mappedOrEmpty} OR ${whitelistChecks})`;
  }
  return mappedOrEmpty;
}
