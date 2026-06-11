import { serializeCleaningContractYaml } from "@contracts/contractParser";
import { rulesToContract } from "@contracts/contractParser";
import type { CleaningRule, DatabaseDialect, SQLGenerationResult } from "@contracts/types";
import { runScriptGenAgent } from "../agents/scriptGenAgent";
import { getFullSession } from "./sessionService";
import { generateCleaningSQL } from "./sqlGenerationService";

export interface ArtifactBundleFile {
  path: string;
  content: string;
}

export interface ArtifactBundle {
  manifest: Record<string, unknown>;
  files: ArtifactBundleFile[];
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
}

/** 构建可导出的脚本包目录结构 */
export function buildArtifactBundle(input: BuildArtifactInput): ArtifactBundle {
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

  const stepFiles: ArtifactBundleFile[] = input.sqlResult.steps.map((step) => ({
    path: `steps/step_${String(step.stepNumber).padStart(2, "0")}_${step.name.replace(/\s+/g, "_")}.sql`,
    content: `-- ${step.name}\n-- risk: ${step.riskLevel}\n${step.sql}\n`,
  }));

  const dataset =
    input.explorationDataset ??
    `datasource/${input.databaseName}/default/${input.tableName}`;

  const scriptGen = runScriptGenAgent({
    dataset,
    rules: input.rules,
  });

  const sodaChecks = scriptGen.data?.checksYaml ?? "dataset: unknown\ncolumns: []\nchecks:\n  - schema:\n";

  const files: ArtifactBundleFile[] = [
    { path: "cleaning.sql", content: consolidated },
    ...stepFiles,
    { path: "contract.yaml", content: contractYaml },
    { path: "soda/checks.yml", content: sodaChecks },
  ];

  const manifest = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    sessionId: input.sessionId,
    tableName: input.tableName,
    databaseName: input.databaseName,
    dialect: input.dialect,
    stepCount: input.sqlResult.steps.length,
    ruleCount: input.rules.filter((r) => r.status === "confirmed").length,
    scriptOnly: true,
    files: files.map((f) => f.path),
    verification: {
      sodaChecksPath: "soda/checks.yml",
    },
  };

  files.push({
    path: "manifest.json",
    content: JSON.stringify(manifest, null, 2),
  });

  return { manifest, files };
}

/** 从会话 ID 加载数据并构建脚本包 */
export async function exportSessionArtifactBundle(
  sessionId: string
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

  return buildArtifactBundle({
    sessionId,
    rules,
    sqlResult,
    dialect,
    tableName,
    databaseName,
    sessionTitle: session.sessionTitle,
    explorationDataset: dataset,
  });
}
