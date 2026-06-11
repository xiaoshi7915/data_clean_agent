import { useCallback } from "react";
import type { CleaningSessionState } from "./cleaningSessionState";
import type { ChatApi } from "./useChat";
import { usePipelineRetry } from "./usePipelineRetry";
import { resolveDialect, runExploration, cleanedOutputHint, exploreCompleteMessage } from "./pipelineHelpers";

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
    mutations: {
      exploreDb,
      exploreFile,
      analyze,
      generateSQL,
      execute,
      executeFile,
      modifySqlStepMut,
      confirmAllRules,
    },
    syncPhase,
    refreshLists,
  } = state;

  const { pushMessage } = chat;
  const { handleRetry, applyManualFix } = usePipelineRetry(state, chat);

  const modifySQLStep = useCallback(
    async (stepNumber: number, newSql: string) => {
      if (!sessionId || !generatedSQL) return;
      try {
        await modifySqlStepMut.mutateAsync({ sessionId, stepNumber, newSql });
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
    [sessionId, generatedSQL, modifySqlStepMut, setGeneratedSQL, setError]
  );

  const startExploration = useCallback(
    async (tableName?: string) => {
      if (!dataSource || !sessionId) return;
      setIsLoading(true);
      setError(null);
      await syncPhase(sessionId, "explore");

      try {
        const { exploration, resolvedTable } = await runExploration(
          sessionId,
          dataSource,
          tableName ?? targetTable,
          { exploreDb, exploreFile }
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
    if (!explorationResult || !sessionId) return;
    setIsLoading(true);
    setError(null);
    await syncPhase(sessionId, "analyze");

    try {
      const result = await analyze.mutateAsync({ sessionId, explorationResult });

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
    if (!sessionId || !dataSource) return;
    const confirmedRules = cleaningRules.filter((r) => r.status === "confirmed");
    if (confirmedRules.length === 0 && cleaningRules.length > 0) {
      pushMessage(
        sessionId,
        "agent",
        "⚠️ 请先在「查看清洗规则」中确认至少一条规则，再生成 SQL。",
        "confirm",
        [{ id: "view-rules", label: "查看清洗规则", type: "viewRules" }]
      );
      return;
    }
    setIsLoading(true);
    setError(null);
    await syncPhase(sessionId, "generate");

    try {
      const dialect = resolveDialect(dataSource.type);
      const tableName =
        targetTable || dataSource.fileConfig?.fileName.replace(/\.[^.]+$/, "") || "data";
      const databaseName = dataSource.dbConfig?.database || "default";

      const result = await generateSQL.mutateAsync({
        sessionId,
        rules: cleaningRules,
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
        pushMessage(
          sessionId,
          "agent",
          `📝 清洗方案生成完成！共 ${result.result.steps.length} 个步骤。${fileHint}`,
          "generate",
          [{ id: "view-sql", label: "查看清洗SQL", type: "viewSQL" }]
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
    setGeneratedSQL,
    setIsLoading,
    setError,
  ]);

  const runFullPipelineToSQL = useCallback(
    async (tableName?: string): Promise<boolean> => {
      if (!dataSource || !sessionId) return false;

      setIsPipelineRunning(true);
      setIsLoading(true);
      setError(null);

      try {
        await syncPhase(sessionId, "explore");
        const { exploration, resolvedTable } = await runExploration(
          sessionId,
          dataSource,
          tableName ?? targetTable,
          { exploreDb, exploreFile }
        );
        setTargetTable(resolvedTable);
        setExplorationResult(exploration);
        setSessionTitle(`${resolvedTable || exploration.sourceName} · 一键生成SQL`);
        pushMessage(sessionId, "agent", exploreCompleteMessage(exploration), "explore", [
          { id: "view-explore", label: "查看探查报告", type: "viewExplore" },
          { id: "start-analysis", label: "进入质量分析", type: "startAnalysis" },
        ]);

        await syncPhase(sessionId, "analyze");
        const analyzeResult = await analyze.mutateAsync({
          sessionId,
          explorationResult: exploration,
        });
        if (!analyzeResult.success || !analyzeResult.report) {
          throw new Error(analyzeResult.error || "分析失败");
        }

        const rules = analyzeResult.rules;
        setQualityReport(analyzeResult.report);
        setCleaningRules(rules);
        await syncPhase(sessionId, "confirm");

        const ruleCount = rules.length;
        pushMessage(
          sessionId,
          "agent",
          ruleCount === 0
            ? `📈 质量分析完成！\n\n**质量评分：${analyzeResult.report.score.overall}/100**\n\n数据质量良好，无需清洗规则。`
            : `📈 质量分析完成！\n\n**质量评分：${analyzeResult.report.score.overall}/100**\n\n已生成 **${ruleCount}** 条清洗规则，已自动确认默认策略。`,
          "confirm",
          [
            { id: "view-quality", label: "查看质量报告", type: "viewQuality" },
            ...(ruleCount > 0
              ? [{ id: "view-rules", label: "查看清洗规则", type: "viewRules" as const }]
              : []),
          ]
        );

        await confirmAllRules.mutateAsync({ sessionId });
        const confirmedRules = rules.map((r) =>
          r.status === "skipped" ? r : { ...r, status: "confirmed" as const }
        );
        setCleaningRules(confirmedRules);

        await syncPhase(sessionId, "generate");
        const dialect = resolveDialect(dataSource.type);
        const sqlTableName =
          resolvedTable ||
          dataSource.fileConfig?.fileName.replace(/\.[^.]+$/, "") ||
          "data";
        const databaseName = dataSource.dbConfig?.database || "default";

        const sqlResult = await generateSQL.mutateAsync({
          sessionId,
          rules: confirmedRules,
          dialect,
          tableName: sqlTableName,
          databaseName,
          columns: exploration.schema.map((c: { name: string }) => c.name),
        });

        if (!sqlResult.success || !sqlResult.result) {
          throw new Error(sqlResult.error || "SQL生成失败");
        }

        setGeneratedSQL(sqlResult.result);
        const fileHint = dataSource.fileConfig
          ? `输出文件：${cleanedOutputHint(dataSource)}`
          : `目标表：${sqlResult.result.targetTable}`;
        pushMessage(
          sessionId,
          "agent",
          `🚀 一键流程完成！\n\n${fileHint}\n\n共 ${sqlResult.result.steps.length} 个清洗步骤。您仍可查看探查报告、质量报告与清洗规则。`,
          "generate",
          [
            { id: "view-explore", label: "查看探查报告", type: "viewExplore" },
            { id: "view-quality", label: "查看质量报告", type: "viewQuality" },
            ...(ruleCount > 0
              ? [{ id: "view-rules", label: "查看清洗规则", type: "viewRules" as const }]
              : []),
            { id: "view-sql", label: "查看清洗SQL", type: "viewSQL" },
          ]
        );

        await refreshLists();
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        pushMessage(sessionId, "agent", `❌ 一键流程失败：${msg}`, "explore");
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
      if (!sessionId || !generatedSQL || !dataSource) return;
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
          steps: generatedSQL.steps,
          dbConfig: dataSource.dbConfig,
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

  /** 按 Agent 计划逐步执行（仅运行 plan 中的步骤，非全量 runFullPipelineToSQL） */
  const runAgentPlanBySteps = useCallback(
    async (steps: AgentPlanStep[], tableName?: string): Promise<boolean> => {
      if (!dataSource || !sessionId || steps.length === 0) return false;

      setIsPipelineRunning(true);
      setIsLoading(true);
      setError(null);

      let localExploration = explorationResult;
      let localRules = cleaningRules;

      try {
        for (const step of steps) {
          switch (step.type) {
            case "explore": {
              await syncPhase(sessionId, "explore");
              const { exploration, resolvedTable } = await runExploration(
                sessionId,
                dataSource,
                step.tableName ?? tableName ?? targetTable,
                { exploreDb, exploreFile }
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
              await confirmAllRules.mutateAsync({ sessionId });
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
              setGeneratedSQL(sqlResult.result);
              break;
            }
            case "verify":
            case "scriptGen":
            case "exportScripts":
              break;
            case "execute":
              await executeSQL(step.dryRun ?? true);
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
      generateSQL,
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
    runFullPipelineToSQL,
    runAgentPlanBySteps,
    generateCleaningSQL,
    executeSQL,
    handleRetry,
    applyManualFix,
    modifySQLStep,
  };
}
