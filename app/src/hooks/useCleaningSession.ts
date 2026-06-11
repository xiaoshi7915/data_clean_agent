import { useState, useCallback, useEffect } from "react";
import { trpc } from "@/providers/trpc";
import type {
  CleaningPhase,
  DataSourceConfig,
  ExplorationResult,
  QualityReport,
  CleaningRule,
  SQLGenerationResult,
  ExecutionResult,
  RetryContext,
  ChatMessage,
  ChatMessageAction,
  SessionListItem,
  SavedDataSourceItem,
} from "@contracts/types";

export function useCleaningSession() {
  const [sessionId, setSessionId] = useState<string>("");
  const [sessionTitle, setSessionTitle] = useState<string>("");
  const [dataSourceId, setDataSourceId] = useState<string>("");
  const [currentPhase, setCurrentPhase] = useState<CleaningPhase>("idle");
  const [dataSource, setDataSource] = useState<DataSourceConfig | null>(null);
  const [targetTable, setTargetTable] = useState<string>("");
  const [explorationResult, setExplorationResult] = useState<ExplorationResult | null>(null);
  const [qualityReport, setQualityReport] = useState<QualityReport | null>(null);
  const [cleaningRules, setCleaningRules] = useState<CleaningRule[]>([]);
  const [generatedSQL, setGeneratedSQL] = useState<SQLGenerationResult | null>(null);
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [retryContext, setRetryContext] = useState<RetryContext | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionList, setSessionList] = useState<SessionListItem[]>([]);
  const [savedDataSources, setSavedDataSources] = useState<SavedDataSourceItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPipelineRunning, setIsPipelineRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const utils = trpc.useUtils();
  const createSession = trpc.session.create.useMutation();
  const createFromDataSource = trpc.session.createFromDataSource.useMutation();
  const saveDataSourceMut = trpc.session.saveDataSource.useMutation();
  const saveMessageMut = trpc.session.addMessage.useMutation();
  const updatePhaseMut = trpc.session.updatePhase.useMutation();
  const exploreDb = trpc.explore.exploreDatabase.useMutation();
  const exploreFile = trpc.explore.exploreFile.useMutation();
  const analyze = trpc.analyze.analyze.useMutation();
  const updateRule = trpc.rules.updateStatus.useMutation();
  const confirmAllRules = trpc.rules.confirmAll.useMutation();
  const generateSQL = trpc.sql.generate.useMutation();
  const execute = trpc.execute.execute.useMutation();
  const executeFile = trpc.execute.executeFile.useMutation();
  const getRetryCtx = trpc.execute.getRetryContext.useMutation();
  const applyFix = trpc.execute.applyFix.useMutation();
  const deleteSessionMut = trpc.session.delete.useMutation();
  const modifySqlStepMut = trpc.sql.modifyStep.useMutation();
  const updateRuleParams = trpc.rules.updateParameters.useMutation();
  const createCustomRuleMut = trpc.rules.createCustom.useMutation();
  const deleteCustomRuleMut = trpc.rules.deleteCustom.useMutation();
  const chatSend = trpc.chat.send.useMutation();

  const refreshLists = useCallback(async () => {
    try {
      const [sessionsRes, sourcesRes] = await Promise.all([
        utils.session.list.fetch(),
        utils.session.listDataSources.fetch(),
      ]);
      setSessionList(
        sessionsRes.sessions.map((s) => ({
          ...s,
          currentPhase: s.currentPhase as CleaningPhase,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
        }))
      );
      setSavedDataSources(
        sourcesRes.dataSources.map((d) => ({
          ...d,
          type: d.type as SavedDataSourceItem["type"],
          updatedAt: d.updatedAt.toISOString(),
        }))
      );
    } catch (err) {
      console.error("Failed to refresh session lists:", err);
    }
  }, [utils]);

  useEffect(() => {
    refreshLists();
  }, [refreshLists]);

  const persistMessage = useCallback(
    async (sid: string, msg: ChatMessage) => {
      try {
        await saveMessageMut.mutateAsync({ sessionId: sid, message: msg });
        await refreshLists();
      } catch (err) {
        console.error("Failed to persist message:", err);
      }
    },
    [saveMessageMut, refreshLists]
  );

  const syncPhase = useCallback(
    async (sid: string, phase: CleaningPhase) => {
      setCurrentPhase(phase);
      try {
        await updatePhaseMut.mutateAsync({ sessionId: sid, phase });
        await refreshLists();
      } catch (err) {
        console.error("Failed to sync phase:", err);
      }
    },
    [updatePhaseMut, refreshLists]
  );

  const pushMessage = useCallback(
    (
      sid: string,
      role: ChatMessage["role"],
      content: string,
      phase: CleaningPhase,
      actions?: ChatMessageAction[]
    ) => {
      const msg: ChatMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        role,
        phase,
        content,
        timestamp: new Date().toISOString(),
        actions,
      };
      setMessages((prev) => [...prev, msg]);
      void persistMessage(sid, msg);
      return msg;
    },
    [persistMessage]
  );

  const addMessage = useCallback(
    (
      role: ChatMessage["role"],
      content: string,
      phase: CleaningPhase = currentPhase,
      actions?: ChatMessageAction[]
    ) => {
      if (sessionId) {
        return pushMessage(sessionId, role, content, phase, actions);
      }
      const msg: ChatMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        role,
        phase,
        content,
        timestamp: new Date().toISOString(),
        actions,
      };
      setMessages((prev) => [...prev, msg]);
      return msg;
    },
    [sessionId, currentPhase, pushMessage]
  );

  const buildRestoredMessages = useCallback(
    (
      _sid: string,
      session: {
        currentPhase: CleaningPhase;
        dataSource?: DataSourceConfig | null;
        targetTable?: string;
        explorationResult?: ExplorationResult | null;
        qualityReport?: QualityReport | null;
        cleaningRules?: CleaningRule[];
        generatedSQL?: SQLGenerationResult | null;
        executionResult?: ExecutionResult | null;
      }
    ): ChatMessage[] => {
      const restored: ChatMessage[] = [];
      const ts = () => new Date().toISOString();
      const mk = (
        role: ChatMessage["role"],
        content: string,
        phase: CleaningPhase,
        actions?: ChatMessageAction[]
      ): ChatMessage => ({
        id: `msg_restore_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        role,
        phase,
        content,
        timestamp: ts(),
        actions,
      });

      if (session.dataSource) {
        const isDbSource = ["mysql", "postgresql", "sqlite", "sqlserver", "oracle"].includes(
          session.dataSource.type
        );
        if (isDbSource && !session.explorationResult) {
          restored.push(
            mk(
              "agent",
              `会话已恢复。数据源：${session.dataSource.name}\n\n${
                session.targetTable
                  ? `已选表：**${session.targetTable}**，可继续探查或查看进度。`
                  : "请点击 **「选择数据表」** 继续。"
              }`,
              "explore",
              session.targetTable
                ? [{ id: "start-explore", label: "开始探查", type: "startExplore" },
                    { id: "run-full-pipeline-table", label: "一键生成SQL", type: "runFullPipeline" }]
                : [{ id: "select-table", label: "选择数据表", type: "selectTable" },
                    {
                      id: "run-full-pipeline-db",
                      label: "整库一键生成SQL",
                      type: "runFullPipeline",
                      disabled: true,
                    }]
            )
          );
        } else if (!session.explorationResult) {
          restored.push(
            mk(
              "agent",
              `会话已恢复。数据源：${session.dataSource.name}\n\n请点击 **「开始探查」** 分析上传的文件。`,
              "explore",
              [{ id: "start-explore", label: "开始探查", type: "startExplore" },
                { id: "run-full-pipeline", label: "一键生成SQL", type: "runFullPipeline" }]
            )
          );
        }
      }

      if (session.explorationResult) {
        const er = session.explorationResult;
        restored.push(
          mk(
            "agent",
            `📊 数据探查完成！\n\n**${er.sourceName}**\n- 总行数：${er.totalRows.toLocaleString()} 行\n- 总列数：${er.totalCols} 列\n- 发现 ${er.issues.length} 个潜在问题`,
            "explore",
            [
              { id: "view-explore", label: "查看探查报告", type: "viewExplore" },
              { id: "start-analysis", label: "进入质量分析", type: "startAnalysis" },
            ]
          )
        );
      }

      if (session.qualityReport) {
        const qr = session.qualityReport;
        const rules = session.cleaningRules ?? [];
        const confirmed = rules.filter((r) => r.status === "confirmed").length;
        const ruleSummary =
          rules.length === 0
            ? "数据质量良好，无需清洗规则。"
            : `已生成 **${rules.length}** 条清洗规则（${confirmed} 条已确认）。`;
        restored.push(
          mk(
            "agent",
            `📈 质量分析完成！\n\n**质量评分：${qr.score.overall}/100**\n\n${ruleSummary}`,
            "confirm",
            [
              { id: "view-quality", label: "查看质量报告", type: "viewQuality" },
              ...(rules.length > 0
                ? [{ id: "view-rules", label: "查看清洗规则", type: "viewRules" as const }]
                : []),
              ...(rules.length === 0 || confirmed < rules.length
                ? [{ id: "confirm-all", label: "确认全部规则", type: "confirmAll" as const }]
                : [{ id: "generate-sql", label: "生成清洗SQL", type: "generateSQL" as const }]),
            ]
          )
        );
      }

      if (session.generatedSQL) {
        restored.push(
          mk(
            "agent",
            `📝 SQL 生成完成！共 ${session.generatedSQL.steps.length} 个步骤，输出表：**${session.generatedSQL.targetTable}**`,
            "generate",
            [{ id: "view-sql", label: "查看清洗SQL", type: "viewSQL" }]
          )
        );
      }

      if (session.executionResult) {
        const er = session.executionResult;
        const statusText =
          er.overallStatus === "success"
            ? "✅ 执行完成！"
            : er.overallStatus === "partial"
            ? "⚠️ 部分步骤执行失败，已进入重试模式。"
            : `❌ 执行失败：${er.error || "未知错误"}`;
        restored.push(mk("agent", statusText, session.currentPhase === "retry" ? "retry" : "execute"));
      }

      return restored;
    },
    []
  );

  const resetSessionState = useCallback(() => {
    setSessionId("");
    setSessionTitle("");
    setDataSourceId("");
    setCurrentPhase("idle");
    setDataSource(null);
    setTargetTable("");
    setExplorationResult(null);
    setQualityReport(null);
    setCleaningRules([]);
    setGeneratedSQL(null);
    setExecutionResult(null);
    setRetryContext(null);
    setMessages([]);
    setRetryCount(0);
    setError(null);
  }, []);

  const loadSession = useCallback(
    async (sid: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const { session, found } = await utils.session.getFull.fetch({ sessionId: sid });
        if (!found || !session) {
          setError("会话不存在或已删除");
          return false;
        }

        setSessionId(session.sessionId);
        setSessionTitle(session.sessionTitle || "");
        setDataSourceId(session.dataSourceId || "");
        setCurrentPhase(session.currentPhase);
        setDataSource(session.dataSource ?? null);
        setTargetTable(session.targetTable || "");
        setExplorationResult(session.explorationResult ?? null);
        setQualityReport(session.qualityReport ?? null);
        setCleaningRules(session.cleaningRules ?? []);
        setGeneratedSQL(session.generatedSQL ?? null);
        setExecutionResult(session.executionResult ?? null);
        setRetryContext(null);
        setRetryCount(session.retryCount);

        let loadedMessages = session.messages;
        if (loadedMessages.length === 0) {
          const restored = buildRestoredMessages(sid, {
            currentPhase: session.currentPhase,
            dataSource: session.dataSource,
            targetTable: session.targetTable,
            explorationResult: session.explorationResult,
            qualityReport: session.qualityReport,
            cleaningRules: session.cleaningRules,
            generatedSQL: session.generatedSQL,
            executionResult: session.executionResult,
          });
          if (restored.length > 0) {
            loadedMessages = restored;
            for (const msg of restored) {
              await saveMessageMut.mutateAsync({ sessionId: sid, message: msg });
            }
          } else if (session.dataSource) {
            const isDbSource = ["mysql", "postgresql", "sqlite", "sqlserver", "oracle"].includes(
              session.dataSource.type
            );
            const welcomeMsg: ChatMessage = {
              id: `msg_restore_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
              role: "agent",
              phase: "explore",
              content: isDbSource
                ? `会话已恢复。数据源：${session.dataSource.name}\n\n请点击 **「选择数据表」**，选好后开始探查。`
                : `会话已恢复。数据源：${session.dataSource.name}\n\n请点击 **「开始探查」** 分析上传的文件。`,
              timestamp: new Date().toISOString(),
              actions: isDbSource
                ? [{ id: "select-table", label: "选择数据表", type: "selectTable" },
                    {
                      id: "run-full-pipeline-db",
                      label: "整库一键生成SQL",
                      type: "runFullPipeline",
                      disabled: true,
                    }]
                : [{ id: "start-explore", label: "开始探查", type: "startExplore" },
                    { id: "run-full-pipeline", label: "一键生成SQL", type: "runFullPipeline" }],
            };
            await saveMessageMut.mutateAsync({ sessionId: sid, message: welcomeMsg });
            loadedMessages = [welcomeMsg];
          }
        }
        setMessages(loadedMessages);

        await refreshLists();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载会话失败");
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [utils, refreshLists, buildRestoredMessages, saveMessageMut]
  );

  const deleteSessionById = useCallback(
    async (sid: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await deleteSessionMut.mutateAsync({ sessionId: sid });
        if (!result.success) {
          setError(result.error || "删除会话失败");
          return false;
        }
        if (sessionId === sid) {
          resetSessionState();
        }
        await refreshLists();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "删除会话失败");
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [deleteSessionMut, sessionId, resetSessionState, refreshLists]
  );

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
    [sessionId, generatedSQL, modifySqlStepMut]
  );

  const welcomeForDataSource = useCallback(
    (sid: string, config: DataSourceConfig) => {
      const isDbSource = ["mysql", "postgresql", "sqlite", "sqlserver", "oracle"].includes(config.type);
      if (isDbSource) {
        pushMessage(
          sid,
          "agent",
          `会话已创建！数据源：${config.name}\n\n请点击 **「选择数据表」**，选好后开始探查。`,
          "explore",
          [{ id: "select-table", label: "选择数据表", type: "selectTable" },
            {
              id: "run-full-pipeline-db",
              label: "整库一键生成SQL",
              type: "runFullPipeline",
              disabled: true,
            }]
        );
      } else {
        pushMessage(
          sid,
          "agent",
          `会话已创建！数据源：${config.name}\n\n请点击 **「开始探查」** 分析上传的文件。`,
          "explore",
          [{ id: "start-explore", label: "开始探查", type: "startExplore" },
            { id: "run-full-pipeline", label: "一键生成SQL", type: "runFullPipeline" }]
        );
      }
    },
    [pushMessage]
  );

  const initSession = useCallback(
    async (config: DataSourceConfig, table?: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await createSession.mutateAsync({
          dataSource: config,
          targetTable: table,
        });
        if (result.success) {
          setSessionId(result.sessionId);
          setDataSource(config);
          setTargetTable(table || "");
          setExplorationResult(null);
          setQualityReport(null);
          setCleaningRules([]);
          setGeneratedSQL(null);
          setExecutionResult(null);
          setRetryContext(null);
          setRetryCount(0);
          setMessages([]);
          await syncPhase(result.sessionId, "explore");
          welcomeForDataSource(result.sessionId, config);
          await refreshLists();
          return result.sessionId;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "创建会话失败");
      } finally {
        setIsLoading(false);
      }
      return null;
    },
    [createSession, syncPhase, welcomeForDataSource, refreshLists]
  );

  const createConversationFromDataSource = useCallback(
    async (sourceId: string, title?: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await createFromDataSource.mutateAsync({
          dataSourceId: sourceId,
          title,
        });
        if (!result.success || !result.sessionId) {
          setError(result.error || "创建对话失败");
          return null;
        }

        const { session, found } = await utils.session.getFull.fetch({
          sessionId: result.sessionId,
        });
        if (!found || !session) {
          setError("加载新对话失败");
          return null;
        }

        setSessionId(session.sessionId);
        setSessionTitle(session.sessionTitle || "");
        setDataSourceId(session.dataSourceId || sourceId);
        setCurrentPhase(session.currentPhase);
        setDataSource(session.dataSource ?? null);
        setTargetTable(session.targetTable || "");
        setExplorationResult(null);
        setQualityReport(null);
        setCleaningRules([]);
        setGeneratedSQL(null);
        setExecutionResult(null);
        setRetryContext(null);
        setRetryCount(0);
        setMessages(session.messages);

        if (session.messages.length === 0 && session.dataSource) {
          welcomeForDataSource(result.sessionId, session.dataSource);
        }

        await refreshLists();
        return result.sessionId;
      } catch (err) {
        setError(err instanceof Error ? err.message : "创建对话失败");
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [createFromDataSource, utils, welcomeForDataSource, refreshLists]
  );

  const saveDataSourceOnly = useCallback(
    async (config: DataSourceConfig) => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await saveDataSourceMut.mutateAsync({ dataSource: config });
        if (result.success) {
          await refreshLists();
          return true;
        }
        setError("保存数据源失败");
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : "保存数据源失败");
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [saveDataSourceMut, refreshLists]
  );

  const startExploration = useCallback(
    async (tableName?: string) => {
      if (!dataSource || !sessionId) return;
      setIsLoading(true);
      setError(null);
      await syncPhase(sessionId, "explore");

      try {
        let result;
        const isDbSource = ["mysql", "postgresql", "sqlite", "sqlserver", "oracle"].includes(
          dataSource.type
        );

        if (isDbSource) {
          if (!dataSource.dbConfig) {
            throw new Error("缺少数据库连接信息，请返回重新连接数据源");
          }
          const table = (tableName ?? targetTable)?.trim();
          if (!table) {
            throw new Error("请先选择要探查的数据表");
          }
          setTargetTable(table);
          result = await exploreDb.mutateAsync({
            sessionId,
            config: dataSource.dbConfig,
            tableName: table,
            limit: 100,
          });
        } else if (dataSource.fileConfig) {
          result = await exploreFile.mutateAsync({
            sessionId,
            filePath: dataSource.fileConfig.filePath,
            fileType: dataSource.fileConfig.fileType,
            previewRows: 100,
          });
        } else {
          throw new Error("无效的数据源配置");
        }

        if (result.success && result.result) {
          setExplorationResult(result.result);
          setSessionTitle(`${(tableName ?? targetTable) || result.result.sourceName} · 探查完成`);
          const issueCount = result.result.issues.length;
          pushMessage(
            sessionId,
            "agent",
            `📊 数据探查完成！\n\n**${result.result.sourceName}**\n- 总行数：${result.result.totalRows.toLocaleString()} 行\n- 总列数：${result.result.totalCols} 列\n- 发现 ${issueCount} 个潜在问题`,
            "explore",
            [
              { id: "view-explore", label: "查看探查报告", type: "viewExplore" },
              { id: "start-analysis", label: "进入质量分析", type: "startAnalysis" },
            ]
          );
          await refreshLists();
        } else {
          setError(result.error || "探查失败");
          pushMessage(sessionId, "agent", `❌ 探查失败：${result.error}`, "explore");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        pushMessage(sessionId, "agent", `❌ 探查错误：${msg}`, "explore");
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, dataSource, targetTable, exploreDb, exploreFile, syncPhase, pushMessage, refreshLists]
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
        const cleanedTarget = dataSource?.fileConfig
          ? dataSource.fileConfig.fileName.replace(/(\.[^.]+)$/, "_cleaned$1")
          : "_cleaned 表";
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
  }, [sessionId, explorationResult, dataSource, analyze, syncPhase, pushMessage, refreshLists]);

  const updateRuleStatus = useCallback(
    async (ruleId: string, status: CleaningRule["status"]) => {
      if (!sessionId) return;
      try {
        await updateRule.mutateAsync({ sessionId, ruleId, status });
        setCleaningRules((prev) => prev.map((r) => (r.id === ruleId ? { ...r, status } : r)));
      } catch (err) {
        console.error("Failed to update rule:", err);
      }
    },
    [sessionId, updateRule]
  );

  const updateRuleParameters = useCallback(
    async (ruleId: string, parameters: Record<string, unknown>) => {
      if (!sessionId) return;
      try {
        const current = cleaningRules.find((r) => r.id === ruleId);
        const mergedParams = { ...current?.parameters, ...parameters };
        const variants = mergedParams.variants as
          | Array<{
              key: string;
              action: CleaningRule["action"];
              name: string;
              strategy: string;
              riskNote?: string;
            }>
          | undefined;
        const selectedKey = mergedParams.selectedVariant as string | undefined;
        const selected = variants?.find((v) => v.key === selectedKey) || variants?.[0];

        await updateRuleParams.mutateAsync({
          sessionId,
          ruleId,
          parameters: mergedParams,
          action: selected?.action,
          strategy: selected?.strategy,
          name: selected?.name,
          riskNote: selected?.riskNote,
        });
        setCleaningRules((prev) =>
          prev.map((r) => {
            if (r.id !== ruleId) return r;
            const mergedVariants = mergedParams.variants as typeof variants;
            const mergedKey = mergedParams.selectedVariant as string;
            const mergedSelected =
              mergedVariants?.find((v) => v.key === mergedKey) || mergedVariants?.[0];
            return {
              ...r,
              parameters: mergedParams,
              ...(mergedSelected
                ? {
                    action: mergedSelected.action,
                    strategy: mergedSelected.strategy,
                    name: mergedSelected.name || r.name,
                    riskNote: mergedSelected.riskNote ?? r.riskNote,
                  }
                : {}),
            };
          })
        );
      } catch (err) {
        console.error("Failed to update rule parameters:", err);
      }
    },
    [sessionId, cleaningRules, updateRuleParams]
  );

  const addCustomRule = useCallback(
    async (input: {
      field: string;
      action: CleaningRule["action"];
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
      riskLevel?: "high" | "medium" | "low";
    }) => {
      if (!sessionId) return false;
      try {
        const result = await createCustomRuleMut.mutateAsync({
          sessionId,
          ...input,
        });
        if (result.success && result.rule) {
          setCleaningRules((prev) => [...prev, result.rule]);
          return true;
        }
        setError("添加自定义规则失败");
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : "添加自定义规则失败");
        return false;
      }
    },
    [sessionId, createCustomRuleMut]
  );

  const deleteCustomRule = useCallback(
    async (ruleId: string) => {
      if (!sessionId) return false;
      try {
        const result = await deleteCustomRuleMut.mutateAsync({ sessionId, ruleId });
        if (result.success) {
          setCleaningRules((prev) => prev.filter((r) => r.id !== ruleId));
          return true;
        }
        setError(result.error || "删除自定义规则失败");
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : "删除自定义规则失败");
        return false;
      }
    },
    [sessionId, deleteCustomRuleMut]
  );

  const confirmAll = useCallback(async () => {
    if (!sessionId) return;
    setIsLoading(true);
    try {
      await confirmAllRules.mutateAsync({ sessionId });
      setCleaningRules((prev) =>
        prev.map((r) =>
          r.status === "pending" || r.status === "confirmed"
            ? { ...r, status: "confirmed" as const }
            : r
        )
      );
      await syncPhase(sessionId, "confirm");
      const cleanedTarget = dataSource?.fileConfig
        ? dataSource.fileConfig.fileName.replace(/(\.[^.]+)$/, "_cleaned$1")
        : "_cleaned 表";
      const successMessage =
        cleaningRules.length === 0
          ? `✅ 数据质量良好，无需清洗规则。现在可以生成清洗方案，输出到 ${cleanedTarget}。`
          : `✅ 已确认 ${cleaningRules.length} 条清洗规则！现在可以生成清洗 SQL。`;
      pushMessage(
        sessionId,
        "agent",
        successMessage,
        "confirm",
        [
          ...(cleaningRules.length > 0
            ? [{ id: "view-rules", label: "查看清洗规则", type: "viewRules" as const }]
            : []),
          { id: "generate-sql", label: "生成清洗SQL", type: "generateSQL" },
        ]
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "确认失败");
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, cleaningRules, dataSource, confirmAllRules, pushMessage, syncPhase]);

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
      const dialect = (
        dataSource.type === "mysql"
          ? "mysql"
          : dataSource.type === "postgresql"
          ? "postgresql"
          : dataSource.type === "sqlite"
          ? "sqlite"
          : dataSource.type === "sqlserver"
          ? "sqlserver"
          : dataSource.type === "oracle"
          ? "oracle"
          : "mysql"
      ) as "mysql" | "postgresql" | "sqlite" | "sqlserver" | "oracle";

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
          ? `输出文件：${dataSource.fileConfig.fileName.replace(/(\.[^.]+)$/, "_cleaned$1")}`
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
  ]);

  const runFullPipelineToSQL = useCallback(
    async (tableName?: string): Promise<boolean> => {
      if (!dataSource || !sessionId) return false;

      setIsPipelineRunning(true);
      setIsLoading(true);
      setError(null);

      try {
        await syncPhase(sessionId, "explore");

        let exploration: ExplorationResult | null = null;
        const isDbSource = ["mysql", "postgresql", "sqlite", "sqlserver", "oracle"].includes(
          dataSource.type
        );
        let resolvedTable = (tableName ?? targetTable)?.trim() || "";

        if (isDbSource) {
          if (!dataSource.dbConfig) {
            throw new Error("缺少数据库连接信息，请返回重新连接数据源");
          }
          if (!resolvedTable) {
            throw new Error("请先选择要探查的数据表");
          }
          setTargetTable(resolvedTable);
          const exploreResult = await exploreDb.mutateAsync({
            sessionId,
            config: dataSource.dbConfig,
            tableName: resolvedTable,
            limit: 100,
          });
          if (!exploreResult.success || !exploreResult.result) {
            throw new Error(exploreResult.error || "探查失败");
          }
          exploration = exploreResult.result;
        } else if (dataSource.fileConfig) {
          const exploreResult = await exploreFile.mutateAsync({
            sessionId,
            filePath: dataSource.fileConfig.filePath,
            fileType: dataSource.fileConfig.fileType,
            previewRows: 100,
          });
          if (!exploreResult.success || !exploreResult.result) {
            throw new Error(exploreResult.error || "探查失败");
          }
          exploration = exploreResult.result;
          resolvedTable =
            dataSource.fileConfig.fileName.replace(/\.[^.]+$/, "") || exploration.sourceName;
        } else {
          throw new Error("无效的数据源配置");
        }

        setExplorationResult(exploration);
        setSessionTitle(`${resolvedTable || exploration.sourceName} · 一键生成SQL`);
        pushMessage(
          sessionId,
          "agent",
          `📊 数据探查完成！\n\n**${exploration.sourceName}**\n- 总行数：${exploration.totalRows.toLocaleString()} 行\n- 总列数：${exploration.totalCols} 列\n- 发现 ${exploration.issues.length} 个潜在问题`,
          "explore",
          [
            { id: "view-explore", label: "查看探查报告", type: "viewExplore" },
            { id: "start-analysis", label: "进入质量分析", type: "startAnalysis" },
          ]
        );

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
        const dialect = (
          dataSource.type === "mysql"
            ? "mysql"
            : dataSource.type === "postgresql"
            ? "postgresql"
            : dataSource.type === "sqlite"
            ? "sqlite"
            : dataSource.type === "sqlserver"
            ? "sqlserver"
            : dataSource.type === "oracle"
            ? "oracle"
            : "mysql"
        ) as "mysql" | "postgresql" | "sqlite" | "sqlserver" | "oracle";

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
          columns: exploration.schema.map((c) => c.name),
        });

        if (!sqlResult.success || !sqlResult.result) {
          throw new Error(sqlResult.error || "SQL生成失败");
        }

        setGeneratedSQL(sqlResult.result);
        const fileHint = dataSource.fileConfig
          ? `输出文件：${dataSource.fileConfig.fileName.replace(/(\.[^.]+)$/, "_cleaned$1")}`
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

        const dialect = (
          dataSource.type === "mysql"
            ? "mysql"
            : dataSource.type === "postgresql"
            ? "postgresql"
            : dataSource.type === "sqlite"
            ? "sqlite"
            : dataSource.type === "sqlserver"
            ? "sqlserver"
            : dataSource.type === "oracle"
            ? "oracle"
            : "mysql"
        ) as "mysql" | "postgresql" | "sqlite" | "sqlserver" | "oracle";

        const result = await execute.mutateAsync({
          sessionId,
          steps: generatedSQL.steps,
          dbConfig: dataSource.dbConfig,
          dialect,
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
    ]
  );

  const handleRetry = useCallback(
    async (errorMessage: string, failedStep: SQLGenerationResult["steps"][0]) => {
      try {
        const result = await getRetryCtx.mutateAsync({
          errorMessage,
          failedStep: {
            stepNumber: failedStep.stepNumber,
            name: failedStep.name,
            operationType: failedStep.operationType,
            sql: failedStep.sql,
            affectedRows: failedStep.affectedRows,
            riskLevel: failedStep.riskLevel,
          },
          retryCount,
        });

        if (result.success && result.context) {
          setRetryContext(result.context);
          setRetryCount((c) => c + 1);
        }
      } catch (err) {
        console.error("Failed to get retry context:", err);
      }
    },
    [retryCount, getRetryCtx]
  );

  const sendChatMessage = useCallback(
    async (userMessage: string) => {
      const confirmedRulesCount = cleaningRules.filter((r) => r.status === "confirmed").length;
      const context = {
        phase: currentPhase,
        dataSourceName: dataSource?.name,
        targetTable: targetTable || undefined,
        hasExploration: !!explorationResult,
        hasQualityReport: !!qualityReport,
        rulesCount: cleaningRules.length,
        confirmedRulesCount,
        hasGeneratedSQL: !!generatedSQL,
        hasExecutionResult: !!executionResult,
      };

      const history = [
        ...messages
          .filter((m) => m.role === "user" || m.role === "agent")
          .slice(-7)
          .map((m) => ({
            role: (m.role === "agent" ? "assistant" : "user") as "user" | "assistant",
            content: m.content,
          })),
        { role: "user" as const, content: userMessage },
      ];

      try {
        const result = await chatSend.mutateAsync({
          sessionId: sessionId || undefined,
          userMessage,
          context,
          history,
        });

        const actions: ChatMessageAction[] = result.action
          ? [result.action as ChatMessageAction]
          : [];

        if (sessionId) {
          pushMessage(sessionId, "agent", result.message, currentPhase, actions);
        } else {
          addMessage("agent", result.message, currentPhase, actions);
        }

        if (sessionId && result.ruleUpdatesApplied && result.ruleUpdatesApplied > 0) {
          try {
            const full = await utils.session.getFull.fetch({ sessionId });
            if (full.found && full.session?.cleaningRules?.length) {
              setCleaningRules(full.session.cleaningRules);
            } else {
              const rulesRes = await utils.rules.getBySession.fetch({ sessionId });
              if (rulesRes.rules?.length) {
                setCleaningRules(
                  rulesRes.rules.map((r) => ({
                    id: r.ruleId,
                    index: r.ruleIndex,
                    name: r.name,
                    field: r.field,
                    action: r.action as CleaningRule["action"],
                    issueDescription: r.issueDescription || undefined,
                    strategy: r.strategy || undefined,
                    affectedRows: r.affectedRows,
                    affectedPercent: parseFloat(String(r.affectedPercent || "0")),
                    parameters: (r.parameters as Record<string, unknown>) || {},
                    status: r.status as CleaningRule["status"],
                    preview: r.preview as CleaningRule["preview"],
                    riskNote: r.riskNote || undefined,
                  }))
                );
              }
            }
          } catch (refreshErr) {
            console.error("Failed to refresh rules after NL update:", refreshErr);
          }
        }

        return {
          action: result.action as ChatMessageAction | undefined,
          autoTrigger: result.autoTrigger,
          usedLlm: result.usedLlm,
          ruleUpdatesApplied: result.ruleUpdatesApplied ?? 0,
        };
      } catch (err) {
        const fallback =
          "对话服务暂时不可用，请使用消息下方的快捷按钮继续操作。";
        if (sessionId) {
          pushMessage(sessionId, "agent", fallback, currentPhase);
        } else {
          addMessage("agent", fallback, currentPhase);
        }
        console.error("Chat send failed:", err);
        return { action: undefined, autoTrigger: false, usedLlm: false, ruleUpdatesApplied: 0 };
      }
    },
    [
      sessionId,
      currentPhase,
      dataSource,
      targetTable,
      explorationResult,
      qualityReport,
      cleaningRules,
      generatedSQL,
      executionResult,
      messages,
      chatSend,
      pushMessage,
      addMessage,
      utils.rules.getBySession,
      utils.session.getFull,
    ]
  );

  const applyManualFix = useCallback(
    async (stepNumber: number, modifiedSql: string) => {
      if (!sessionId || !generatedSQL) return;
      setIsLoading(true);
      try {
        const result = await applyFix.mutateAsync({
          sessionId,
          steps: generatedSQL.steps,
          stepNumber,
          modifiedSql,
        });

        if (result.success && result.steps) {
          setGeneratedSQL((prev) => (prev ? { ...prev, steps: result.steps! } : null));
          pushMessage(sessionId, "agent", "✅ SQL已手动修正，请重新审查后执行。", "retry");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "应用修正失败");
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, generatedSQL, applyFix, pushMessage]
  );

  return {
    sessionId,
    sessionTitle,
    dataSourceId,
    currentPhase,
    dataSource,
    targetTable,
    explorationResult,
    qualityReport,
    cleaningRules,
    generatedSQL,
    executionResult,
    retryContext,
    messages,
    sessionList,
    savedDataSources,
    isLoading,
    isPipelineRunning,
    error,
    retryCount,

    initSession,
    loadSession,
    deleteSessionById,
    createConversationFromDataSource,
    saveDataSourceOnly,
    resetSessionState,
    refreshLists,
    startExploration,
    startAnalysis,
    runFullPipelineToSQL,
    updateRuleStatus,
    updateRuleParameters,
    addCustomRule,
    deleteCustomRule,
    sendChatMessage,
    confirmAll,
    generateCleaningSQL,
    executeSQL,
    handleRetry,
    applyManualFix,
    addMessage,
    setCurrentPhase,
    setTargetTable,
    setDataSource,
    setError,
    setMessages,
    setGeneratedSQL,
    modifySQLStep,
  };
}
