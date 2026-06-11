import { useState, useCallback } from "react";
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
  SessionListItem,
  SavedDataSourceItem,
} from "@contracts/types";

/** 数据库类数据源类型列表 */
export const DB_SOURCE_TYPES = [
  "mysql",
  "postgresql",
  "sqlite",
  "sqlserver",
  "oracle",
] as const;

export function isDbSourceType(type: string): boolean {
  return (DB_SOURCE_TYPES as readonly string[]).includes(type);
}

/** 共享会话状态与 tRPC mutations */
export function useCleaningSessionState() {
  const [sessionId, setSessionId] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [dataSourceId, setDataSourceId] = useState("");
  const [currentPhase, setCurrentPhase] = useState<CleaningPhase>("idle");
  const [dataSource, setDataSource] = useState<DataSourceConfig | null>(null);
  const [targetTable, setTargetTable] = useState("");
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
  const verifySQL = trpc.sql.verify.useMutation();
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
  const importContractMut = trpc.contract.importContract.useMutation();
  const exportBundleMut = trpc.artifact.exportBundle.useMutation();

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

  return {
    sessionId,
    setSessionId,
    sessionTitle,
    setSessionTitle,
    dataSourceId,
    setDataSourceId,
    currentPhase,
    setCurrentPhase,
    dataSource,
    setDataSource,
    targetTable,
    setTargetTable,
    explorationResult,
    setExplorationResult,
    qualityReport,
    setQualityReport,
    cleaningRules,
    setCleaningRules,
    generatedSQL,
    setGeneratedSQL,
    executionResult,
    setExecutionResult,
    retryContext,
    setRetryContext,
    messages,
    setMessages,
    sessionList,
    savedDataSources,
    isLoading,
    setIsLoading,
    isPipelineRunning,
    setIsPipelineRunning,
    error,
    setError,
    retryCount,
    setRetryCount,
    utils,
    mutations: {
      createSession,
      createFromDataSource,
      saveDataSourceMut,
      saveMessageMut,
      updatePhaseMut,
      exploreDb,
      exploreFile,
      analyze,
      updateRule,
      confirmAllRules,
      generateSQL,
      verifySQL,
      execute,
      executeFile,
      getRetryCtx,
      applyFix,
      deleteSessionMut,
      modifySqlStepMut,
      updateRuleParams,
      createCustomRuleMut,
      deleteCustomRuleMut,
      chatSend,
      importContractMut,
      exportBundleMut,
    },
    refreshLists,
    syncPhase,
    resetSessionState,
  };
}

export type CleaningSessionState = ReturnType<typeof useCleaningSessionState>;
