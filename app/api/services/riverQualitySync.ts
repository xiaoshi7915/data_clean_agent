import type { CleaningRule } from "@contracts/types";

/** River 质量 JSON 单条规则（简化） */
export interface RiverQualityRule {
  field?: string;
  column?: string;
  ruleType?: string;
  type?: string;
  parameters?: Record<string, unknown>;
  name?: string;
}

/**
 * River 质量规则同步（P2-R2 MVP stub）
 * 将外部质量 JSON 转为 cleaning_rules 参数结构。
 */
export function parseRiverQualityJson(content: string): {
  rules: Array<{ field: string; action: CleaningRule["action"]; parameters: Record<string, unknown>; name: string }>;
  errors: string[];
} {
  const errors: string[] = [];
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const items = (parsed.rules ?? parsed.items ?? parsed) as RiverQualityRule[];
    if (!Array.isArray(items)) {
      return { rules: [], errors: ["River JSON 需包含 rules 数组"] };
    }

    const rules = items
      .map((item, i) => {
        const field = String(item.field ?? item.column ?? "").trim();
        if (!field) {
          errors.push(`第 ${i + 1} 条缺少 field`);
          return null;
        }
        const ruleType = String(item.ruleType ?? item.type ?? "standardize");
        const action = mapRiverAction(ruleType);
        return {
          field,
          action,
          name: item.name ?? `River规则：${field}`,
          parameters: { ...(item.parameters ?? {}), fromRiver: true, riverRuleType: ruleType },
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    return { rules, errors };
  } catch {
    return { rules: [], errors: ["River JSON 解析失败"] };
  }
}

function mapRiverAction(ruleType: string): CleaningRule["action"] {
  const lower = ruleType.toLowerCase();
  if (lower.includes("format") || lower.includes("trim")) return "format";
  if (lower.includes("dedup")) return "dedup";
  if (lower.includes("remove") || lower.includes("filter")) return "remove";
  return "standardize";
}
