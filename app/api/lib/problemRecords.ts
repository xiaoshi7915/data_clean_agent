import type { CleaningRule } from "@contracts/types";
import { isFilterRulePass, filterRuleErrType } from "./filterRules";
import { isValidateRulePass } from "./validateRuleSql";
import { transformIdCard } from "./idCardTransform";
import { resolveInvalidAction } from "./invalidAction";
import { resolveUnmatchedStrategy } from "./dictMapRules";
import { resolveFieldDictMap, isWhitelistedValue } from "./dictMapRules";

/** 问题记录行（_err 表对齐） */
export interface ProblemRecord {
  err_field: string;
  err_data: string;
  err_rule_name: string;
  err_type: string;
  /** 原始行快照（文件侧车 CSV 用） */
  row?: Record<string, unknown>;
}

export function problemTableName(tableName: string): string {
  return `${tableName}_err`;
}

export function problemFileName(originalFileName: string): string {
  const dot = originalFileName.lastIndexOf(".");
  if (dot <= 0) return `${originalFileName}_err.csv`;
  return `${originalFileName.slice(0, dot)}_err${originalFileName.slice(dot)}`;
}

function shouldEmitProblem(rule: CleaningRule): boolean {
  if (rule.parameters.emitToProblemTable === true) return true;
  return resolveInvalidAction(rule) === "reject";
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/** 检测单行是否被某规则拒绝并生成问题记录 */
export function collectProblemRecordsForRow(
  row: Record<string, unknown>,
  rules: CleaningRule[]
): ProblemRecord[] {
  const records: ProblemRecord[] = [];

  for (const rule of rules) {
    if (rule.status !== "confirmed") continue;
    if (!shouldEmitProblem(rule)) continue;

    const field = rule.field;
    const value = row[field];
    const ruleName = rule.name || rule.id;
    let failed = false;
    let errType = String(rule.parameters.type ?? rule.action);

    if (rule.action === "standardize") {
      const type = rule.parameters.type as string | undefined;
      if (type === "compare_filter" || type === "length_range" || type === "regex_filter" || type === "domain_filter") {
        failed = !isFilterRulePass(rule, row);
        errType = filterRuleErrType(type);
      } else if (type === "id_card_transform") {
        if (!isEmptyValue(value)) failed = transformIdCard(String(value)) === null;
      } else if (type === "dictMap" || type === "fk_reference" || rule.parameters.fromCodeTable) {
        if (resolveUnmatchedStrategy(rule.parameters) === "reject" && !isEmptyValue(value)) {
          const strVal = String(value).trim();
          const dictMap = resolveFieldDictMap(rule.parameters, field);
          const whitelist = rule.parameters.whitelist as string[] | undefined;
          if (!isWhitelistedValue(strVal, whitelist) && Object.keys(dictMap).length > 0) {
            failed = dictMap[strVal] === undefined;
          }
        }
      } else if (type && ["email_validate", "phone_validate", "regex_validate", "length_validate", "range_validate"].includes(type)) {
        failed = !isValidateRulePass(rule, value);
      }
    }

    if (failed) {
      records.push({
        err_field: field,
        err_data: String(value ?? ""),
        err_rule_name: ruleName,
        err_type: errType,
        row: { ...row },
      });
    }
  }

  return records;
}

/** 问题表 DDL（MySQL 兼容） */
export function buildProblemTableCreateSql(tableName: string, dialect: string): string {
  const errTable = problemTableName(tableName);
  const q = (n: string) => (dialect === "postgresql" ? `"${n}"` : `\`${n}\``);
  return `CREATE TABLE IF NOT EXISTS ${q(errTable)} (
  ${q("id")} BIGINT AUTO_INCREMENT PRIMARY KEY,
  ${q("err_field")} VARCHAR(255) NOT NULL,
  ${q("err_data")} TEXT,
  ${q("err_rule_name")} VARCHAR(255),
  ${q("err_type")} VARCHAR(64),
  ${q("created_at")} TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;
}
