import { readFileSync } from "node:fs";
import { join } from "node:path";

const TEMPLATE_ROOT = join(import.meta.dirname, "../../templates");

/** 渲染 Airflow DAG 片段 */
export function renderAirflowDagSnippet(input: {
  tableName: string;
  sessionId?: string;
  runId?: string;
  scheduleCron?: string;
  webhookUrl?: string;
}): string {
  const template = readFileSync(join(TEMPLATE_ROOT, "airflow/dag_snippet.py"), "utf8");
  return template
    .replace(/\{\{table_name\}\}/g, input.tableName)
    .replace(/\{\{session_id\}\}/g, input.sessionId ?? "unknown")
    .replace(/\{\{run_id\}\}/g, input.runId ?? "run_placeholder")
    .replace(/\{\{schedule_cron\}\}/g, input.scheduleCron ?? "0 2 * * *")
    .replace(/\{\{webhook_url\}\}/g, input.webhookUrl ?? "https://your-dca-host/api/trpc/runs.verificationResult");
}

/** 渲染 Deequ Spark 校验桩 */
export function renderDeequStub(tableName: string): string {
  const template = readFileSync(join(TEMPLATE_ROOT, "deequ/spark_checks.py"), "utf8");
  return template.replace(/\{\{table_name\}\}/g, tableName);
}
