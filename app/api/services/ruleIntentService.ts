import { eq, and } from "drizzle-orm";
import { fieldMatchesAlias, getCanonicalFieldKey } from "@contracts/naturalLanguageAliases";
import { getDb } from "../queries/connection";
import { cleaningRules } from "@db/schema";
import type { CleaningRule, RuleStatus, RuleUpdateIntent } from "@contracts/types";
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
  const fillMatch = text.match(/(?:填成|填充为|替换为|改成|换成)\s*([^\s，。；]+)/);
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

/** 按字段名模糊匹配规则（精确 → 别名 → 包含） */
export function findRuleByField(rules: CleaningRule[], field: string): CleaningRule | undefined {
  const target = normalizeFieldName(field);
  if (!target) return undefined;

  const exact = rules.find((r) => normalizeFieldName(r.field) === target);
  if (exact) return exact;

  const canonical = getCanonicalFieldKey(field);
  if (canonical) {
    const aliasMatch = rules.find((r) => fieldMatchesAlias(canonical, r.field));
    if (aliasMatch) return aliasMatch;
  }

  const aliasDirect = rules.find((r) => fieldMatchesAlias(field, r.field));
  if (aliasDirect) return aliasDirect;

  const partial = rules.find(
    (r) =>
      normalizeFieldName(r.field).includes(target) ||
      target.includes(normalizeFieldName(r.field))
  );
  return partial;
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
    .where(and(eq(cleaningRules.sessionId, sessionId), eq(cleaningRules.ruleId, ruleId)));
}

function mergeVariantSelection(
  rule: CleaningRule,
  variantKey?: string,
  fillValue?: string | number
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

  if (effectiveKey && variants?.length) {
    const selected = variants.find((v) => v.key === effectiveKey) || variants[0];
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
    if (variants?.length) {
      parameters.variants = variants;
    }
    return {
      parameters,
      action: "fill_null",
      strategy: `使用固定值填充「${rule.field}」空值`,
      name: `空值填充(固定值) - ${rule.field}`,
      riskNote: isSqlExpressionFillValue(fillValue)
        ? "将使用数据库当前时间函数填充空值"
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
    }
  }

  const rulesById = new Map(existingRules.map((r) => [r.id, { ...r }]));

  for (const rawUpdate of effectiveUpdates) {
    const update = normalizeRuleUpdateIntent(rawUpdate);
    const rule = findRuleByField(existingRules, update.field);
    if (!rule) {
      errors.push(`未找到字段「${update.field}」对应的清洗规则`);
      continue;
    }

    const status = parseStatusAction(update.action);
    const merged = mergeVariantSelection(rule, update.variantKey, update.fillValue);
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
  const rows = await db
    .select()
    .from(cleaningRules)
    .where(eq(cleaningRules.sessionId, sessionId))
    .orderBy(cleaningRules.ruleIndex);

  return {
    applied,
    summaries,
    errors,
    updatedRules: rows.map(toCleaningRule),
  };
}
