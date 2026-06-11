import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { ZipArchive } from "archiver";
import { serializeCleaningContractYaml } from "@contracts/contractParser";
import { rulesToContract } from "@contracts/contractParser";
import type { CleaningRule, DatabaseDialect, SQLGenerationResult } from "@contracts/types";
import { runScriptGenAgent } from "../agents/scriptGenAgent";
import { startRun, runScriptOnlyPipeline } from "../agents/orchestrator";
import { getFullSession } from "./sessionService";
import { generateCleaningSQL } from "./sqlGenerationService";
import { renderDbtStagingSql, renderDbtSchemaYml } from "./dbtTemplateService";
import { renderAirflowDagSnippet, renderDeequStub } from "./schedulingTemplateService";

export interface ArtifactBundleFile {
  path: string;
  content: string;
}

export interface ArtifactBundle {
  manifest: Record<string, unknown>;
  files: ArtifactBundleFile[];
}

export interface BuildArtifactOptions {
  includeDbt?: boolean;
  includeScheduling?: boolean;
  engine?: "sql" | "spark";
  runId?: string;
  webhookCallbackUrl?: string;
}

export interface BuildArtifactInput {
  sessionId?: string;
  rules: CleaningRule[];
  sqlResult: SQLGenerationResult;
  dialect: DatabaseDialect;
  tableName: string;
  databaseName: string;
  sessionTitle?: string;
  explorationDataset?: string;
  options?: BuildArtifactOptions;
}

/** 生成 README 说明文档 */
function buildReadme(input: BuildArtifactInput): string {
  return `# DataClean Agent 脚本包

- 表名: ${input.tableName}
- 数据库: ${input.databaseName}
- 方言: ${input.dialect}
- 导出时间: ${new Date().toISOString()}
- 会话: ${input.sessionId ?? "N/A"}

## 目录结构

| 文件 | 说明 |
|------|------|
| cleaning.sql | 合并清洗 SQL |
| steps/ | 分步 SQL |
| contract.yaml | 清洗契约 |
| soda/checks.yml | Soda Core 质量校验 |
| manifest.json | 元数据与调度配置 |

## 使用方式

\`\`\`bash
# Soda 校验
soda scan -d soda/configuration.yml soda/checks.yml

# dbt（若包含 dbt/ 子目录）
dbt run --select stg_${input.tableName}_cleaned
\`\`\`
`;
}

/** 构建可导出的脚本包目录结构 */
export function buildArtifactBundle(input: BuildArtifactInput): ArtifactBundle {
  const opts = input.options ?? {};
  const contract = rulesToContract(input.rules, {
    sessionId: input.sessionId,
    title: input.sessionTitle,
    tableName: input.tableName,
    databaseName: input.databaseName,
    dialect: input.dialect,
    exportedAt: new Date().toISOString(),
  });

  const contractYaml = serializeCleaningContractYaml(contract);
  const consolidated =
    input.sqlResult.consolidatedSql ??
    input.sqlResult.steps.map((s) => s.sql).join("\n\n");

  // 步骤文件命名：steps/01_*.sql
  const stepFiles: ArtifactBundleFile[] = input.sqlResult.steps.map((step) => ({
    path: `steps/${String(step.stepNumber).padStart(2, "0")}_${step.name.replace(/\s+/g, "_")}.sql`,
    content: `-- ${step.name}\n-- risk: ${step.riskLevel}\n${step.sql}\n`,
  }));

  const dataset =
    input.explorationDataset ??
    `datasource/${input.databaseName}/default/${input.tableName}`;

  const scriptGen = runScriptGenAgent({
    dataset,
    rules: input.rules,
  });

  const sodaChecks = scriptGen.data?.checksYaml ?? "checks:\n  - schema:\n";

  const files: ArtifactBundleFile[] = [
    { path: "cleaning.sql", content: consolidated },
    ...stepFiles,
    { path: "contract.yaml", content: contractYaml },
    { path: "soda/checks.yml", content: sodaChecks },
    { path: "README.md", content: buildReadme(input) },
  ];

  // dbt 子目录（可选）
  if (opts.includeDbt) {
    const stgSql = renderDbtStagingSql(input.tableName, input.tableName);
    const schemaYml = renderDbtSchemaYml(input.tableName, input.rules);
    files.push(
      { path: `dbt/models/staging/stg_${input.tableName}_cleaned.sql`, content: stgSql },
      { path: "dbt/schema.yml", content: schemaYml }
    );
  }

  // Airflow DAG 片段（可选）
  if (opts.includeScheduling) {
    const dagSnippet = renderAirflowDagSnippet({
      tableName: input.tableName,
      sessionId: input.sessionId,
      runId: opts.runId,
      webhookUrl: opts.webhookCallbackUrl,
    });
    files.push({ path: "scheduling/airflow/dag_snippet.py", content: dagSnippet });
  }

  // Deequ Spark 桩（engine=spark 时）
  if (opts.engine === "spark") {
    files.push({
      path: "scheduling/deequ/spark_checks.py",
      content: renderDeequStub(input.tableName),
    });
  }

  const manifest: Record<string, unknown> = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    sessionId: input.sessionId,
    runId: opts.runId,
    tableName: input.tableName,
    databaseName: input.databaseName,
    dialect: input.dialect,
    stepCount: input.sqlResult.steps.length,
    ruleCount: input.rules.filter((r) => r.status === "confirmed").length,
    scriptOnly: true,
    files: files.map((f) => f.path),
    verification: {
      sodaChecksPath: "soda/checks.yml",
      enabled: true,
    },
    artifacts: {
      includeDbt: opts.includeDbt ?? false,
      includeScheduling: opts.includeScheduling ?? false,
      engine: opts.engine ?? "sql",
    },
    scheduling: {
      dbt: {
        command: `dbt run --select stg_${input.tableName}_cleaned`,
      },
      airflow: {
        dagSnippet: "scheduling/airflow/dag_snippet.py",
      },
      webhookCallbackUrl:
        opts.webhookCallbackUrl ??
        "https://your-dca-host/api/trpc/runs.verificationResult",
    },
  };

  files.push({
    path: "manifest.json",
    content: JSON.stringify(manifest, null, 2),
  });

  return { manifest, files };
}

/** 将脚本包写入磁盘目录树 */
export function writeArtifactBundleToDir(bundle: ArtifactBundle, outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  for (const file of bundle.files) {
    const filePath = join(outDir, file.path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, file.content, "utf8");
  }
}

/** 将脚本包打包为 zip Buffer */
export async function exportZip(bundle: ArtifactBundle): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];

    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
    archive.on("error", reject);

    archive.pipe(stream);

    for (const file of bundle.files) {
      archive.append(file.content, { name: file.path });
    }

    void archive.finalize();
  });
}

/** 将脚本包 zip 写入磁盘 */
export async function exportZipToPath(bundle: ArtifactBundle, zipPath: string): Promise<void> {
  const buffer = await exportZip(bundle);
  mkdirSync(dirname(zipPath), { recursive: true });
  writeFileSync(zipPath, buffer);
}

/** 从会话 ID 加载数据并构建脚本包（持久化编排状态） */
export async function exportSessionArtifactBundle(
  sessionId: string,
  options?: BuildArtifactOptions
): Promise<ArtifactBundle | null> {
  const session = await getFullSession(sessionId);
  if (!session) return null;

  const rules = session.cleaningRules ?? [];
  const tableName = session.targetTable || "data";
  const databaseName = session.dataSource?.dbConfig?.database || "default";
  const dialect =
    session.dataSource?.type === "postgresql" ? "postgresql" : "mysql";

  let sqlResult = session.generatedSQL as SQLGenerationResult | undefined;
  if (!sqlResult) {
    const confirmed = rules.filter((r) => r.status === "confirmed");
    if (confirmed.length === 0) return null;
    sqlResult = generateCleaningSQL(
      rules,
      dialect,
      tableName,
      databaseName,
      session.explorationResult?.schema.map((c) => c.name) ?? []
    );
  }

  const dataset = session.dataSource?.dbConfig
    ? `datasource/${databaseName}/default/${tableName}`
    : `file/${tableName}`;

  // 创建编排运行并持久化 script-only 流水线进度
  const { runId, ctx } = await startRun(sessionId, tableName);
  await runScriptOnlyPipeline(ctx, runId, sessionId);

  return buildArtifactBundle({
    sessionId,
    rules,
    sqlResult,
    dialect,
    tableName,
    databaseName,
    sessionTitle: session.sessionTitle,
    explorationDataset: dataset,
    options: { ...options, runId },
  });
}
