#!/usr/bin/env node
/**
 * DataClean Agent CLI（dca）
 * 命令：explore | compile | execute | export
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { QualityScore, SQLStep } from "@contracts/types";
import { isSqlDialectSupported, unsupportedDialectMessage } from "@contracts/dataSourceSupport";
import { generateCleaningSQL } from "../api/services/sqlGenerationService";
import { parseArgs, resolveDialect, defaultPortForDialect, loadContractRules } from "./args";
import {
  createConnectionForDialect,
  closeConnection,
  createSqlExecutorFromPool,
} from "../api/services/dataSourceService";
import { runSqlSteps } from "../engine/execution/runSqlSteps";
import { getDataSourcePlugin, listDataSourcePlugins } from "../engine/datasource/plugin";
import { isScriptOnlyExecuteBlocked, SCRIPT_ONLY_EXECUTE_MESSAGE } from "./executeGuard";
import { buildArtifactBundle } from "../api/services/artifactService";
import "../engine/datasource/mysqlPlugin";
import "../engine/datasource/postgresPlugin";

const USAGE = `dca — DataClean Agent CLI

用法:
  dca explore --type mysql|postgresql --host HOST --port PORT --database DB --user USER --password PASS --table TABLE
  dca compile --contract FILE.yaml [--table TABLE] [--database DB]
  dca execute --contract FILE.yaml ... [--dry-run] [--force-execute]  # ⚠ 已弃用，请使用外部执行器
  dca export --contract FILE.yaml [--output DIR] [--table TABLE] [--database DB] [--include-dbt] [--include-scheduling]
  dca export --session-id SESSION_ID [--output DIR]

子命令:
  explore   探查数据源（mysql / postgresql）
  compile   从契约 YAML/JSON 编译清洗 SQL
  execute   [已弃用] 请导出脚本包后由 Airflow/dbt/外部 Runner 执行，并通过 webhook 回传校验结果
  export    导出完整脚本包目录树（cleaning.sql + steps/ + contract.yaml + soda/ + manifest.json + README.md）
`;

function readDbConfig(args: Record<string, string | boolean>, dialect: ReturnType<typeof resolveDialect>) {
  const database = String(args.database ?? "");
  if (!database) {
    console.error("缺少 --database");
    process.exit(1);
  }
  return {
    host: String(args.host ?? "127.0.0.1"),
    port: Number(args.port ?? defaultPortForDialect(dialect)),
    database,
    username: String(args.user ?? args.username ?? "root"),
    password: String(args.password ?? ""),
  };
}

async function cmdExplore(args: Record<string, string | boolean>): Promise<void> {
  const type = String(args.type ?? "mysql");
  const plugin = getDataSourcePlugin(type);
  if (!plugin) {
    console.error(`不支持的数据源类型: ${type}`);
    console.error("已注册:", listDataSourcePlugins().map((p) => p.type).join(", ") || "(无)");
    process.exit(1);
  }

  const dialect = type === "postgresql" ? "postgresql" : "mysql";
  const config = readDbConfig(args, dialect);
  const tableName = String(args.table ?? "");
  if (!tableName) {
    console.error("缺少 --table");
    process.exit(1);
  }

  const result = await plugin.explore(config, {
    sessionId: "cli",
    tableName,
    limit: Number(args.limit ?? 50),
  });
  console.log(JSON.stringify(result, null, 2));
}

async function cmdCompile(args: Record<string, string | boolean>): Promise<void> {
  const contractPath = String(args.contract ?? "");
  if (!contractPath) {
    console.error("缺少 --contract FILE");
    process.exit(1);
  }

  const { contract, rules } = loadContractRules(contractPath);
  const tableName = String(args.table ?? contract.metadata?.tableName ?? "data");
  const databaseName = String(args.database ?? contract.metadata?.databaseName ?? "default");
  const dialect = resolveDialect(args, contract.metadata?.dialect);

  if (!isSqlDialectSupported(dialect)) {
    console.error(unsupportedDialectMessage(dialect));
    process.exit(1);
  }

  const sql = generateCleaningSQL(
    rules,
    dialect,
    tableName,
    databaseName,
    rules.map((r) => r.field).filter((f) => f !== "*")
  );

  console.log(JSON.stringify(sql, null, 2));
}

async function cmdExecute(args: Record<string, string | boolean>): Promise<void> {
  const contractPath = String(args.contract ?? "");
  if (!contractPath) {
    console.error("缺少 --contract FILE");
    process.exit(1);
  }

  const { contract, rules } = loadContractRules(contractPath);
  const dialect = resolveDialect(args, contract.metadata?.dialect);

  if (!isSqlDialectSupported(dialect)) {
    console.error(unsupportedDialectMessage(dialect));
    process.exit(1);
  }

  const dbConfig = readDbConfig(args, dialect);
  const forceExecute = args["force-execute"] === true;
  // 默认 dry-run；显式 --force-execute 且 ALLOW_EXECUTE=true 才真实写库
  const dryRun = forceExecute ? false : args["dry-run"] !== false;

  if (isScriptOnlyExecuteBlocked(dryRun)) {
    console.error(SCRIPT_ONLY_EXECUTE_MESSAGE);
    process.exit(1);
  }

  const tableName = String(args.table ?? contract.metadata?.tableName ?? "data");
  const databaseName = String(args.database ?? contract.metadata?.databaseName ?? dbConfig.database);

  const generated = generateCleaningSQL(
    rules,
    dialect,
    tableName,
    databaseName,
    rules.map((r) => r.field).filter((f) => f !== "*")
  );
  const steps: SQLStep[] = generated.steps;

  const metricsBefore: QualityScore = {
    overall: 70,
    completeness: 70,
    uniqueness: 80,
    consistency: 75,
    validity: 70,
    accuracy: 70,
  };

  const sessionId = "cli";
  const poolEntry = await createConnectionForDialect(sessionId, dbConfig, dialect);
  try {
    const result = await runSqlSteps({
      sessionId,
      steps,
      executor: createSqlExecutorFromPool(poolEntry),
      dryRun,
      metricsBefore,
    });
    console.log(JSON.stringify({ generated, execution: result, dryRun }, null, 2));
    if (result.overallStatus === "failed") {
      process.exit(1);
    }
  } finally {
    await closeConnection(sessionId);
  }
}

async function cmdExport(args: Record<string, string | boolean>): Promise<void> {
  const outDir = String(args.output ?? args.out ?? "./cleaning-bundle");
  const includeDbt = args["include-dbt"] === true;
  const includeScheduling = args["include-scheduling"] === true;
  const sessionId = args["session-id"] ? String(args["session-id"]) : undefined;
  const contractPath = args.contract ? String(args.contract) : undefined;

  if (sessionId) {
    const { exportSessionArtifactBundle } = await import("../api/services/artifactService");
    const bundle = await exportSessionArtifactBundle(sessionId, {
      includeDbt,
      includeScheduling,
    });
    if (!bundle) {
      console.error("无法从会话导出脚本包（会话不存在或缺少规则/SQL）");
      process.exit(1);
    }
    mkdirSync(outDir, { recursive: true });
    for (const file of bundle.files) {
      const filePath = join(outDir, file.path);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, file.content, "utf8");
    }
    console.log(JSON.stringify({ outDir, fileCount: bundle.files.length, manifest: bundle.manifest }, null, 2));
    return;
  }

  if (!contractPath) {
    console.error("缺少 --contract FILE 或 --session-id");
    process.exit(1);
  }

  const { contract, rules } = loadContractRules(contractPath);
  const tableName = String(args.table ?? contract.metadata?.tableName ?? "data");
  const databaseName = String(args.database ?? contract.metadata?.databaseName ?? "default");
  const dialect = resolveDialect(args, contract.metadata?.dialect);

  const sqlResult = generateCleaningSQL(
    rules,
    dialect,
    tableName,
    databaseName,
    rules.map((r) => r.field).filter((f) => f !== "*")
  );

  const bundle = buildArtifactBundle({
    rules,
    sqlResult,
    dialect,
    tableName,
    databaseName,
    options: { includeDbt, includeScheduling },
  });

  mkdirSync(outDir, { recursive: true });
  for (const file of bundle.files) {
    const filePath = join(outDir, file.path);
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(filePath, file.content, "utf8");
  }
  console.log(JSON.stringify({ outDir, fileCount: bundle.files.length, manifest: bundle.manifest }, null, 2));
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  const args = parseArgs(rest);

  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  switch (command) {
    case "explore":
      await cmdExplore(args);
      break;
    case "compile":
      await cmdCompile(args);
      break;
    case "execute":
      console.warn(
        "⚠ dca execute 已弃用：请使用 dca export 导出脚本包，由 Airflow/dbt/外部 Runner 执行，并通过 runs.verificationResult webhook 回传结果。"
      );
      await cmdExecute(args);
      break;
    case "export":
      await cmdExport(args);
      break;
    default:
      console.error(`未知命令: ${command}`);
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
