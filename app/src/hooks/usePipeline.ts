import { useCallback } from "react";
import { isDbSourceType } from "./cleaningSessionState";
import { toast } from "sonner";
import { downloadZipFromBase64 } from "@/lib/downloadReport";
import { trpc } from "@/providers/trpc";
import type { CleaningSessionState } from "./cleaningSessionState";
import type { ChatApi } from "./useChat";
import { usePipelineRetry } from "./usePipelineRetry";
import { resolveDialect, runExploration, cleanedOutputHint, exploreCompleteMessage } from "./pipelineHelpers";
import { VIEW_PIPELINE_WITH_SQL_ACTIONS } from "@/lib/pipelineMessageActions";
import {
  historicalRunReadonlyMessage,
  historicalRevisionReadonlyMessage,
  isHistoricalRunView,
  isHistoricalRevisionView,
  writeRunIndexForMutation,
} from "./writableRunGuard";

/** 与 agentService.AgentPlanStep 对齐的前端步骤类型 */
export type AgentPlanStep =
  | { type: "explore"; tableName?: string }
  | { type: "analyze" }
  | { type: "updateRule"; ruleUpdates: unknown[] }
  | { type: "confirmAll" }
  | { type: "generate" }
  | { type: "verify" }
  | { type: "scriptGen" }
  | { type: "exportScripts" }
  | { type: "execute"; dryRun?: boolean };

/** 探查、分析、生成、执行、重试编排 */
export function usePipeline(state: CleaningSessionState, chat: ChatApi) {
  const {
    sessionId,
    dataSource,
    targetTable,
    explorationResult,
    qualityReport,
    cleaningRules,
    generatedSQL,
    setSessionTitle,
    setTargetTable,
    setExplorationResult,
    setQualityReport,
    setCleaningRules,
    setGeneratedSQL,
    setExecutionResult,
    setIsLoading,
    setIsPipelineRunning,
    setError,
    viewingRunIndex,
    currentRunIndex,
    viewingRevisionIndex,
    latestRevisionIndex,
    mutations: {
      exploreDb,
      exploreFile,
      analyze,
      generateSQL,
      verifySQL,
      execute,
      executeFile,
      modifySqlStepMut,
      confirmAllRules,
      exportBundleMut,
      batchDatabaseMut,
    },
    syncPhase,
    refreshLists,
    utils,
  } = state;

  const { pushMessage } = chat;
  const { handleRetry, applyManualFix } = usePipelineRetry(state, chat);
  const { data: runtimeConfig } = trpc.artifact.config.useQuery();
  const scriptOnly = runtimeConfig?.scriptOnly ?? true;

  const ensureWritable = useCallback((): boolean => {
    if (isHistoricalRunView(viewingRunIndex, currentRunIndex)) {
      const msg = historicalRunReadonlyMessage(viewingRunIndex, currentRunIndex);
      setError(msg);
      toast.info(msg);
      return false;
    }
    if (isHistoricalRevisionView(viewingRevisionIndex, latestRevisionIndex)) {
      const msg = historicalRevisionReadonlyMessage(
        viewingRevisionIndex!,
        latestRevisionIndex
      );
      setError(msg);
      toast.info(msg);
      return false;
    }
    return true;
  }, [
    viewingRunIndex,
    currentRunIndex,
    viewingRevisionIndex,
    latestRevisionIndex,
    setError,
  ]);

  const writeRunIndex = writeRunIndexForMutation(viewingRunIndex, currentRunIndex);

  /** 生成 SQL 前从 DB 拉取最新规则，避免 NL 改规则后内存态过期 */
  const refreshRulesFromDb = useCallback(async () => {
    if (!sessionId) return cleaningRules;
    try {
      const full = await utils.session.getFull.fetch({
        sessionId,
        runIndex: writeRunIndex,
      });
      if (full.found && full.session?.cleaningRules?.length) {
        setCleaningRules(full.session.cleaningRules);
        return full.session.cleaningRules;
      }
    } catch (err) {
      console.error("Failed to refresh rules before SQL generation:", err);
    }
    return cleaningRules;
  }, [sessionId, cleaningRules, writeRunIndex, utils.session.getFull, setCleaningRules]);

  const modifySQLStep = useCallback(
    async (stepNumber: number, newSql: string) => {
      if (!sessionId || !generatedSQL || !ensureWritable()) return;
      try {
        await modifySqlStepMut.mutateAsync({ sessionId, stepNumber, newSql, runIndex: writeRunIndex });
        setGeneratedSQL((prev) =>
          prev
            ? {
                ...prev,
                steps: prev.steps.map((s) =>
                  s.stepNumber === stepNumber ? { ...s, sql: newSql } : s
                ),
              }
            : null
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "保存 SQL 修改失败");
      }
    },
    [sessionId, generatedSQL, modifySqlStepMut, setGeneratedSQL, setError, ensureWritable, writeRunIndex]
  );

  const startExploration = useCallback(
    async (tableName?: string) => {
      if (!dataSource || !sessionId || !ensureWritable()) return;
      setIsLoading(true);
      setError(null);
      await syncPhase(sessionId, "explore");

      try {
        const { exploration, resolvedTable } = await runExploration(
          sessionId,
          dataSource,
          tableName ?? targetTable,
          { exploreDb, exploreFile },
          writeRunIndex
        );
        setTargetTable(resolvedTable);
        setExplorationResult(exploration);
        setSessionTitle(`${resolvedTable || exploration.sourceName} · 探查完成`);
        pushMessage(sessionId, "agent", exploreCompleteMessage(exploration), "explore", [
          { id: "view-explore", label: "查看探查报告", type: "viewExplore" },
          { id: "start-analysis", label: "进入质量分析", type: "startAnalysis" },
        ]);
        await refreshLists();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        pushMessage(sessionId, "agent", `❌ 探查失败：${msg}`, "explore");
      } finally {
        setIsLoading(false);
      }
    },
    [
      sessionId,
      dataSource,
      targetTable,
      exploreDb,
      exploreFile,
      syncPhase,
      pushMessage,
      refreshLists,
      setSessionTitle,
      setTargetTable,
      setExplorationResult,
      setIsLoading,
      setError,
    ]
  );

  const startAnalysis = useCallback(async () => {
    if (!explorationResult || !sessionId || !ensureWritable()) return;
    setIsLoading(true);
    setError(null);
    await syncPhase(sessionId, "analyze");

    try {
      const result = await analyze.mutateAsync({
        sessionId,
        runIndex: writeRunIndex,
        explorationResult,
      });

      if (result.success && result.report) {
        setQualityReport(result.report);
        setCleaningRules(result.rules);
        await syncPhase(sessionId, "confirm");
        const ruleCount = result.rules.length;
        const cleanedTarget = cleanedOutputHint(dataSource);
        pushMessage(
          sessionId,
          "agent",
          ruleCount === 0
            ? `📈 质量分析完成！\n\n**质量评分：${result.report.score.overall}/100**\n\n数据质量良好，无需清洗规则。确认后可直接生成清洗方案，输出到 ${cleanedTarget}。`
            : `📈 质量分析完成！\n\n**质量评分：${result.report.score.overall}/100**\n\n已生成 **${ruleCount}** 条清洗规则，请查看并确认。`,
          "confirm",
          [
            { id: "view-quality", label: "查看质量报告", type: "viewQuality" },
            ...(ruleCount > 0
              ? [{ id: "view-rules", label: "查看清洗规则", type: "viewRules" as const }]
              : []),
            { id: "confirm-all", label: "确认全部规则", type: "confirmAll" },
          ]
        );
        await refreshLists();
      } else {
        setError(result.error || "分析失败");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [
    sessionId,
    explorationResult,
    dataSource,
    analyze,
    syncPhase,
    pushMessage,
    refreshLists,
    setQualityReport,
    setCleaningRules,
    setIsLoading,
    setError,
  ]);

  const generateCleaningSQL = useCallback(async () => {
    if (!sessionId || !dataSource || !ensureWritable()) return;
    setIsLoading(true);
    setError(null);
    await syncPhase(sessionId, "generate");

    try {
      const freshRules = await refreshRulesFromDb();
      const dialect = resolveDialect(dataSource.type);
      const tableName =
        targetTable || dataSource.fileConfig?.fileName.replace(/\.[^.]+$/, "") || "data";
      const databaseName = dataSource.dbConfig?.database || "default";

      const result = await generateSQL.mutateAsync({
        sessionId,
        runIndex: writeRunIndex,
        rules: freshRules,
        dialect,
        tableName,
        databaseName,
        columns: explorationResult?.schema.map((c) => c.name) ?? [],
      });

      if (result.success && result.result) {
        setGeneratedSQL(result.result);
        const fileHint = dataSource.fileConfig
          ? `输出文件：${cleanedOutputHint(dataSource)}`
          : `目标表：${result.result.targetTable}`;
        const confirmedCount = freshRules.filter((r) => r.status === "confirmed").length;
        const summaryMessage =
          confirmedCount === 0
            ? `📝 未检测到需清洗规则，已生成原表复制 SQL。共 ${result.result.steps.length} 个步骤。${fileHint}`
            : `📝 清洗方案生成完成！共 ${result.result.steps.length} 个步骤。${fileHint}`;
        pushMessage(
          sessionId,
          "agent",
          summaryMessage,
          "generate",
          VIEW_PIPELINE_WITH_SQL_ACTIONS
        );
        await refreshLists();
      } else {
        setError(result.error || "SQL生成失败");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [
    sessionId,
    dataSource,
    targetTable,
    cleaningRules,
    explorationResult,
    generateSQL,
    pushMessage,
    syncPhase,
    refreshLists,
    refreshRulesFromDb,
    setGeneratedSQL,
    setIsLoading,
    setError,
  ]);

  const runAutoExploreAndAnalyze = useCallback(
    async (
      tableName?: string
    ): Promise<{ exploration: typeof explorationResult; report: typeof qualityReport } | null> => {
      if (!dataSource || !sessionId || !ensureWritable()) return null;

      setIsPipelineRunning(true);
      setIsLoading(true);
      setError(null);

      try {
        await syncPhase(sessionId, "explore");
        const { exploration, resolvedTable } = await runExploration(
          sessionId,
          dataSource,
          tableName ?? targetTable,
          { exploreDb, exploreFile },
          writeRunIndex
        );
        setTargetTable(resolvedTable);
        setExplorationResult(exploration);
        setSessionTitle(`${resolvedTable || exploration.sourceName} · 探查分析`);

        await syncPhase(sessionId, "analyze");
        const analyzeResult = await analyze.mutateAsync({
          sessionId,
          runIndex: writeRunIndex,
          explorationResult: exploration,
        });
        if (!analyzeResult.success || !analyzeResult.report) {
          throw new Error(analyzeResult.error || "分析失败");
        }

        setQualityReport(analyzeResult.report);
        setCleaningRules(analyzeResult.rules);
        await syncPhase(sessionId, "confirm");

        const ruleCount = analyzeResult.rules.length;
        pushMessage(
          sessionId,
          "agent",
          `🔍 **探查与分析完成！**\n\n表 \`${resolvedTable || exploration.sourceName}\` · ${exploration.totalRows.toLocaleString()} 行 · ${exploration.totalCols} 列\n\n**质量评分：${analyzeResult.report.score.overall}/100**${
            ruleCount > 0 ? `\n\n已推荐 **${ruleCount}** 条清洗规则。` : "\n\n数据质量良好，暂无清洗建议。"
          }\n\n点击下方按钮查看报告或规则，不会自动弹出弹窗。`,
          "confirm",
          [
            { id: "view-explore", label: "查看探查报告", type: "viewExplore" },
            { id: "view-quality", label: "查看质量报告", type: "viewQuality" },
            { id: "view-rules", label: "查看清洗规则", type: "viewRules" },
          ]
        );
        await refreshLists();
        return { exploration, report: analyzeResult.report };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        pushMessage(sessionId, "agent", `❌ 自动探查分析失败：${msg}`, "explore");
        return null;
      } finally {
        setIsPipelineRunning(false);
        setIsLoading(false);
      }
    },
    [
      sessionId,
      dataSource,
      targetTable,
      exploreDb,
      exploreFile,
      analyze,
      syncPhase,
      pushMessage,
      refreshLists,
      setExplorationResult,
      setSessionTitle,
      setTargetTable,
      setQualityReport,
      setCleaningRules,
      setIsPipelineRunning,
      setIsLoading,
      setError,
    ]
  );

  const runFullPipelineToSQL = useCallback(
    async (tableName?: string): Promise<boolean> => {
      const result = await runAutoExploreAndAnalyze(tableName);
      return result != null;
    },
    [runAutoExploreAndAnalyze]
  );

  /** 一键生成 SQL：探查 → 分析 → 自动确认规则 → 生成 SQL（不执行） */
  const runPipelineToGenerateSQL = useCallback(
    async (tableName?: string): Promise<boolean> => {
      if (!dataSource || !sessionId || !ensureWritable()) return false;

      setIsPipelineRunning(true);
      setIsLoading(true);
      setError(null);

      try {
        await syncPhase(sessionId, "explore");
        const { exploration, resolvedTable } = await runExploration(
          sessionId,
          dataSource,
          tableName ?? targetTable,
          { exploreDb, exploreFile },
          writeRunIndex
        );
        setTargetTable(resolvedTable);
        setExplorationResult(exploration);
        setSessionTitle(`${resolvedTable || exploration.sourceName} · 一键生成SQL`);

        await syncPhase(sessionId, "analyze");
        const analyzeResult = await analyze.mutateAsync({
          sessionId,
          runIndex: writeRunIndex,
          explorationResult: exploration,
        });
        if (!analyzeResult.success || !analyzeResult.report) {
          throw new Error(analyzeResult.error || "分析失败");
        }

        let rules = analyzeResult.rules;
        setQualityReport(analyzeResult.report);
        setCleaningRules(rules);
        await syncPhase(sessionId, "confirm");

        if (rules.length > 0) {
          await confirmAllRules.mutateAsync({ sessionId, runIndex: writeRunIndex });
          rules = rules.map((r) =>
            r.status === "skipped" ? r : { ...r, status: "confirmed" as const }
          );
          setCleaningRules(rules);
        }

        await syncPhase(sessionId, "generate");
        const dialect = resolveDialect(dataSource.type);
        const sqlTableName =
          resolvedTable || dataSource.fileConfig?.fileName.replace(/\.[^.]+$/, "") || "data";
        const databaseName = dataSource.dbConfig?.database || "default";

        const sqlResult = await generateSQL.mutateAsync({
          sessionId,
          runIndex: writeRunIndex,
          rules,
          dialect,
          tableName: sqlTableName,
          databaseName,
          columns: exploration.schema.map((c) => c.name),
        });
        if (!sqlResult.success || !sqlResult.result) {
          throw new Error(sqlResult.error || "SQL生成失败");
        }

        setGeneratedSQL(sqlResult.result);
        const fileHint = dataSource.fileConfig
          ? `输出文件：${cleanedOutputHint(dataSource)}`
          : `目标表：${sqlResult.result.targetTable}`;
        const confirmedCount = rules.filter((r) => r.status === "confirmed").length;
        const rulesSummary =
          confirmedCount === 0
            ? "\n\n未检测到需清洗规则，已生成原表复制 SQL。"
            : rules.length > 0
              ? `\n\n已自动确认 **${confirmedCount}** 条规则并生成清洗方案。`
              : "\n\n数据质量良好，已直接生成清洗方案。";
        pushMessage(
          sessionId,
          "agent",
          `⚡ **一键生成 SQL** 完成！\n\n**质量评分：${analyzeResult.report.score.overall}/100**${rulesSummary}\n\n${fileHint}`,
          "generate",
          VIEW_PIPELINE_WITH_SQL_ACTIONS
        );
        await refreshLists();
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        pushMessage(sessionId, "agent", `❌ 一键生成 SQL 失败：${msg}`, "explore");
        return false;
      } finally {
        setIsPipelineRunning(false);
        setIsLoading(false);
      }
    },
    [
      sessionId,
      dataSource,
      targetTable,
      exploreDb,
      exploreFile,
      analyze,
      confirmAllRules,
      generateSQL,
      syncPhase,
      pushMessage,
      refreshLists,
      setExplorationResult,
      setSessionTitle,
      setTargetTable,
      setQualityReport,
      setCleaningRules,
      setGeneratedSQL,
      setIsPipelineRunning,
      setIsLoading,
      setError,
    ]
  );

  const executeSQL = useCallback(
    async (dryRun: boolean = false) => {
      if (!sessionId || !generatedSQL || !dataSource || !ensureWritable()) return;
      setIsLoading(true);
      setError(null);
      await syncPhase(sessionId, "execute");

      try {
        const metricsBefore = qualityReport?.score || {
          overall: 0,
          completeness: 0,
          uniqueness: 0,
          consistency: 0,
          validity: 0,
          accuracy: 0,
        };

        if (dataSource.fileConfig) {
          const result = await executeFile.mutateAsync({
            sessionId,
            runIndex: writeRunIndex,
            filePath: dataSource.fileConfig.filePath,
            fileType: dataSource.fileConfig.fileType,
            originalFileName: dataSource.fileConfig.fileName,
            rules: cleaningRules,
            dryRun,
            metricsBefore,
          });

          if (result.success && result.result) {
            setExecutionResult(result.result);
            if (result.result.overallStatus === "success") {
              const fileHint = result.result.outputFileName
                ? dryRun
                  ? `将生成文件：${result.result.outputFileName}`
                  : `已生成清洗文件：${result.result.outputFileName}`
                : "执行完成";
              pushMessage(sessionId, "agent", `✅ ${fileHint}`, "execute");
            } else {
              await syncPhase(sessionId, "retry");
              pushMessage(sessionId, "agent", `❌ 执行失败：${result.result.error}`, "retry");
            }
            await refreshLists();
          } else {
            setError(result.error || "执行失败");
            await syncPhase(sessionId, "retry");
          }
          return;
        }

        if (!dataSource.dbConfig) return;

        const result = await execute.mutateAsync({
          sessionId,
          runIndex: writeRunIndex,
          steps: generatedSQL.steps,
          dbConfig: {
            host: dataSource.dbConfig.host,
            port: dataSource.dbConfig.port,
            database: dataSource.dbConfig.database,
            username: dataSource.dbConfig.username,
            password: dataSource.dbConfig.password,
          },
          dialect: resolveDialect(dataSource.type),
          dryRun,
          metricsBefore,
        });

        if (result.success && result.result) {
          setExecutionResult(result.result);
          if (result.result.overallStatus === "success") {
            pushMessage(sessionId, "agent", `✅ 执行完成！`, "execute");
          } else if (result.result.overallStatus === "partial") {
            await syncPhase(sessionId, "retry");
            pushMessage(sessionId, "agent", `⚠️ 部分步骤执行失败，已进入重试模式。`, "retry");
          } else {
            await syncPhase(sessionId, "retry");
            pushMessage(sessionId, "agent", `❌ 执行失败：${result.result.error}`, "retry");
          }
          await refreshLists();
        } else {
          setError(result.error || "执行失败");
          await syncPhase(sessionId, "retry");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await syncPhase(sessionId, "retry");
      } finally {
        setIsLoading(false);
      }
    },
    [
      sessionId,
      generatedSQL,
      dataSource,
      cleaningRules,
      qualityReport,
      execute,
      executeFile,
      pushMessage,
      syncPhase,
      refreshLists,
      setExecutionResult,
      setIsLoading,
      setError,
    ]
  );

  /** 整库批量：为数据源内各表创建会话并生成 SQL */
  const runBatchDatabasePipeline = useCallback(async (): Promise<boolean> => {
    if (!sessionId || !dataSource || !isDbSourceType(dataSource.type) || !ensureWritable()) {
      return false;
    }
    if (dataSource.fileConfig) {
      toast.info("文件数据源暂不支持整库批量");
      return false;
    }

    setIsPipelineRunning(true);
    setIsLoading(true);
    setError(null);

    try {
      const result = await batchDatabaseMut.mutateAsync({
        sessionId,
        maxTables: 10,
      });
      if (!result.success || !result.result) {
        throw new Error(result.error || "整库批量失败");
      }

      const { processed, totalTables, results } = result.result;
      const okCount = results.filter((r) => r.success).length;
      const lines = results
        .slice(0, 8)
        .map((r) =>
          r.success
            ? `- ✅ \`${r.tableName}\`：评分 ${r.overallScore ?? "-"}，${r.ruleCount ?? 0} 条规则 → 会话 \`${r.sessionId}\``
            : `- ❌ \`${r.tableName}\`：${r.error}`
        )
        .join("\n");

      pushMessage(
        sessionId,
        "agent",
        `📦 **整库批量 SQL** 完成：${okCount}/${processed} 张表成功（库内共 ${totalTables} 张表，本次处理 ${processed} 张）\n\n${lines}${
          results.length > 8 ? "\n\n…" : ""
        }`,
        "generate"
      );
      await refreshLists();
      return okCount > 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      pushMessage(sessionId, "agent", `❌ 整库批量失败：${msg}`, "explore");
      return false;
    } finally {
      setIsPipelineRunning(false);
      setIsLoading(false);
    }
  }, [
    sessionId,
    dataSource,
    ensureWritable,
    batchDatabaseMut,
    pushMessage,
    refreshLists,
    setError,
    setIsLoading,
    setIsPipelineRunning,
  ]);

  /** 按 Agent 计划逐步执行（仅运行 plan 中的步骤，非全量 runFullPipelineToSQL） */
  const runAgentPlanBySteps = useCallback(
    async (steps: AgentPlanStep[], tableName?: string): Promise<boolean> => {
      if (!dataSource || !sessionId || steps.length === 0 || !ensureWritable()) return false;

      setIsPipelineRunning(true);
      setIsLoading(true);
      setError(null);

      let localExploration = explorationResult;
      let localRules = cleaningRules;
      let localGeneratedSQL = generatedSQL;

      try {
        for (const step of steps) {
          switch (step.type) {
            case "explore": {
              await syncPhase(sessionId, "explore");
              const { exploration, resolvedTable } = await runExploration(
                sessionId,
                dataSource,
                step.tableName ?? tableName ?? targetTable,
                { exploreDb, exploreFile },
                writeRunIndex
              );
              localExploration = exploration;
              setTargetTable(resolvedTable);
              setExplorationResult(exploration);
              setSessionTitle(`${resolvedTable || exploration.sourceName} · 探查完成`);
              break;
            }
            case "analyze": {
              if (!localExploration) throw new Error("请先完成探查");
              await syncPhase(sessionId, "analyze");
              const analyzeResult = await analyze.mutateAsync({
                sessionId,
                explorationResult: localExploration,
              });
              if (!analyzeResult.success || !analyzeResult.report) {
                throw new Error(analyzeResult.error || "分析失败");
              }
              localRules = analyzeResult.rules;
              setQualityReport(analyzeResult.report);
              setCleaningRules(analyzeResult.rules);
              await syncPhase(sessionId, "confirm");
              break;
            }
            case "confirmAll": {
              await confirmAllRules.mutateAsync({ sessionId, runIndex: writeRunIndex });
              localRules = localRules.map((r) =>
                r.status === "skipped" ? r : { ...r, status: "confirmed" as const }
              );
              setCleaningRules(localRules);
              break;
            }
            case "generate": {
              await syncPhase(sessionId, "generate");
              const dialect = resolveDialect(dataSource.type);
              const sqlTableName =
                targetTable || dataSource.fileConfig?.fileName.replace(/\.[^.]+$/, "") || "data";
              const databaseName = dataSource.dbConfig?.database || "default";
              const sqlResult = await generateSQL.mutateAsync({
                sessionId,
                rules: localRules,
                dialect,
                tableName: sqlTableName,
                databaseName,
                columns: localExploration?.schema.map((c) => c.name) ?? [],
              });
              if (!sqlResult.success || !sqlResult.result) {
                throw new Error(sqlResult.error || "SQL生成失败");
              }
              localGeneratedSQL = sqlResult.result;
              setGeneratedSQL(sqlResult.result);
              break;
            }
            case "verify": {
              const sqlToVerify = localGeneratedSQL;
              if (!sqlToVerify) throw new Error("请先完成 SQL 生成");
              await syncPhase(sessionId, "generate");
              const verifyResult = await verifySQL.mutateAsync({
                sessionId,
                steps: sqlToVerify.steps,
                dialect: resolveDialect(dataSource.type),
                dbConfig: dataSource.dbConfig ?? undefined,
              });
              if (!verifyResult.success) {
                throw new Error(verifyResult.error || "SQL 校验失败");
              }
              if (!verifyResult.valid) {
                const failed = verifyResult.stepResults.filter((s) => !s.valid);
                const detail = failed
                  .map((s) => `步骤${s.stepNumber}: ${s.errors.join("; ")}`)
                  .join("\n");
                throw new Error(`SQL 校验未通过：\n${detail}`);
              }
              pushMessage(sessionId, "agent", "✅ SQL 校验通过（静态规则 + EXPLAIN）", "generate");
              break;
            }
            case "scriptGen": {
              // Soda checks 在导出脚本包时由 scriptGenAgent 生成
              pushMessage(
                sessionId,
                "agent",
                "📋 Soda 校验脚本已就绪，将在导出脚本包时写入 soda/checks.yml",
                "generate"
              );
              break;
            }
            case "exportScripts": {
              const bundleResult = await exportBundleMut.mutateAsync({ sessionId, asZip: true });
              if (!bundleResult.success || !bundleResult.zipBase64) {
                throw new Error(bundleResult.error || "导出脚本包失败");
              }
              downloadZipFromBase64(bundleResult.zipBase64, `cleaning-bundle-${sessionId}.zip`);
              const fileCount = bundleResult.files?.length ?? 0;
              toast.success(`脚本包已导出（${fileCount} 个文件，已打包为 zip）`);
              pushMessage(
                sessionId,
                "agent",
                `📦 脚本包已导出（${fileCount} 个文件，cleaning-bundle-${sessionId}.zip），请在本地或调度系统执行 cleaning.sql`,
                "generate"
              );
              break;
            }
            case "execute":
              await executeSQL(scriptOnly ? true : (step.dryRun ?? true));
              break;
            case "updateRule":
              break;
            default: {
              const _exhaustive: never = step;
              void _exhaustive;
            }
          }
        }

        pushMessage(
          sessionId,
          "agent",
          `✅ 已按计划完成 ${steps.length} 个步骤：${steps.map((s) => s.type).join(" → ")}`,
          "generate"
        );
        await refreshLists();
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        pushMessage(sessionId, "agent", `❌ 计划执行失败：${msg}`, "explore");
        return false;
      } finally {
        setIsPipelineRunning(false);
        setIsLoading(false);
      }
    },
    [
      sessionId,
      dataSource,
      targetTable,
      explorationResult,
      cleaningRules,
      exploreDb,
      exploreFile,
      analyze,
      confirmAllRules,
      generatedSQL,
      generateSQL,
      verifySQL,
      exportBundleMut,
      scriptOnly,
      executeSQL,
      syncPhase,
      pushMessage,
      refreshLists,
      setExplorationResult,
      setSessionTitle,
      setTargetTable,
      setQualityReport,
      setCleaningRules,
      setGeneratedSQL,
      setIsPipelineRunning,
      setIsLoading,
      setError,
    ]
  );

  return {
    startExploration,
    startAnalysis,
    runAutoExploreAndAnalyze,
    runFullPipelineToSQL,
    runPipelineToGenerateSQL,
    runBatchDatabasePipeline,
    runAgentPlanBySteps,
    generateCleaningSQL,
    executeSQL,
    handleRetry,
    applyManualFix,
    modifySQLStep,
  };
}
