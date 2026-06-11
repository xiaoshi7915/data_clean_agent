import { useCleaningSessionState } from "./cleaningSessionState";
import { useChat } from "./useChat";
import { useSessionList } from "./useSessionList";
import { useRuleContract } from "./useRuleContract";
import { usePipeline } from "./usePipeline";

/**
 * 清洗会话门面 Hook：组合 sessionList / ruleContract / pipeline / chat 子模块，保持 Home.tsx 公共 API 不变。
 */
export function useCleaningSession() {
  const state = useCleaningSessionState();
  const chat = useChat(state);
  const sessionList = useSessionList(state, chat);
  const ruleContract = useRuleContract(state, chat);
  const pipeline = usePipeline(state, chat);

  return {
    sessionId: state.sessionId,
    sessionTitle: state.sessionTitle,
    dataSourceId: state.dataSourceId,
    currentPhase: state.currentPhase,
    dataSource: state.dataSource,
    targetTable: state.targetTable,
    explorationResult: state.explorationResult,
    qualityReport: state.qualityReport,
    cleaningRules: state.cleaningRules,
    generatedSQL: state.generatedSQL,
    executionResult: state.executionResult,
    retryContext: state.retryContext,
    messages: state.messages,
    sessionList: state.sessionList,
    savedDataSources: state.savedDataSources,
    isLoading: state.isLoading,
    isPipelineRunning: state.isPipelineRunning,
    error: state.error,
    retryCount: state.retryCount,

    initSession: sessionList.initSession,
    loadSession: sessionList.loadSession,
    deleteSessionById: sessionList.deleteSessionById,
    createConversationFromDataSource: sessionList.createConversationFromDataSource,
    saveDataSourceOnly: sessionList.saveDataSourceOnly,
    resetSessionState: sessionList.resetSessionState,
    refreshLists: sessionList.refreshLists,
    restartFromTableSelection: sessionList.restartFromTableSelection,
    syncPhase: state.syncPhase,

    startExploration: pipeline.startExploration,
    startAnalysis: pipeline.startAnalysis,
    runFullPipelineToSQL: pipeline.runFullPipelineToSQL,
    runAgentPlanBySteps: pipeline.runAgentPlanBySteps,
    updateRuleStatus: ruleContract.updateRuleStatus,
    updateRuleParameters: ruleContract.updateRuleParameters,
    addCustomRule: ruleContract.addCustomRule,
    deleteCustomRule: ruleContract.deleteCustomRule,
    confirmAll: ruleContract.confirmAll,
    generateCleaningSQL: pipeline.generateCleaningSQL,
    executeSQL: pipeline.executeSQL,
    handleRetry: pipeline.handleRetry,
    applyManualFix: pipeline.applyManualFix,
    modifySQLStep: pipeline.modifySQLStep,
    exportContractYaml: ruleContract.exportContractYaml,
    exportContractJson: ruleContract.exportContractJson,
    importContract: ruleContract.importContract,
    exportArtifactBundle: ruleContract.exportArtifactBundle,

    sendChatMessage: chat.sendChatMessage,
    addMessage: chat.addMessage,

    setCurrentPhase: state.setCurrentPhase,
    setTargetTable: state.setTargetTable,
    setDataSource: state.setDataSource,
    setError: state.setError,
    setMessages: state.setMessages,
    setGeneratedSQL: state.setGeneratedSQL,
    setExplorationResult: state.setExplorationResult,
    setQualityReport: state.setQualityReport,
    setCleaningRules: state.setCleaningRules,
    setExecutionResult: state.setExecutionResult,
    setRetryContext: state.setRetryContext,
  };
}
