import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CleaningRule } from "@contracts/types";

const TEMPLATE_ROOT = join(import.meta.dirname, "../../templates/dbt");

/** 从规则生成 dbt schema.yml 列级测试 */
export function rulesToDbtColumnTests(rules: CleaningRule[]): string {
  const confirmed = rules.filter((r) => r.status === "confirmed");
  const lines: string[] = [];

  for (const rule of confirmed) {
    if (rule.field === "*") continue;
    lines.push(`      - name: ${rule.field}`);
    lines.push(`        tests:`);

    switch (rule.action) {
      case "fill_null":
        lines.push(`          - not_null`);
        break;
      case "dedup":
        lines.push(`          - unique`);
        break;
      case "format":
        if (rule.parameters.allowedValues) {
          const values = Array.isArray(rule.parameters.allowedValues)
            ? rule.parameters.allowedValues
            : [rule.parameters.allowedValues];
          lines.push(`          - accepted_values:`);
          lines.push(`              values: ${JSON.stringify(values)}`);
        }
        break;
      default:
        break;
    }
  }

  if (lines.length === 0) {
    return '      - name: id\n        tests:\n          - not_null';
  }

  return lines.join("\n");
}

/** 渲染 dbt staging SQL 模板 */
export function renderDbtStagingSql(tableName: string, sourceTable: string): string {
  const template = readFileSync(
    join(TEMPLATE_ROOT, "models/staging/stg_{{table}}_cleaned.sql"),
    "utf8"
  );
  return template
    .replace(/\{\{table\}\}/g, tableName)
    .replace(/\{\{source_table\}\}/g, sourceTable)
    .replace(/\{\{exported_at\}\}/g, new Date().toISOString());
}

/** 渲染 dbt schema.yml */
export function renderDbtSchemaYml(tableName: string, rules: CleaningRule[]): string {
  const template = readFileSync(join(TEMPLATE_ROOT, "schema.yml"), "utf8");
  const columnTests = rulesToDbtColumnTests(rules);
  return template
    .replace(/\{\{table\}\}/g, tableName)
    .replace(/\{\{column_tests\}\}/g, columnTests);
}
