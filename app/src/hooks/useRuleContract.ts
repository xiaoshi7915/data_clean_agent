import { useCallback } from "react";
import { toast } from "sonner";
import { downloadJsonFile, downloadTextFile } from "@/lib/downloadReport";
import type { CleaningRule } from "@contracts/types";
import type { CleaningSessionState } from "./cleaningSessionState";
import type { ChatApi } from "./useChat";

/** 规则确认、自定义规则与契约导入导出 */
export function useRuleContract(state: CleaningSessionState, chat: ChatApi) {
  const {
    sessionId,
    dataSource,
    cleaningRules,
    setCleaningRules,
    setIsLoading,
    setError,
    mutations: {
      updateRule,
      confirmAllRules,
      updateRuleParams,
      createCustomRuleMut,
      deleteCustomRuleMut,
      importContractMut,
      exportBundleMut,
    },
    utils,
    syncPhase,
    refreshLists,
  } = state;

  const { pushMessage } = chat;

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
    [sessionId, updateRule, setCleaningRules]
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
    [sessionId, cleaningRules, updateRuleParams, setCleaningRules]
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
    [sessionId, createCustomRuleMut, setCleaningRules, setError]
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
    [sessionId, deleteCustomRuleMut, setCleaningRules, setError]
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
  }, [
    sessionId,
    cleaningRules,
    dataSource,
    confirmAllRules,
    pushMessage,
    syncPhase,
    setCleaningRules,
    setIsLoading,
    setError,
  ]);

  const exportContractYaml = useCallback(async () => {
    if (!sessionId) {
      toast.error("请先创建或加载会话");
      return false;
    }
    try {
      const result = await utils.contract.exportYaml.fetch({ sessionId });
      if (!result.success || !result.yaml) {
        toast.error(result.error || "导出 YAML 失败");
        return false;
      }
      downloadTextFile(result.yaml, `contract-${sessionId}.yaml`, "text/yaml;charset=utf-8");
      toast.success("YAML 契约已导出");
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出 YAML 失败");
      return false;
    }
  }, [sessionId, utils.contract.exportYaml]);

  const exportContractJson = useCallback(async () => {
    if (!sessionId) {
      toast.error("请先创建或加载会话");
      return false;
    }
    try {
      const result = await utils.contract.exportJson.fetch({ sessionId });
      if (!result.success || !result.json) {
        toast.error(result.error || "导出 JSON 失败");
        return false;
      }
      const parsed = JSON.parse(result.json) as unknown;
      downloadJsonFile(parsed, `contract-${sessionId}.json`);
      toast.success("JSON 契约已导出");
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出 JSON 失败");
      return false;
    }
  }, [sessionId, utils.contract.exportJson]);

  const importContract = useCallback(
    async (source: string, format: "yaml" | "json" | "auto" = "auto") => {
      if (!sessionId) {
        toast.error("请先创建或加载会话");
        return false;
      }
      if (!source.trim()) {
        toast.error("契约内容不能为空");
        return false;
      }
      try {
        const result = await importContractMut.mutateAsync({ sessionId, source, format });
        if (!result.success) {
          toast.error(result.error || "导入契约失败");
          return false;
        }
        setCleaningRules(result.rules);
        await syncPhase(sessionId, "confirm");
        toast.success(`已导入 ${result.ruleCount} 条清洗规则`);
        await refreshLists();
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "导入契约失败");
        return false;
      }
    },
    [sessionId, importContractMut, syncPhase, refreshLists, setCleaningRules]
  );

  /** 导出完整脚本包（cleaning.sql + contract + soda checks + manifest） */
  const exportArtifactBundle = useCallback(async () => {
    if (!sessionId) {
      toast.error("请先创建或加载会话");
      return false;
    }
    try {
      const result = await exportBundleMut.mutateAsync({ sessionId });
      if (!result.success || !result.files) {
        toast.error(result.error || "导出脚本包失败");
        return false;
      }
      downloadJsonFile(
        { manifest: result.manifest, files: result.files },
        `cleaning-bundle-${sessionId}.json`
      );
      toast.success(`脚本包已导出（${result.files.length} 个文件）`);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出脚本包失败");
      return false;
    }
  }, [sessionId, exportBundleMut]);

  return {
    updateRuleStatus,
    updateRuleParameters,
    addCustomRule,
    deleteCustomRule,
    confirmAll,
    exportContractYaml,
    exportContractJson,
    importContract,
    exportArtifactBundle,
  };
}
