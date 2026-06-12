import { useCallback, useEffect } from "react";
import type { DataSourceConfig, ChatMessage } from "@contracts/types";
import type { CleaningSessionState } from "./cleaningSessionState";
import { isDbSourceType } from "./cleaningSessionState";
import type { ChatApi } from "./useChat";
import type { PipelineRunSnapshot } from "@/lib/pipelineRunDiff";
import {
  isFileDataSource,
  isSessionScopeLocked,
  needsNewSessionForTable,
  resolveSessionScope,
} from "@/lib/sessionScope";

/** 会话 CRUD、列表、选择、删除 */
export function useSessionList(state: CleaningSessionState, chat: ChatApi) {
  const {
    sessionId,
    dataSourceId,
    dataSource,
    targetTable,
    setSessionId,
    setSessionTitle,
    setDataSourceId,
    setCurrentPhase,
    setDataSource,
    setTargetTable,
    setExplorationResult,
    setQualityReport,
    setCleaningRules,
    setGeneratedSQL,
    setExecutionResult,
    setExecutionHistory,
    setRetryContext,
    setMessages,
    retryCount,
    currentRunIndex,
    viewingRunIndex,
    setRetryCount,
    setCurrentRunIndex,
    setViewingRunIndex,
    setPipelineRuns,
    setCompareRunSnapshot,
    viewingRevisionIndex,
    setViewingRevisionIndex,
    latestRevisionIndex,
    setLatestRevisionIndex,
    setIsLoading,
    setError,
    mutations: {
      createSession,
      createFromDataSource,
      saveDataSourceMut,
      saveMessageMut,
      deleteSessionMut,
      deleteDataSourceMut,
      updateTargetTableMut,
      resetPipelineMut,
    },
    utils,
    refreshLists,
    syncPhase,
    resetSessionState,
  } = state;

  const { pushMessage, buildRestoredMessages } = chat;

  /** 加载对比基准 run（viewingRunIndex - 1）快照 */
  const loadCompareRunSnapshot = useCallback(
    async (sid: string, runIndex: number): Promise<PipelineRunSnapshot | null> => {
      if (runIndex <= 1) return null;
      const { session, found } = await utils.session.getFull.fetch({
        sessionId: sid,
        runIndex: runIndex - 1,
      });
      if (!found || !session) return null;
      return {
        qualityReport: session.qualityReport ?? null,
        cleaningRules: session.cleaningRules ?? [],
        generatedSQL: session.generatedSQL ?? null,
      };
    },
    [utils]
  );

  useEffect(() => {
    refreshLists();
  }, [refreshLists]);

  const welcomeForDataSource = useCallback(
    (
      sid: string,
      config: DataSourceConfig,
      mode: "normal" | "retry" = "normal",
      boundTargetTable?: string
    ) => {
      const isDbSource = isDbSourceType(config.type);
      const tableBound = !!boundTargetTable?.trim();
      if (mode === "retry") {
        if (isDbSource && !tableBound) {
          pushMessage(
            sid,
            "agent",
            "已在本对话中开始新一轮清洗（历史结果已保留）。请点击 **「选择数据表」**，选中表后点击 **「重新探查」** 或 **「一键生成SQL」**。",
            "explore",
            [{ id: "select-table", label: "选择数据表", type: "selectTable" }]
          );
          return;
        }
        const scopeHint =
          isDbSource && tableBound
            ? `数据表：**${boundTargetTable}**\n\n`
            : "";
        pushMessage(
          sid,
          "agent",
          `已在本对话中开始第 ${boundTargetTable ? "新一轮" : "新一次"}清洗（历史结果已保留）。${scopeHint}请点击 **「重新探查」** 或 **「一键生成SQL」** 继续。`,
          "explore",
          [
            { id: "start-explore", label: "重新探查", type: "startExplore" },
            { id: "run-full-pipeline", label: "一键生成SQL", type: "runFullPipeline" },
          ]
        );
        return;
      }
      if (isDbSource) {
        pushMessage(
          sid,
          "agent",
          `会话已创建！数据源：${config.name}\n\n请点击 **「选择数据表」**，选中表后点击 **「开始探查」** 或 **「一键生成SQL」**（单表）。\n\n**整库一键生成SQL** 将批量为库内各表创建会话并生成 SQL（默认最多 10 张表）。`,
          "explore",
          [
            { id: "select-table", label: "选择数据表", type: "selectTable" },
            {
              id: "run-full-pipeline-db",
              label: "整库一键生成SQL",
              type: "runFullPipeline",
            },
          ]
        );
      } else {
        pushMessage(
          sid,
          "agent",
          `会话已创建！数据源：${config.name}\n\n文件已就绪。点击 **「开始探查」** 查看质量报告，或 **「一键生成SQL」** 直接生成清洗方案（不执行）。`,
          "explore",
          [
            { id: "start-explore", label: "开始探查", type: "startExplore" },
            { id: "run-full-pipeline", label: "一键生成SQL", type: "runFullPipeline" },
          ]
        );
      }
    },
    [pushMessage]
  );

  const applyLoadedSession = useCallback(
    (
      session: NonNullable<Awaited<ReturnType<typeof utils.session.getFull.fetch>>["session"]>,
      options?: { resetPipeline?: boolean }
    ) => {
      setSessionId(session.sessionId);
      setSessionTitle(session.sessionTitle || "");
      setDataSourceId(session.dataSourceId || "");
      setCurrentPhase(session.currentPhase);
      setDataSource(session.dataSource ?? null);
      setTargetTable(session.targetTable || "");
      setCurrentRunIndex(session.currentRunIndex ?? 1);
      setViewingRunIndex(session.viewingRunIndex ?? session.currentRunIndex ?? 1);
      setPipelineRuns(session.pipelineRuns ?? []);
      if (options?.resetPipeline) {
        setExplorationResult(null);
        setQualityReport(null);
        setCleaningRules([]);
        setGeneratedSQL(null);
        setExecutionResult(null);
        setExecutionHistory([]);
        setRetryContext(null);
        setRetryCount(0);
        setViewingRevisionIndex(null);
        setLatestRevisionIndex(0);
      } else {
        setExplorationResult(session.explorationResult ?? null);
        setQualityReport(session.qualityReport ?? null);
        setCleaningRules(session.cleaningRules ?? []);
        setGeneratedSQL(session.generatedSQL ?? null);
        setExecutionResult(session.executionResult ?? null);
        setExecutionHistory(session.executionHistory ?? []);
        setRetryContext(null);
        setRetryCount(session.retryCount);
        setViewingRevisionIndex(null);
        setLatestRevisionIndex(session.latestRevisionIndex ?? 0);
      }
    },
    [
      setSessionId,
      setSessionTitle,
      setDataSourceId,
      setCurrentPhase,
      setDataSource,
      setTargetTable,
      setCurrentRunIndex,
      setViewingRunIndex,
      setPipelineRuns,
      setExplorationResult,
      setQualityReport,
      setCleaningRules,
      setGeneratedSQL,
      setExecutionResult,
      setExecutionHistory,
      setRetryContext,
      setRetryCount,
      setViewingRevisionIndex,
      setLatestRevisionIndex,
    ]
  );

  const switchPipelineRevision = useCallback(
    async (revisionIndex: number, runIndex: number): Promise<boolean> => {
      if (!sessionId) return false;
      if (revisionIndex <= 0) return true;

      const effectiveViewing =
        viewingRevisionIndex ?? (latestRevisionIndex > 0 ? latestRevisionIndex : null);
      if (effectiveViewing === revisionIndex) return true;

      setIsLoading(true);
      setError(null);
      try {
        const { found, snapshot } = await utils.snapshot.get.fetch({
          sessionId,
          runIndex,
          revisionIndex,
        });
        if (!found || !snapshot) {
          setError("加载里程碑快照失败");
          return false;
        }
        setCleaningRules(snapshot.cleaningRules);
        setGeneratedSQL(snapshot.generatedSQL ?? null);
        setViewingRevisionIndex(revisionIndex);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "切换里程碑版本失败");
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [
      sessionId,
      viewingRevisionIndex,
      latestRevisionIndex,
      utils,
      setCleaningRules,
      setGeneratedSQL,
      setViewingRevisionIndex,
      setIsLoading,
      setError,
    ]
  );

  const switchToLiveRevision = useCallback(
    async (runIndex: number): Promise<boolean> => {
      if (!sessionId) return false;
      if (viewingRevisionIndex == null) return true;

      setIsLoading(true);
      setError(null);
      try {
        const { session, found } = await utils.session.getFull.fetch({
          sessionId,
          runIndex,
        });
        if (!found || !session) {
          setError("加载当前版本失败");
          return false;
        }
        setCleaningRules(session.cleaningRules ?? []);
        setGeneratedSQL(session.generatedSQL ?? null);
        setViewingRevisionIndex(null);
        if (session.latestRevisionIndex != null) {
          setLatestRevisionIndex(session.latestRevisionIndex);
        }
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "返回最新版本失败");
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [
      sessionId,
      viewingRevisionIndex,
      utils,
      setCleaningRules,
      setGeneratedSQL,
      setViewingRevisionIndex,
      setLatestRevisionIndex,
      setIsLoading,
      setError,
    ]
  );

  const selectSessionTargetTable = useCallback(
    async (table: string): Promise<"ok" | "unchanged" | "needs_new_session"> => {
      if (!sessionId || !table.trim()) return "needs_new_session";
      if (isFileDataSource(dataSource)) return "needs_new_session";

      const scope = resolveSessionScope({
        targetTable,
        filePath: dataSource?.fileConfig?.filePath,
        fileName: dataSource?.fileConfig?.fileName,
      });

      if (needsNewSessionForTable(targetTable, table, scope)) {
        return "needs_new_session";
      }
      if (targetTable === table) return "unchanged";

      try {
        const result = await updateTargetTableMut.mutateAsync({ sessionId, targetTable: table });
        if (!result.success) {
          setError(result.error || "绑定数据表失败");
          return "needs_new_session";
        }
        setTargetTable(table);
        return "ok";
      } catch (err) {
        setError(err instanceof Error ? err.message : "绑定数据表失败");
        return "needs_new_session";
      }
    },
    [
      sessionId,
      dataSource,
      targetTable,
      updateTargetTableMut,
      setTargetTable,
      setError,
    ]
  );

  const retryInPlace = useCallback(async (): Promise<boolean> => {
    if (!sessionId) {
      setError("无法重试：当前没有活动会话");
      return false;
    }
    if (!dataSource) {
      setError("无法重试：当前会话未关联数据源");
      return false;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await resetPipelineMut.mutateAsync({ sessionId });
      if (!result.success) {
        setError(result.error || "开始新一轮清洗失败");
        return false;
      }

      const newRunIndex = result.runIndex ?? (currentRunIndex + 1);
      setCurrentRunIndex(newRunIndex);
      setViewingRunIndex(newRunIndex);
      setRetryCount(result.retryCount ?? retryCount + 1);
      setPipelineRuns((prev) => [
        ...prev,
        {
          runIndex: newRunIndex,
          createdAt: new Date().toISOString(),
        },
      ]);

      // 新一轮 run 尚无产物，清空当前视图（历史 run 可通过切换器查看）
      setExplorationResult(null);
      setQualityReport(null);
      setCleaningRules([]);
      setGeneratedSQL(null);
      setExecutionResult(null);
      setRetryContext(null);
      setCurrentPhase("explore");
      setViewingRevisionIndex(null);
      setLatestRevisionIndex(0);

      welcomeForDataSource(sessionId, dataSource, "retry", targetTable);
      await refreshLists();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "开始新一轮清洗失败");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [
    sessionId,
    dataSource,
    targetTable,
    currentRunIndex,
    retryCount,
    resetPipelineMut,
    welcomeForDataSource,
    refreshLists,
    setExplorationResult,
    setQualityReport,
    setCleaningRules,
    setGeneratedSQL,
    setExecutionResult,
    setRetryContext,
    setRetryCount,
    setCurrentRunIndex,
    setViewingRunIndex,
    setPipelineRuns,
    setMessages,
    setCurrentPhase,
    setIsLoading,
    setError,
  ]);

  const switchPipelineRun = useCallback(
    async (runIndex: number): Promise<boolean> => {
      if (!sessionId || runIndex === viewingRunIndex) return true;
      setIsLoading(true);
      setError(null);
      try {
        const { session, found } = await utils.session.getFull.fetch({
          sessionId,
          runIndex,
        });
        if (!found || !session) {
          setError("加载运行版本失败");
          return false;
        }
        setViewingRunIndex(runIndex);
        setViewingRevisionIndex(null);
        if (session.latestRevisionIndex != null) {
          setLatestRevisionIndex(session.latestRevisionIndex);
        }
        setExplorationResult(session.explorationResult ?? null);
        setQualityReport(session.qualityReport ?? null);
        setCleaningRules(session.cleaningRules ?? []);
        setGeneratedSQL(session.generatedSQL ?? null);
        setExecutionResult(session.executionResult ?? null);
        setExecutionHistory(session.executionHistory ?? []);
        setPipelineRuns(session.pipelineRuns ?? []);
        setCompareRunSnapshot(null);
        void loadCompareRunSnapshot(session.sessionId, runIndex).then(setCompareRunSnapshot);
        setCurrentRunIndex(session.currentRunIndex ?? currentRunIndex);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "切换运行版本失败");
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [
      sessionId,
      viewingRunIndex,
      currentRunIndex,
      utils,
      setViewingRunIndex,
      setExplorationResult,
      setQualityReport,
      setCleaningRules,
      setGeneratedSQL,
      setExecutionResult,
      setPipelineRuns,
      setCurrentRunIndex,
      setCompareRunSnapshot,
      loadCompareRunSnapshot,
      setIsLoading,
      setError,
    ]
  );

  const retryWithNewSession = useCallback(async (): Promise<{
    sessionId: string;
    isFileSource: boolean;
  } | null> => {
    if (!dataSourceId) {
      setError("无法重试：当前会话未关联数据源");
      return null;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await createFromDataSource.mutateAsync({ dataSourceId });
      if (!result.success || !result.sessionId) {
        setError(result.error || "创建新对话失败");
        return null;
      }

      const { session, found } = await utils.session.getFull.fetch({
        sessionId: result.sessionId,
      });
      if (!found || !session) {
        setError("加载新对话失败");
        return null;
      }

      applyLoadedSession(session, { resetPipeline: true });
      setMessages([]);

      if (session.dataSource) {
        welcomeForDataSource(result.sessionId, session.dataSource, "retry", session.targetTable || "");
      }

      await refreshLists();
      const isFileSource = isFileDataSource(session.dataSource);
      return { sessionId: result.sessionId, isFileSource };
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建新对话失败");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [
    dataSourceId,
    createFromDataSource,
    utils,
    applyLoadedSession,
    welcomeForDataSource,
    refreshLists,
    setMessages,
    setIsLoading,
    setError,
  ]);

  /** 打开选表弹窗前检查会话范围；已锁定则自动新建会话 */
  const requestOpenTableSelect = useCallback(async (): Promise<"open" | "file" | "new_session"> => {
    if (isFileDataSource(dataSource)) {
      return "file";
    }
    const locked = isSessionScopeLocked({
      targetTable,
      filePath: dataSource?.fileConfig?.filePath,
      fileName: dataSource?.fileConfig?.fileName,
    });
    if (locked && targetTable) {
      const created = await retryWithNewSession();
      return created ? "new_session" : "open";
    }
    return "open";
  }, [dataSource, targetTable, retryWithNewSession]);

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
        setExecutionHistory(session.executionHistory ?? []);
        setRetryContext(null);
        setRetryCount(session.retryCount);
        setCurrentRunIndex(session.currentRunIndex ?? 1);
        setViewingRunIndex(session.viewingRunIndex ?? session.currentRunIndex ?? 1);
        setViewingRevisionIndex(null);
        setLatestRevisionIndex(session.latestRevisionIndex ?? 0);
        setPipelineRuns(session.pipelineRuns ?? []);
        void loadCompareRunSnapshot(
          session.sessionId,
          session.viewingRunIndex ?? session.currentRunIndex ?? 1
        ).then(setCompareRunSnapshot);

        let loadedMessages = session.messages;
        if (loadedMessages.length === 0) {
          const effectiveRunIndex = session.currentRunIndex ?? 1;
          const restored = buildRestoredMessages(
            sid,
            {
              currentPhase: session.currentPhase,
              dataSource: session.dataSource,
              targetTable: session.targetTable,
              explorationResult: session.explorationResult,
              qualityReport: session.qualityReport,
              cleaningRules: session.cleaningRules,
              generatedSQL: session.generatedSQL,
              executionResult: session.executionResult,
            },
            effectiveRunIndex
          );
          if (restored.length > 0) {
            loadedMessages = restored;
            for (const msg of restored) {
              await saveMessageMut.mutateAsync({ sessionId: sid, message: msg });
            }
          } else if (session.dataSource) {
            const isDbSource = isDbSourceType(session.dataSource.type);
            const welcomeMsg: ChatMessage = {
              id: `msg_restore_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
              role: "agent",
              phase: "explore",
              content: isDbSource
                ? `会话已恢复。数据源：${session.dataSource.name}\n\n请点击 **「选择数据表」**，选中表后点击 **「开始探查」** 或 **「一键生成SQL」**。`
                : `会话已恢复。数据源：${session.dataSource.name}\n\n点击 **「开始探查」** 查看质量报告，或 **「一键生成SQL」** 直接生成清洗方案。`,
              timestamp: new Date().toISOString(),
              actions: isDbSource
                ? [
                    { id: "select-table", label: "选择数据表", type: "selectTable" },
                    {
                      id: "run-full-pipeline-db",
                      label: "整库一键生成SQL",
                      type: "runFullPipeline",
                    },
                  ]
                : [
                    { id: "start-explore", label: "开始探查", type: "startExplore" },
                    { id: "run-full-pipeline", label: "一键生成SQL", type: "runFullPipeline" },
                  ],
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
    [
      utils,
      refreshLists,
      buildRestoredMessages,
      saveMessageMut,
      setSessionId,
      setSessionTitle,
      setDataSourceId,
      setCurrentPhase,
      setDataSource,
      setTargetTable,
      setExplorationResult,
      setQualityReport,
      setCleaningRules,
      setGeneratedSQL,
      setExecutionResult,
      setExecutionHistory,
      setRetryContext,
      setRetryCount,
      setMessages,
      setIsLoading,
      setError,
    ]
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
    [deleteSessionMut, sessionId, resetSessionState, refreshLists, setIsLoading, setError]
  );

  const deleteDataSourceById = useCallback(
    async (sourceId: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await deleteDataSourceMut.mutateAsync({ dataSourceId: sourceId });
        if (!result.success) {
          setError(result.error || "删除数据源失败");
          return false;
        }
        if (dataSourceId === sourceId) {
          setDataSourceId("");
        }
        await refreshLists();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "删除数据源失败");
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [
      deleteDataSourceMut,
      dataSourceId,
      setDataSourceId,
      refreshLists,
      setIsLoading,
      setError,
    ]
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
        setExecutionHistory([]);
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
    [
      createSession,
      syncPhase,
      welcomeForDataSource,
      refreshLists,
      setSessionId,
      setDataSource,
      setTargetTable,
      setExplorationResult,
      setQualityReport,
      setCleaningRules,
      setGeneratedSQL,
      setExecutionResult,
      setExecutionHistory,
      setRetryContext,
      setRetryCount,
      setMessages,
      setIsLoading,
      setError,
    ]
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
        setExecutionHistory([]);
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
    [
      createFromDataSource,
      utils,
      welcomeForDataSource,
      refreshLists,
      setSessionId,
      setSessionTitle,
      setDataSourceId,
      setCurrentPhase,
      setDataSource,
      setTargetTable,
      setExplorationResult,
      setQualityReport,
      setCleaningRules,
      setGeneratedSQL,
      setExecutionResult,
      setExecutionHistory,
      setRetryContext,
      setRetryCount,
      setMessages,
      setIsLoading,
      setError,
    ]
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
    [saveDataSourceMut, refreshLists, setIsLoading, setError]
  );

  const restartFromTableSelection = useCallback(async () => {
    return retryInPlace();
  }, [retryInPlace]);

  return {
    loadSession,
    deleteSessionById,
    deleteDataSourceById,
    initSession,
    createConversationFromDataSource,
    saveDataSourceOnly,
    resetSessionState,
    refreshLists,
    restartFromTableSelection,
    retryInPlace,
    switchPipelineRun,
    switchPipelineRevision,
    switchToLiveRevision,
    retryWithNewSession,
    selectSessionTargetTable,
    requestOpenTableSelect,
  };
}
