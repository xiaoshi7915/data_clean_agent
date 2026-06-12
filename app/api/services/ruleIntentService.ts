import { eq, and } from "drizzle-orm";
import { fieldMatchesAlias, getCanonicalFieldKey } from "@contracts/naturalLanguageAliases";
import { getDb } from "../queries/connection";
import { cleaningRules } from "@db/schema";
import { getCurrentRunIndex } from "./pipelineRunService";
import type { CleaningAction, CleaningRule, RuleStatus, RuleUpdateIntent } from "@contracts/types";
import type { RuleVariantOption } from "./analysisService";

const BULK_ALL_FIELDS_PATTERNS = [
  /所有字段/,
  /全部字段/,
  /每个字段/,
  /所有列/,
  /全部列/,
  /every\s*field/i,
  /all\s*fields/i,
];

const NULL_FILL_PATTERNS = [/null/i, /空值/, /空缺/, /缺失/, /为空/, /替换成?\s*null/i];

/** NL 中表示「写入/填充固定值」的动词（含「补充为」） */
const FILL_VALUE_VERB_PATTERN =
  "(?:替换为|填成|填充为|补充为|补全为|补充|补全|换成|改为|设置为)";

const REPLACE_ALL_PATTERNS = [
  /都(?:替换|换|改|设置|补充|填|填充)/,
  /(?:值|字段|列)(?:替换|换|改|补充)/,
];

/** 用户是否要求对所有字段做统一空值处理 */
export function isBulkAllFieldsIntent(message: string): boolean {
  const text = message.trim();
  const wantsAll = BULK_ALL_FIELDS_PATTERNS.some((p) => p.test(text));
  const wantsNull = NULL_FILL_PATTERNS.some((p) => p.test(text));
  return wantsAll && wantsNull;
}

/** 从自然语言提取填充值（默认 NULL） */
export function extractFillValueFromMessage(message: string): string | number {
  const text = message.trim();
  if (/null/i.test(text) || /空值/.test(text)) return "NULL";
  const quoted = text.match(/[「『"']([^」』"']+)[」』"']/);
  if (quoted?.[1]) return normalizeFillValue(quoted[1]);
  const fillMatch = text.match(new RegExp(`${FILL_VALUE_VERB_PATTERN}\\s*([^\\s，。；]+)`));
  if (fillMatch?.[1]) return normalizeFillValue(fillMatch[1]);
  return "NULL";
}

function ruleSupportsNullFill(rule: CleaningRule): boolean {
  if (rule.field === "*") return false;
  const variants = rule.parameters.variants as RuleVariantOption[] | undefined;
  if (variants?.some((v) => v.action === "fill_null")) return true;
  if (rule.action === "fill_null") return true;
  if (rule.parameters.issueCategory === "空值过多") return true;
  if (rule.parameters.issueCategory === "占位符空值") return true;
  return false;
}

/** 将「所有字段空值→NULL」类意图展开为逐字段 ruleUpdates */
export function expandBulkRuleUpdatesFromMessage(
  message: string,
  rules: CleaningRule[]
): RuleUpdateIntent[] | undefined {
  if (!isBulkAllFieldsIntent(message)) return undefined;

  const fillValue = extractFillValueFromMessage(message);
  const eligible = rules.filter(ruleSupportsNullFill);
  if (eligible.length === 0) return undefined;

  return eligible.map((rule) => ({
    field: rule.field,
    variantKey: "fixed",
    fillValue,
  }));
}

export interface RuleUpdateApplyResult {
  applied: number;
  summaries: string[];
  errors: string[];
  updatedRules: CleaningRule[];
}

const CURRENT_TIME_PATTERNS = [
  "当前时间",
  "现在时间",
  "此刻",
  "现在",
  "today",
  "now",
  "now()",
  "current_timestamp",
  "current time",
  "current date",
  "current_time",
  "current_date",
];

const SQL_EXPRESSION_VALUES = new Set([
  "NOW()",
  "CURRENT_TIMESTAMP",
  "CURRENT_DATE",
  "CURRENT_TIME",
]);

function normalizeFieldName(name: string): string {
  return name.toLowerCase().replace(/[\s_-]+/g, "");
}

function ruleHasFixedFillVariant(rule: CleaningRule): boolean {
  const variants = rule.parameters.variants as RuleVariantOption[] | undefined;
  return Boolean(variants?.some((v) => v.key === "fixed" && v.action === "fill_null"));
}

/** 收集与字段名匹配的全部规则（精确 → 别名 → 包含） */
function findAllRulesByField(rules: CleaningRule[], field: string): CleaningRule[] {
  const target = normalizeFieldName(field);
  if (!target) return [];

  const exact = rules.filter((r) => normalizeFieldName(r.field) === target);
  if (exact.length > 0) return exact;

  const canonical = getCanonicalFieldKey(field);
  if (canonical) {
    const aliasMatches = rules.filter((r) => fieldMatchesAlias(canonical, r.field));
    if (aliasMatches.length > 0) return aliasMatches;
  }

  const aliasDirect = rules.filter((r) => fieldMatchesAlias(field, r.field));
  if (aliasDirect.length > 0) return aliasDirect;

  return rules.filter(
    (r) =>
      normalizeFieldName(r.field).includes(target) ||
      target.includes(normalizeFieldName(r.field))
  );
}

function pickPreferredFillRule(matches: CleaningRule[]): CleaningRule | undefined {
  if (matches.length === 0) return undefined;
  const fillNull = matches.find((r) => r.action === "fill_null");
  if (fillNull) return fillNull;
  const withFixed = matches.find(ruleHasFixedFillVariant);
  if (withFixed) return withFixed;
  const nullFillCapable = matches.find(ruleSupportsNullFill);
  if (nullFillCapable) return nullFillCapable;
  return matches[0];
}

/** 按字段名模糊匹配规则（精确 → 别名 → 包含） */
export function findRuleByField(
  rules: CleaningRule[],
  field: string,
  options?: { preferFillNull?: boolean }
): CleaningRule | undefined {
  const matches = findAllRulesByField(rules, field);
  if (matches.length === 0) return undefined;
  if (options?.preferFillNull) {
    return pickPreferredFillRule(matches);
  }
  return matches[0];
}

/** 将自然语言填充值规范化为可持久化 / 生成 SQL 的值 */
export function normalizeFillValue(raw: string | number | Record<string, unknown>): string | number {
  if (typeof raw === "number") return raw;
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    if (record.type === "expression" && typeof record.value === "string") {
      return normalizeFillValue(record.value);
    }
  }

  const text = String(raw).trim();
  if (!text) return text;

  if (text.toUpperCase() === "NULL") return "NULL";

  const lower = text.toLowerCase();
  if (CURRENT_TIME_PATTERNS.some((p) => lower === p.toLowerCase() || text === p)) {
    return "NOW()";
  }
  if (SQL_EXPRESSION_VALUES.has(text.toUpperCase())) {
    return text.toUpperCase() === "CURRENT_TIMESTAMP" ? "NOW()" : text.toUpperCase();
  }
  return text;
}

export function isSqlExpressionFillValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const upper = value.toUpperCase();
  return SQL_EXPRESSION_VALUES.has(upper) || upper === "NOW()";
}

/** 预处理 LLM 返回的规则修改意图 */
export function normalizeRuleUpdateIntent(update: RuleUpdateIntent): RuleUpdateIntent {
  const normalized: RuleUpdateIntent = { ...update, field: update.field.trim() };

  if (update.addDerivedColumn?.trim()) {
    normalized.addDerivedColumn = update.addDerivedColumn.trim();
    if (update.insertAfter?.trim()) {
      normalized.insertAfter = update.insertAfter.trim();
    } else if (!normalized.insertAfter) {
      normalized.insertAfter = normalized.field;
    }
    return normalized;
  }

  if (update.fillValue !== undefined && update.fillValue !== null) {
    normalized.fillValue = normalizeFillValue(
      update.fillValue as string | number | Record<string, unknown>
    );
  }

  if (normalized.fillValue !== undefined && !normalized.variantKey) {
    normalized.variantKey = "fixed";
  }

  return normalized;
}

function parseStatusAction(action?: string): RuleStatus | undefined {
  if (!action) return undefined;
  const normalized = action.toLowerCase();
  if (["confirm", "confirmed", "confirmrule"].includes(normalized)) return "confirmed";
  if (["skip", "skipped", "skiprule"].includes(normalized)) return "skipped";
  return undefined;
}

async function persistRuleUpdate(
  sessionId: string,
  ruleId: string,
  updates: {
    status?: RuleStatus;
    parameters?: Record<string, unknown>;
    action?: string;
    strategy?: string;
    name?: string;
    riskNote?: string;
  }
): Promise<void> {
  const db = getDb();
  const runIndex = await getCurrentRunIndex(sessionId);
  const setPayload: Record<string, unknown> = {};

  if (updates.status) setPayload.status = updates.status;
  if (updates.parameters) setPayload.parameters = updates.parameters;
  if (updates.action) setPayload.action = updates.action;
  if (updates.strategy) setPayload.strategy = updates.strategy;
  if (updates.name) setPayload.name = updates.name;
  if (updates.riskNote !== undefined) setPayload.riskNote = updates.riskNote;

  if (Object.keys(setPayload).length === 0) return;

  await db
    .update(cleaningRules)
    .set(setPayload)
    .where(
      and(
        eq(cleaningRules.sessionId, sessionId),
        eq(cleaningRules.runIndex, runIndex),
        eq(cleaningRules.ruleId, ruleId)
      )
    );
}

function mergeVariantSelection(
  rule: CleaningRule,
  variantKey?: string,
  fillValue?: string | number,
  replaceAll?: boolean
): {
  parameters: Record<string, unknown>;
  action?: string;
  strategy?: string;
  name?: string;
  riskNote?: string;
} {
  const parameters = { ...rule.parameters };
  const variants = parameters.variants as RuleVariantOption[] | undefined;
  const effectiveKey = variantKey || (fillValue !== undefined ? "fixed" : undefined);

  if (fillValue !== undefined) {
    const fixedVariant = variants?.find((v) => v.key === "fixed");
    if (fixedVariant) {
      Object.assign(parameters, fixedVariant.parameters);
      parameters.selectedVariant = "fixed";
      parameters.variants = variants;
      parameters.fillValue = fillValue;
      parameters.strategy = "fixed";
      if (replaceAll) {
        parameters.replaceAll = true;
      }
      return {
        parameters,
        action: fixedVariant.action,
        strategy: replaceAll
          ? `将「${rule.field}」整列设为固定值`
          : fixedVariant.strategy,
        name: replaceAll ? `整列赋值 - ${rule.field}` : fixedVariant.name,
        riskNote: isSqlExpressionFillValue(fillValue)
          ? "将使用数据库当前时间函数填充"
          : fixedVariant.riskNote ?? rule.riskNote,
      };
    }
  }

  if (effectiveKey && variants?.length) {
    const selected = variants.find((v) => v.key === effectiveKey);
    if (selected) {
      Object.assign(parameters, selected.parameters);
      parameters.selectedVariant = selected.key;
      parameters.variants = variants;
      if (fillValue !== undefined) {
        parameters.fillValue = fillValue;
        parameters.strategy = "fixed";
      }
      return {
        parameters,
        action: selected.action,
        strategy: selected.strategy,
        name: selected.name,
        riskNote: selected.riskNote,
      };
    }
  }

  if (fillValue !== undefined) {
    parameters.fillValue = fillValue;
    parameters.strategy = "fixed";
    parameters.selectedVariant = "fixed";
    if (replaceAll) {
      parameters.replaceAll = true;
    }
    if (variants?.length) {
      parameters.variants = variants;
    }
    if (rule.action === "standardize" && replaceAll) {
      parameters.type = "constant_replace";
    }
    return {
      parameters,
      action: "fill_null",
      strategy: replaceAll
        ? `将「${rule.field}」整列设为固定值`
        : `使用固定值填充「${rule.field}」空值`,
      name: replaceAll ? `整列赋值 - ${rule.field}` : `空值填充(固定值) - ${rule.field}`,
      riskNote: isSqlExpressionFillValue(fillValue)
        ? "将使用数据库当前时间函数填充"
        : rule.riskNote,
    };
  }

  if (effectiveKey === "fixed") {
    parameters.strategy = "fixed";
    parameters.selectedVariant = "fixed";
    return {
      parameters,
      action: "fill_null",
      strategy: `使用固定值填充「${rule.field}」空值`,
      name: `空值填充(固定值) - ${rule.field}`,
    };
  }

  return { parameters };
}

function toCleaningRule(row: typeof cleaningRules.$inferSelect): CleaningRule {
  return {
    id: row.ruleId,
    index: row.ruleIndex,
    name: row.name,
    field: row.field,
    action: row.action as CleaningRule["action"],
    issueDescription: row.issueDescription || undefined,
    strategy: row.strategy || undefined,
    affectedRows: row.affectedRows,
    affectedPercent: parseFloat(row.affectedPercent || "0"),
    parameters: (row.parameters as Record<string, unknown>) || {},
    status: row.status as RuleStatus,
    preview: row.preview as CleaningRule["preview"],
    riskNote: row.riskNote || undefined,
  };
}

const DERIVED_COLUMN_SUFFIXES = ["_code", "_id", "_name", "_text", "_num", "_no"];

/** 从衍生列名推断源字段（如 level_code → level） */
export function inferSourceFieldFromDerivedColumn(targetColumn: string): string | undefined {
  const lower = targetColumn.toLowerCase();
  for (const suffix of DERIVED_COLUMN_SUFFIXES) {
    if (lower.endsWith(suffix) && targetColumn.length > suffix.length) {
      return targetColumn.slice(0, -suffix.length);
    }
  }
  return undefined;
}

/** 解析「新增衍生列 / 映射列」类自然语言意图 */
export function extractAddDerivedColumnFromMessage(
  message: string,
  _rules: CleaningRule[]
): RuleUpdateIntent[] | undefined {
  const text = message.trim();
  if (!text) return undefined;

  const hasAddKeyword = /(?:新增|添加|增加|add|create)/i.test(text);
  const hasColumnKeyword = /(?:字段|列|column|field)/i.test(text);
  const hasAfterPattern = /在\s*[a-zA-Z_][\w]*\s*(?:字段|列)?\s*后/i.test(text);
  if (!hasAfterPattern && !(hasAddKeyword && hasColumnKeyword)) return undefined;

  const patternAfterFirst =
    /在\s*([a-zA-Z_][\w]*)\s*(?:字段|列)?\s*后\s*(?:新增|添加|增加)(?:一个)?\s*([a-zA-Z_][\w]*)\s*(?:字段|列)?(?:\s*作为\s*([a-zA-Z_][\w]*)\s*(?:字段|列)?(?:的)?映射)?/i;
  const matchAfterFirst = text.match(patternAfterFirst);
  if (matchAfterFirst) {
    const insertAfter = matchAfterFirst[1].trim();
    const targetColumn = matchAfterFirst[2].trim();
    const sourceField = (matchAfterFirst[3] || insertAfter).trim();
    if (targetColumn && sourceField && targetColumn.toLowerCase() !== sourceField.toLowerCase()) {
      return [{ field: sourceField, addDerivedColumn: targetColumn, insertAfter }];
    }
  }

  const patternAddFirst =
    /(?:帮我)?(?:请)?(?:新增|添加|增加)(?:一个)?\s*([a-zA-Z_][\w]*)\s*(?:字段|列)?\s*(?:作为\s*([a-zA-Z_][\w]*)\s*(?:字段|列)?(?:的)?映射)?(?:\s*在\s*([a-zA-Z_][\w]*)\s*(?:字段|列)?\s*后)?/i;
  const matchAddFirst = text.match(patternAddFirst);
  if (matchAddFirst) {
    const targetColumn = matchAddFirst[1].trim();
    const sourceField = (
      matchAddFirst[2] ||
      matchAddFirst[3] ||
      inferSourceFieldFromDerivedColumn(targetColumn)
    )?.trim();
    const insertAfter = (matchAddFirst[3] || sourceField)?.trim();
    if (targetColumn && sourceField && targetColumn.toLowerCase() !== sourceField.toLowerCase()) {
      return [{ field: sourceField, addDerivedColumn: targetColumn, insertAfter }];
    }
  }

  return undefined;
}

async function insertDerivedColumnRule(
  sessionId: string,
  update: RuleUpdateIntent,
  existingRules: CleaningRule[]
): Promise<CleaningRule | null> {
  const targetColumn = update.addDerivedColumn?.trim();
  const sourceField = update.field.trim();
  if (!targetColumn || !sourceField) return null;

  const duplicate = existingRules.some(
    (r) =>
      r.field.toLowerCase() === targetColumn.toLowerCase() ||
      String(r.parameters.targetColumn ?? "").toLowerCase() === targetColumn.toLowerCase()
  );
  if (duplicate) return null;

  const db = getDb();
  const runIndex = await getCurrentRunIndex(sessionId);
  const sourceRule = findRuleByField(existingRules, sourceField);
  const insertAfter = update.insertAfter?.trim() || sourceField;
  const nextIndex =
    existingRules.length > 0 ? Math.max(...existingRules.map((r) => r.index)) + 1 : 1;
  const ruleId = `derived_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const strategy = `在「${insertAfter}」后新增「${targetColumn}」，由「${sourceField}」映射生成`;
  const parameters: Record<string, unknown> = {
    targetColumn,
    part: "derived_mapping",
    sourceField,
    insertAfter,
    isCustom: true,
    fromNaturalLanguage: true,
  };

  await db.insert(cleaningRules).values({
    sessionId,
    runIndex,
    ruleId,
    ruleIndex: nextIndex,
    name: `衍生列 - ${targetColumn}（映射 ${sourceField}）`,
    field: sourceField,
    action: "split" as CleaningAction,
    issueDescription: strategy,
    strategy,
    affectedRows: sourceRule?.affectedRows ?? 0,
    affectedPercent: String(sourceRule?.affectedPercent ?? 0),
    parameters,
    status: "confirmed",
    riskNote: "对话新增的衍生列已自动确认，可直接生成 SQL",
  });

  return {
    id: ruleId,
    index: nextIndex,
    name: `衍生列 - ${targetColumn}（映射 ${sourceField}）`,
    field: sourceField,
    action: "split",
    issueDescription: strategy,
    strategy,
    affectedRows: sourceRule?.affectedRows ?? 0,
    affectedPercent: sourceRule?.affectedPercent ?? 0,
    parameters,
    status: "confirmed",
    riskNote: "对话新增的衍生列已自动确认，可直接生成 SQL",
  };
}

/** 从单条 NL 消息推断字段级规则修改（LLM 未返回 ruleUpdates 时的兜底） */
export function extractRuleUpdatesFromMessage(
  message: string,
  rules: CleaningRule[]
): RuleUpdateIntent[] | undefined {
  const text = message.trim();
  if (!text) return undefined;

  const derived = extractAddDerivedColumnFromMessage(text, rules);
  if (derived?.length) return derived;

  if (rules.length === 0) return undefined;

  const bulk = expandBulkRuleUpdatesFromMessage(text, rules);
  if (bulk?.length) return bulk;

  const replacePatterns = [
    new RegExp(
      `(?:帮(?:我|忙)?)?(?:把|将)\\s*([a-zA-Z_][\\w]*)\\s*(?:字段|列)?(?:的(?:值|空值)?)?(?:都)?${FILL_VALUE_VERB_PATTERN}\\s*(.+?)(?:[。；，!！?？]|$)`
    ),
    new RegExp(
      `([a-zA-Z_][\\w]*)\\s*(?:字段|列)?(?:的(?:值|空值)?)?(?:都)?${FILL_VALUE_VERB_PATTERN}\\s*(.+?)(?:[。；，!！?？]|$)`
    ),
  ];

  for (const pattern of replacePatterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const field = match[1].trim();
    const rawValue = match[2].trim();
    if (!field || !rawValue) continue;

    const rule = findRuleByField(rules, field, { preferFillNull: true });
    if (!rule) continue;

    const fillValue = normalizeFillValue(rawValue);
    const replaceAll =
      REPLACE_ALL_PATTERNS.some((p) => p.test(text)) ||
      (/都/.test(text) && /补充|补全/.test(text));

    return [
      {
        field: rule.field,
        variantKey: "fixed",
        fillValue,
        replaceAll,
      },
    ];
  }

  return undefined;
}

/**
 * 将 LLM 解析出的 ruleUpdates 应用到会话规则（模糊匹配字段名）
 */
export async function applyRuleUpdatesFromNL(
  sessionId: string,
  updates: RuleUpdateIntent[],
  existingRules: CleaningRule[],
  options?: { sourceMessage?: string }
): Promise<RuleUpdateApplyResult> {
  const summaries: string[] = [];
  const errors: string[] = [];
  let applied = 0;

  let effectiveUpdates = updates;
  if (options?.sourceMessage && isBulkAllFieldsIntent(options.sourceMessage)) {
    const expanded = expandBulkRuleUpdatesFromMessage(options.sourceMessage, existingRules);
    if (expanded?.length) {
      effectiveUpdates = expanded;
    }
  } else if (effectiveUpdates.length === 0 && options?.sourceMessage) {
    const expanded = expandBulkRuleUpdatesFromMessage(options.sourceMessage, existingRules);
    if (expanded?.length) {
      effectiveUpdates = expanded;
    } else {
      const inferred = extractRuleUpdatesFromMessage(options.sourceMessage, existingRules);
      if (inferred?.length) {
        effectiveUpdates = inferred;
      }
    }
  }

  const rulesById = new Map(existingRules.map((r) => [r.id, { ...r }]));

  for (const rawUpdate of effectiveUpdates) {
    const update = normalizeRuleUpdateIntent(rawUpdate);

    if (update.addDerivedColumn) {
      try {
        const inserted = await insertDerivedColumnRule(
          sessionId,
          update,
          Array.from(rulesById.values())
        );
        if (inserted) {
          rulesById.set(inserted.id, inserted);
          summaries.push(
            `新增衍生列「${update.addDerivedColumn}」（映射源字段「${update.field}」），已自动确认，可直接生成 SQL`
          );
          applied += 1;
        } else {
          errors.push(`衍生列「${update.addDerivedColumn}」已存在或无法创建`);
        }
      } catch (err) {
        errors.push(
          `新增衍生列「${update.addDerivedColumn}」失败：${err instanceof Error ? err.message : String(err)}`
        );
      }
      continue;
    }

    const rule = findRuleByField(existingRules, update.field, {
      preferFillNull: update.fillValue !== undefined,
    });
    if (!rule) {
      errors.push(`未找到字段「${update.field}」对应的清洗规则`);
      continue;
    }

    const status = parseStatusAction(update.action);
    const merged = mergeVariantSelection(
      rule,
      update.variantKey,
      update.fillValue,
      update.replaceAll
    );
    const working = rulesById.get(rule.id) || rule;

    try {
      await persistRuleUpdate(sessionId, rule.id, {
        status,
        ...merged,
      });

      const nextRule: CleaningRule = {
        ...working,
        ...(status ? { status } : {}),
        parameters: merged.parameters,
        ...(merged.action ? { action: merged.action as CleaningRule["action"] } : {}),
        ...(merged.strategy ? { strategy: merged.strategy } : {}),
        ...(merged.name ? { name: merged.name } : {}),
        ...(merged.riskNote !== undefined ? { riskNote: merged.riskNote } : {}),
      };
      rulesById.set(rule.id, nextRule);

      const parts: string[] = [`「${rule.field}」`];
      if (update.fillValue !== undefined) {
        const rawFill = merged.parameters.fillValue ?? update.fillValue;
        const display = isSqlExpressionFillValue(rawFill)
          ? "当前时间 (NOW())"
          : String(rawFill).toUpperCase() === "NULL"
            ? "NULL"
            : String(rawFill);
        parts.push(`填充值改为「${display}」`);
      }
      if (update.variantKey || merged.action === "fill_null") {
        parts.push(`策略改为「${merged.parameters.selectedVariant || update.variantKey || "fixed"}」`);
      }
      if (status === "confirmed") parts.push("已确认");
      if (status === "skipped") parts.push("已跳过");
      summaries.push(parts.join("："));
      applied += 1;
    } catch (err) {
      errors.push(
        `更新「${update.field}」失败：${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const db = getDb();
  const runIndex = await getCurrentRunIndex(sessionId);
  const rows = await db
    .select()
    .from(cleaningRules)
    .where(and(eq(cleaningRules.sessionId, sessionId), eq(cleaningRules.runIndex, runIndex)))
    .orderBy(cleaningRules.ruleIndex);

  return {
    applied,
    summaries,
    errors,
    updatedRules: rows.map(toCleaningRule),
  };
}
