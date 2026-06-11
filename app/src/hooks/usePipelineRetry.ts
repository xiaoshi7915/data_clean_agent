import { useCallback } from "react";
import type { SQLGenerationResult } from "@contracts/types";
import type { CleaningSessionState } from "./cleaningSessionState";
import type { ChatApi } from "./useChat";

/** 执行失败后的重试与手动修正 */
export function usePipelineRetry(state: CleaningSessionState, chat: ChatApi) {
  const {
    sessionId,
    generatedSQL,
    retryCount,
    setGeneratedSQL,
    setRetryContext,
    setRetryCount,
    setIsLoading,
    setError,
    mutations: { getRetryCtx, applyFix },
  } = state;

  const { pushMessage } = chat;

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
    [retryCount, getRetryCtx, setRetryContext, setRetryCount]
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
    [sessionId, generatedSQL, applyFix, pushMessage, setGeneratedSQL, setIsLoading, setError]
  );

  return { handleRetry, applyManualFix };
}
