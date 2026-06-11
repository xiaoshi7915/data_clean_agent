import { useCallback, useEffect } from "react";
import type { DataSourceConfig, ChatMessage } from "@contracts/types";
import type { CleaningSessionState } from "./cleaningSessionState";
import { isDbSourceType } from "./cleaningSessionState";
import type { ChatApi } from "./useChat";

/** 会话 CRUD、列表、选择、删除 */
export function useSessionList(state: CleaningSessionState, chat: ChatApi) {
  const {
    sessionId,
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
    setRetryContext,
    setMessages,
    setRetryCount,
    setIsLoading,
    setError,
    mutations: { createSession, createFromDataSource, saveDataSourceMut, saveMessageMut, deleteSessionMut },
    utils,
    refreshLists,
    syncPhase,
    resetSessionState,
  } = state;

  const { pushMessage, buildRestoredMessages } = chat;

  useEffect(() => {
    refreshLists();
  }, [refreshLists]);

  const welcomeForDataSource = useCallback(
    (sid: string, config: DataSourceConfig) => {
      const isDbSource = isDbSourceType(config.type);
      if (isDbSource) {
        pushMessage(
          sid,
          "agent",
          `会话已创建！数据源：${config.name}\n\n请点击 **「选择数据表」**，选好后开始探查。`,
          "explore",
          [
            { id: "select-table", label: "选择数据表", type: "selectTable" },
            {
              id: "run-full-pipeline-db",
              label: "整库一键生成SQL",
              type: "runFullPipeline",
              disabled: true,
            },
          ]
        );
      } else {
        pushMessage(
          sid,
          "agent",
          `会话已创建！数据源：${config.name}\n\n请点击 **「开始探查」** 分析上传的文件。`,
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
            const isDbSource = isDbSourceType(session.dataSource.type);
            const welcomeMsg: ChatMessage = {
              id: `msg_restore_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
              role: "agent",
              phase: "explore",
              content: isDbSource
                ? `会话已恢复。数据源：${session.dataSource.name}\n\n请点击 **「选择数据表」**，选好后开始探查。`
                : `会话已恢复。数据源：${session.dataSource.name}\n\n请点击 **「开始探查」** 分析上传的文件。`,
              timestamp: new Date().toISOString(),
              actions: isDbSource
                ? [
                    { id: "select-table", label: "选择数据表", type: "selectTable" },
                    {
                      id: "run-full-pipeline-db",
                      label: "整库一键生成SQL",
                      type: "runFullPipeline",
                      disabled: true,
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

  return {
    loadSession,
    deleteSessionById,
    initSession,
    createConversationFromDataSource,
    saveDataSourceOnly,
    resetSessionState,
    refreshLists,
  };
}
