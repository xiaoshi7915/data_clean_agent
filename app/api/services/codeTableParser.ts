import { readFileSync } from "node:fs";
import path from "node:path";

/** 码表单条映射：源值 → 目标标准值 */
export interface CodeTableEntry {
  field: string;
  sourceValue: string;
  targetValue: string;
}

export interface CodeTableParseResult {
  entries: CodeTableEntry[];
  errors: string[];
}

/** 规范化 CSV 行字段名 */
function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

/** 从表头映射中解析列索引 */
function resolveColumnMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, i) => {
    const key = normalizeHeader(h);
    map[key] = i;
  });
  return map;
}

/** 查找 field / source / target 列索引（兼容中英文表头） */
function resolveCodeTableColumns(map: Record<string, number>): {
  fieldIdx: number;
  sourceIdx: number;
  targetIdx: number;
} | null {
  const fieldIdx =
    map.field ??
    map.字段 ??
    map.column ??
    map.列名 ??
    map.col;
  const sourceIdx =
    map.source_value ??
    map.source ??
    map.源值 ??
    map.原始值 ??
    map.from;
  const targetIdx =
    map.target_value ??
    map.target ??
    map.目标值 ??
    map.标准值 ??
    map.to;

  if (fieldIdx === undefined || sourceIdx === undefined || targetIdx === undefined) {
    return null;
  }
  return { fieldIdx, sourceIdx, targetIdx };
}

/** 解析 CSV 码表文本 */
export function parseCodeTableCsv(content: string): CodeTableParseResult {
  const errors: string[] = [];
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return { entries: [], errors: ["CSV 至少需要表头与一行数据"] };
  }

  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const colMap = resolveColumnMap(headers);
  const cols = resolveCodeTableColumns(colMap);

  if (!cols) {
    return {
      entries: [],
      errors: ["缺少必需列：field/字段、source_value/源值、target_value/目标值"],
    };
  }

  const entries: CodeTableEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const field = cells[cols.fieldIdx]?.trim();
    const sourceValue = cells[cols.sourceIdx]?.trim();
    const targetValue = cells[cols.targetIdx]?.trim();
    if (!field || sourceValue === undefined || targetValue === undefined) {
      errors.push(`第 ${i + 1} 行数据不完整，已跳过`);
      continue;
    }
    entries.push({ field, sourceValue, targetValue });
  }

  return { entries, errors };
}

/** 解析 JSON 码表（数组或 { mappings: [] }） */
export function parseCodeTableJson(content: string): CodeTableParseResult {
  const errors: string[] = [];
  try {
    const parsed = JSON.parse(content) as unknown;
    const rows = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && "mappings" in parsed
      ? (parsed as { mappings: unknown[] }).mappings
      : null;

    if (!rows || !Array.isArray(rows)) {
      return { entries: [], errors: ["JSON 需为数组或 { mappings: [] } 结构"] };
    }

    const entries: CodeTableEntry[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as Record<string, unknown>;
      const field = String(row.field ?? row.字段 ?? "").trim();
      const sourceValue = String(
        row.source_value ?? row.sourceValue ?? row.源值 ?? row.source ?? ""
      ).trim();
      const targetValue = String(
        row.target_value ?? row.targetValue ?? row.目标值 ?? row.target ?? ""
      ).trim();
      if (!field || !sourceValue || !targetValue) {
        errors.push(`第 ${i + 1} 条映射字段不完整，已跳过`);
        continue;
      }
      entries.push({ field, sourceValue, targetValue });
    }
    return { entries, errors };
  } catch {
    return { entries: [], errors: ["JSON 解析失败"] };
  }
}

/** 根据文件扩展名自动选择解析器 */
export function parseCodeTableFile(filePath: string): CodeTableParseResult {
  const ext = path.extname(filePath).toLowerCase();
  const content = readFileSync(filePath, "utf8");
  if (ext === ".json") return parseCodeTableJson(content);
  return parseCodeTableCsv(content);
}

/** 将码表条目转为 standardize 规则的 dictMap 参数 */
export function codeTableToDictMap(
  entries: CodeTableEntry[]
): Record<string, Record<string, string>> {
  const byField: Record<string, Record<string, string>> = {};
  for (const entry of entries) {
    if (!byField[entry.field]) byField[entry.field] = {};
    byField[entry.field][entry.sourceValue] = entry.targetValue;
  }
  return byField;
}

/** 码表规则可选参数（未匹配值处理 + 白名单） */
export interface CodeTableRuleOptions {
  unmatchedStrategy?: "keep" | "null" | "custom" | "reject";
  customUnmatchedValue?: string;
  whitelist?: string[];
}

/** 构建码表 standardize 规则 parameters */
export function buildCodeTableRuleParameters(
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
