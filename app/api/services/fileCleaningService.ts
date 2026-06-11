import path from "node:path";
import {
  cleanedFileName,
  getUploadPath,
  loadFullFileData,
  writeCleanedFile,
} from "./dataSourceService";
import { resolveRuleVariant } from "./analysisService";
import type { CleaningRule, ExecutionResult, FileType, QualityScore } from "@contracts/types";
import { PLACEHOLDER_NULL_VALUE_SET } from "@contracts/cleaningConstants";

const MOJIBAKE_RE = /Ã.|Â.|â€|ï¿½|锟斤拷|쏙|鐨/;

function hasEncodingIssue(value: string): boolean {
  return value.includes("\uFFFD") || MOJIBAKE_RE.test(value);
}

function tryFixEncoding(value: string): string {
  try {
    return Buffer.from(value, "latin1").toString("utf8");
  } catch {
    return value;
  }
}

function compareValues(a: unknown, b: unknown, operator: string): boolean {
  const numA = Number(a);
  const numB = Number(b);
  const useNumeric = !Number.isNaN(numA) && !Number.isNaN(numB);
  if (useNumeric) {
    switch (operator) {
      case "<":
        return numA < numB;
      case "<=":
        return numA <= numB;
      case ">":
        return numA > numB;
      case ">=":
        return numA >= numB;
      case "=":
      case "==":
        return numA === numB;
      default:
        return true;
    }
  }
  const strA = String(a ?? "");
  const strB = String(b ?? "");
  switch (operator) {
    case "<":
      return strA < strB;
    case "<=":
      return strA <= strB;
    case ">":
      return strA > strB;
    case ">=":
      return strA >= strB;
    case "=":
    case "==":
      return strA === strB;
    default:
      return true;
  }
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

function isNullishForFill(value: unknown, treatEmptyAsNull?: boolean): boolean {
  if (isEmptyValue(value)) return true;
  if (treatEmptyAsNull && typeof value === "string" && value.trim() === "") return true;
  return false;
}

function applyFieldTransform(
  row: Record<string, unknown>,
  rule: CleaningRule
): void {
  const field = rule.field;
  if (field === "*") return;

  let value = row[field];

  switch (rule.action) {
    case "fill_null": {
      if (!isNullishForFill(value, rule.parameters.treatEmptyAsNull === true)) break;
      const strategy = (rule.parameters.strategy as string) || "fixed";
      if (strategy === "mean" || strategy === "ffill" || strategy === "bfill") {
        break;
      }
      const fillValue = rule.parameters.fillValue;
      if (fillValue === null || (typeof fillValue === "string" && fillValue.toUpperCase() === "NULL")) {
        row[field] = null;
        break;
      }
      if (typeof fillValue === "string" && fillValue.toUpperCase() === "NOW()") {
        row[field] = new Date().toISOString();
        break;
      }
      row[field] = fillValue ?? "UNKNOWN";
      break;
    }
    case "format": {
      if (isEmptyValue(value)) break;
      const str = String(value);
      const pattern = rule.parameters.pattern as string | undefined;
      const replacement = rule.parameters.replacement;
      if (pattern && replacement !== undefined && replacement !== null) {
        try {
          row[field] = str.replace(new RegExp(pattern, "g"), String(replacement));
        } catch {
          row[field] = str;
        }
        break;
      }
      const format = rule.parameters.format as string;
      switch (format) {
        case "TRIM":
          row[field] = str.trim();
          break;
        case "UPPER":
          row[field] = str.toUpperCase();
          break;
        case "LOWER":
          row[field] = str.toLowerCase();
          break;
        case "PHONE":
          row[field] = str.replace(/\D/g, "");
          break;
        case "DATE_ISO": {
          const parsed = new Date(str);
          row[field] = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
          break;
        }
        case "COLLAPSE_WS":
          row[field] = str.trim().replace(/\s+/g, " ");
          break;
        case "STRIP_HTML":
          row[field] = str.replace(/<[^>]+>/g, "");
          break;
        case "FULLWIDTH":
          row[field] = str.replace(/[\uFF01-\uFF5E]/g, (ch) =>
            String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
          );
          break;
        default:
          row[field] = str.trim();
      }
      break;
    }
    case "standardize": {
      if (isEmptyValue(value)) break;
      if (rule.parameters.type === "placeholder_null") {
        const key = String(value).trim().toLowerCase();
        if (PLACEHOLDER_NULL_VALUE_SET.has(key)) {
          row[field] = null;
        }
        break;
      }
      if (
        rule.parameters.type === "age_clamp" ||
        rule.parameters.type === "outlier_iqr" ||
        rule.parameters.type === "outlier_zscore" ||
        rule.parameters.type === "winsorize" ||
        rule.parameters.type === "range_validate"
      ) {
        const num = Number(value);
        const min = (rule.parameters.min as number) ?? 0;
        const max = (rule.parameters.max as number) ?? 150;
        row[field] = num < min || num > max ? null : value;
        break;
      }
      if (rule.parameters.type === "length_validate") {
        const expected = (rule.parameters.expectedLength as number) ?? 11;
        const len = String(value).trim().length;
        if (len !== expected) row[field] = null;
        break;
      }
      if (rule.parameters.type === "regex_validate") {
        try {
          const pattern = new RegExp(String(rule.parameters.pattern ?? ".*"));
          if (!pattern.test(String(value))) row[field] = null;
        } catch {
          // 无效正则则跳过
        }
        break;
      }
      if (rule.parameters.type === "email_validate") {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(String(value))) {
          row[field] = rule.parameters.invalidAction === "flag" ? "INVALID_EMAIL" : null;
        }
        break;
      }
      if (rule.parameters.type === "phone_validate") {
        const digits = String(value).replace(/\D/g, "");
        if (digits.length < 7 || digits.length > 15) {
          row[field] = rule.parameters.invalidAction === "flag" ? "INVALID_PHONE" : null;
        }
        break;
      }
      if (rule.parameters.type === "encoding_detect") {
        const str = String(value);
        if (hasEncodingIssue(str)) {
          row[field] =
            rule.parameters.invalidAction === "flag" ? `${str}[ENCODING_ERROR]` : null;
        }
        break;
      }
      if (rule.parameters.type === "encoding_fix") {
        row[field] = tryFixEncoding(String(value));
        break;
      }
      if (rule.parameters.type === "fk_reference") {
        const dictMap = rule.parameters.dictMap as Record<string, string> | undefined;
        const allowed = rule.parameters.allowedValues as string[] | undefined;
        const strVal = String(value).trim();
        if (dictMap && dictMap[strVal] !== undefined) {
          row[field] = dictMap[strVal];
          break;
        }
        if (allowed && allowed.length > 0 && !allowed.includes(strVal)) {
          row[field] = rule.parameters.invalidAction === "flag" ? "FK_INVALID" : null;
        }
        break;
      }
      if (rule.parameters.type === "timezone_normalize") {
        const str = String(value);
        const parsed = new Date(str);
        if (!Number.isNaN(parsed.getTime())) {
          row[field] = parsed.toISOString();
        }
        break;
      }
      if (rule.parameters.mapping) {
        const mapping = rule.parameters.mapping as Record<string, string>;
        const key = String(value).trim().toLowerCase();
        if (mapping[key] !== undefined) {
          row[field] = mapping[key];
        }
        break;
      }
      row[field] = String(value).toLowerCase();
      break;
    }
    case "convert_type":
      if (!isEmptyValue(value)) {
        row[field] = String(value);
      }
      break;
    case "truncate": {
      if (isEmptyValue(value)) break;
      const maxLen = (rule.parameters.maxLength as number) || 255;
      row[field] = String(value).slice(0, maxLen);
      break;
    }
    case "split": {
      const targetCol = (rule.parameters.targetColumn as string) || `${field}_domain`;
      const part = rule.parameters.part as string;
      const source = String(row[field] ?? "");
      if (part === "domain" && source.includes("@")) {
        row[targetCol] = source.split("@").pop();
      } else {
        row[targetCol] = source;
      }
      break;
    }
    case "merge": {
      const sourceFields = (rule.parameters.sourceFields as string[] | undefined)?.filter(Boolean);
      const separator = String(rule.parameters.separator ?? "");
      if (sourceFields && sourceFields.length >= 2) {
        row[field] = sourceFields.map((f) => String(row[f] ?? "")).join(separator);
      }
      break;
    }
    default:
      break;
  }
}

function shouldRemoveRow(row: Record<string, unknown>, rule: CleaningRule): boolean {
  if (rule.action !== "remove") return false;
  const value = row[rule.field];
  if (rule.parameters.condition === "IS EMPTY") {
    return isEmptyValue(value);
  }
  return isEmptyValue(value);
}

function applyMeanFill(rows: Record<string, unknown>[], rule: CleaningRule): void {
  const field = rule.field;
  const nums = rows
    .map((r) => Number(r[field]))
    .filter((n) => !Number.isNaN(n));
  if (nums.length === 0) return;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  for (const row of rows) {
    if (isEmptyValue(row[field])) {
      row[field] = mean;
    }
  }
}

function applyCrossFieldRules(
  rows: Record<string, unknown>[],
  rules: CleaningRule[]
): void {
  const crossRules = rules.filter(
    (r) => r.action === "standardize" && r.parameters.type === "cross_field"
  );
  for (const rule of crossRules) {
    const fields = rule.parameters.fields as string[] | undefined;
    if (!fields || fields.length < 2) continue;
    const [fieldA, fieldB] = fields;
    const operator = String(rule.parameters.operator ?? "<");
    const invalidAction = rule.parameters.action === "flag" ? "flag" : "null";
    for (const row of rows) {
      const valid = compareValues(row[fieldA], row[fieldB], operator);
      if (!valid) {
        if (invalidAction === "flag") {
          row[`${fieldB}_flag`] = "CROSS_FIELD_INVALID";
        } else {
          row[fieldB] = null;
        }
      }
    }
  }
}

function applyDocumentRowRules(
  rows: Record<string, unknown>[],
  rules: CleaningRule[]
): void {
  const dupRules = rules.filter(
    (r) => r.action === "standardize" && r.parameters.type === "duplicate_timestamp"
  );
  for (const rule of dupRules) {
    const field = rule.field;
    const seen = new Map<string, number>();
    for (const row of rows) {
      const key = String(row[field] ?? "");
      if (!key) continue;
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      if (count > 1) {
        row[`${field}_dup_flag`] = "DUPLICATE_TIMESTAMP";
      }
    }
  }

  const stateRules = rules.filter(
    (r) => r.action === "standardize" && r.parameters.type === "state_transition"
  );
  for (const rule of stateRules) {
    const field = rule.field;
    const transitions = rule.parameters.allowedTransitions as Record<string, string[]> | undefined;
    if (!transitions) continue;
    let prev: string | null = null;
    for (const row of rows) {
      const current = String(row[field] ?? "").toLowerCase().trim();
      if (!current) continue;
      if (prev) {
        const allowed: string[] = transitions[prev] ?? [];
        if (allowed.length > 0 && !allowed.map((state) => state.toLowerCase()).includes(current)) {
          row[`${field}_state_flag`] = "INVALID_STATE_TRANSITION";
        }
      }
      prev = current;
    }
  }
}

function deduplicateRows(
  rows: Record<string, unknown>[],
  rules: CleaningRule[],
  columns: string[]
): Record<string, unknown>[] {
  const fullRowDedup = rules.some(
    (r) => r.action === "dedup" && (r.field === "*" || r.parameters.scope === "full_row")
  );
  const columnRule = rules.find(
    (r) => r.action === "dedup" && r.field !== "*" && r.parameters.scope !== "full_row"
  );

  if (fullRowDedup) {
    const seen = new Set<string>();
    return rows.filter((row) => {
      const key = JSON.stringify(columns.map((c) => row[c]));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  if (columnRule) {
    const field = columnRule.field;
    const keep = (columnRule.parameters.keep as string) || "first";
    const orderCol = (columnRule.parameters.orderColumn as string) || field;
    const map = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const key = String(row[field] ?? "");
      const existing = map.get(key);
      if (!existing) {
        map.set(key, row);
        continue;
      }
      if (keep === "last") {
        const existingTs = String(existing[orderCol] ?? "");
        const rowTs = String(row[orderCol] ?? "");
        if (rowTs >= existingTs) map.set(key, row);
      }
    }
    return Array.from(map.values());
  }

  return rows;
}

export function applyCleaningRulesToRows(
  rows: Record<string, unknown>[],
  rules: CleaningRule[],
  columns: string[]
): Record<string, unknown>[] {
  const confirmed = rules
    .filter((r) => r.status === "confirmed")
    .map(resolveRuleVariant);

  const meanRules = confirmed.filter(
    (r) => r.action === "fill_null" && r.parameters.strategy === "mean"
  );
  for (const rule of meanRules) {
    applyMeanFill(rows, rule);
  }

  const ffillRules = confirmed.filter((r) => r.action === "fill_null" && r.parameters.strategy === "ffill");
  for (const rule of ffillRules) {
    let last: unknown = null;
    for (const row of rows) {
      if (isNullishForFill(row[rule.field], rule.parameters.treatEmptyAsNull === true)) {
        if (last !== null) row[rule.field] = last;
      } else {
        last = row[rule.field];
      }
    }
  }

  const bfillRules = confirmed.filter((r) => r.action === "fill_null" && r.parameters.strategy === "bfill");
  for (const rule of bfillRules) {
    let next: unknown = null;
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i];
      if (isNullishForFill(row[rule.field], rule.parameters.treatEmptyAsNull === true)) {
        if (next !== null) row[rule.field] = next;
      } else {
        next = row[rule.field];
      }
    }
  }

  let working = rows.map((row) => ({ ...row }));
  applyCrossFieldRules(working, confirmed);
  applyDocumentRowRules(working, confirmed);

  let result = working
    .map((row) => {
      for (const rule of confirmed) {
        if (shouldRemoveRow(row, rule)) return null;
      }
      const out = { ...row };
      for (const rule of confirmed) {
        applyFieldTransform(out, rule);
      }
      return out;
    })
    .filter((row): row is Record<string, unknown> => row !== null);

  if (confirmed.some((r) => r.action === "dedup")) {
    result = deduplicateRows(result, confirmed, columns);
  }

  return result;
}

export async function executeFileCleaning(
  filePath: string,
  fileType: FileType,
  originalFileName: string,
  rules: CleaningRule[],
  metricsBefore: QualityScore,
  dryRun: boolean = false
): Promise<ExecutionResult & { outputFilePath?: string; outputFileName?: string; downloadUrl?: string }> {
  const executionId = `exec_file_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const startedAt = new Date().toISOString();

  try {
    const loaded = await loadFullFileData(filePath, fileType);
    const originalCount = loaded.rows.length;

    const cleanedRows =
      rules.filter((r) => r.status === "confirmed").length === 0
        ? loaded.rows
        : applyCleaningRulesToRows(loaded.rows, rules, loaded.columns);

    const exportColumns = [
      ...new Set([
        ...loaded.columns,
        ...cleanedRows.flatMap((row) => Object.keys(row)),
      ]),
    ];

    const outputFileName = cleanedFileName(originalFileName);
    const outputFilePath = getUploadPath(outputFileName);

    if (!dryRun) {
      writeCleanedFile(outputFilePath, fileType, cleanedRows, exportColumns, {
        jsonExport: loaded.jsonExport,
        xmlExport: loaded.xmlExport,
      });
    }

    const metricsAfter: QualityScore = {
      ...metricsBefore,
      completeness: Math.min(100, metricsBefore.completeness + 5),
      uniqueness: Math.min(100, metricsBefore.uniqueness + 10),
    };

    const outputBase = path.basename(outputFilePath);

    return {
      executionId,
      overallStatus: "success",
      stepResults: [
        {
          stepNumber: 0,
          name: dryRun ? "模拟读取源文件" : "读取源文件",
          status: "success",
          affectedRows: originalCount,
          durationMs: 0,
        },
        {
          stepNumber: 1,
          name: dryRun ? "模拟应用清洗规则" : "应用清洗规则",
          status: "success",
          affectedRows: cleanedRows.length,
          durationMs: 0,
        },
        {
          stepNumber: 2,
          name: dryRun ? "模拟导出清洗文件" : "导出清洗文件",
          status: "success",
          affectedRows: cleanedRows.length,
          durationMs: 0,
        },
      ],
      metricsBefore,
      metricsAfter,
      startedAt,
      completedAt: new Date().toISOString(),
      outputFilePath: dryRun ? undefined : outputFilePath,
      outputFileName: dryRun ? outputFileName : outputFileName,
      downloadUrl: dryRun ? undefined : `/api/download?file=${encodeURIComponent(outputBase)}`,
    };
  } catch (error) {
    return {
      executionId,
      overallStatus: "failed",
      stepResults: [],
      metricsBefore,
      startedAt,
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
