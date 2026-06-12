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
  PipelineRunSummary,
} from "@contracts/types";
import type { PipelineRunSnapshot } from "@/lib/pipelineRunDiff";

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
  const [executionHistory, setExecutionHistory] = useState<ExecutionResult[]>([]);
  const [retryContext, setRetryContext] = useState<RetryContext | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionList, setSessionList] = useState<SessionListItem[]>([]);
  const [savedDataSources, setSavedDataSources] = useState<SavedDataSourceItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPipelineRunning, setIsPipelineRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [currentRunIndex, setCurrentRunIndex] = useState(1);
  const [viewingRunIndex, setViewingRunIndex] = useState(1);
  const [pipelineRuns, setPipelineRuns] = useState<PipelineRunSummary[]>([]);
  /** 对比基准 run 快照（通常为 viewingRunIndex - 1） */
  const [compareRunSnapshot, setCompareRunSnapshot] = useState<PipelineRunSnapshot | null>(null);
  /** null 表示查看当前 live 状态；非 null 为历史 revision 快照 */
  const [viewingRevisionIndex, setViewingRevisionIndex] = useState<number | null>(null);
  const [latestRevisionIndex, setLatestRevisionIndex] = useState(0);

  const utils = trpc.useUtils();
  const createSession = trpc.session.create.useMutation();
  const createFromDataSource = trpc.session.createFromDataSource.useMutation();
  const saveDataSourceMut = trpc.session.saveDataSource.useMutation();
  const saveMessageMut = trpc.session.addMessage.useMutation();
  const updatePhaseMut = trpc.session.updatePhase.useMutation();
  const resetPipelineMut = trpc.session.resetPipeline.useMutation();
  const updateTargetTableMut = trpc.session.updateTargetTable.useMutation();
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
  const deleteDataSourceMut = trpc.session.deleteDataSource.useMutation();
  const modifySqlStepMut = trpc.sql.modifyStep.useMutation();
  const updateRuleParams = trpc.rules.updateParameters.useMutation();
  const createCustomRuleMut = trpc.rules.createCustom.useMutation();
  const deleteCustomRuleMut = trpc.rules.deleteCustom.useMutation();
  const chatSend = trpc.chat.send.useMutation();
  const importContractMut = trpc.contract.importContract.useMutation();
  const exportBundleMut = trpc.artifact.exportBundle.useMutation();
  const createSnapshotMut = trpc.snapshot.create.useMutation();
  const batchDatabaseMut = trpc.batch.runDatabaseBatch.useMutation();

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
    setExecutionHistory([]);
    setRetryContext(null);
    setMessages([]);
    setRetryCount(0);
    setCurrentRunIndex(1);
    setViewingRunIndex(1);
    setPipelineRuns([]);
    setCompareRunSnapshot(null);
    setViewingRevisionIndex(null);
    setLatestRevisionIndex(0);
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
    executionHistory,
    setExecutionHistory,
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
    currentRunIndex,
    setCurrentRunIndex,
    viewingRunIndex,
    setViewingRunIndex,
    pipelineRuns,
    setPipelineRuns,
    compareRunSnapshot,
    setCompareRunSnapshot,
    viewingRevisionIndex,
    setViewingRevisionIndex,
    latestRevisionIndex,
    setLatestRevisionIndex,
    utils,
    mutations: {
      createSession,
      createFromDataSource,
      saveDataSourceMut,
      saveMessageMut,
      updatePhaseMut,
      resetPipelineMut,
      updateTargetTableMut,
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
      deleteDataSourceMut,
      modifySqlStepMut,
      updateRuleParams,
      createCustomRuleMut,
      deleteCustomRuleMut,
      chatSend,
      importContractMut,
      exportBundleMut,
      createSnapshotMut,
      batchDatabaseMut,
    },
    refreshLists,
    syncPhase,
    resetSessionState,
  };
}

export type CleaningSessionState = ReturnType<typeof useCleaningSessionState>;
