import { useCallback } from "react";
import type { CleaningPhase, ChatMessage, ChatMessageAction, CleaningRule } from "@contracts/types";
import type { CleaningSessionState } from "./cleaningSessionState";
import { isDbSourceType } from "./cleaningSessionState";
import { VIEW_PIPELINE_WITH_SQL_ACTIONS } from "@/lib/pipelineMessageActions";
import {
  bindActionsToRun,
  actionsNeedPipelineSnapshot,
} from "@/lib/chatActionRun";
import {
  historicalRunReadonlyMessage,
  historicalRevisionReadonlyMessage,
  isHistoricalRunView,
  isHistoricalRevisionView,
} from "./writableRunGuard";

/** 聊天消息、发送与 Agent 动作 */
export function useChat(state: CleaningSessionState) {
  const {
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
    setMessages,
    viewingRunIndex,
    currentRunIndex,
    viewingRevisionIndex,
    latestRevisionIndex,
    setViewingRevisionIndex,
    setLatestRevisionIndex,
    mutations: { saveMessageMut, chatSend, createSnapshotMut },
    refreshLists,
    setCleaningRules,
    setGeneratedSQL,
    utils,
  } = state;

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

  const pushMessage = useCallback(
    async (
      sid: string,
      role: ChatMessage["role"],
      content: string,
      phase: CleaningPhase,
      actions?: ChatMessageAction[],
      runIndex: number = currentRunIndex
    ) => {
      let revisionIndex: number | undefined;
      if (actions?.length && actionsNeedPipelineSnapshot(actions)) {
        try {
          const snap = await createSnapshotMut.mutateAsync({
            sessionId: sid,
            runIndex,
            trigger: "chat_milestone",
          });
          if (snap.success && snap.revisionIndex > 0) {
            revisionIndex = snap.revisionIndex;
            setLatestRevisionIndex(snap.revisionIndex);
            setViewingRevisionIndex(null);
          }
        } catch (err) {
          console.error("Failed to create pipeline snapshot:", err);
        }
      }

      const boundActions = actions?.length
        ? bindActionsToRun(actions, runIndex, revisionIndex)
        : undefined;
      const msg: ChatMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        role,
        phase,
        content,
        timestamp: new Date().toISOString(),
        metadata: {
          runIndex,
          ...(revisionIndex != null ? { revisionIndex } : {}),
        },
        actions: boundActions,
      };
      setMessages((prev) => [...prev, msg]);
      void persistMessage(sid, msg);
      return msg;
    },
    [
      persistMessage,
      setMessages,
      currentRunIndex,
      createSnapshotMut,
      setLatestRevisionIndex,
      setViewingRevisionIndex,
    ]
  );

  const addMessage = useCallback(
    (
      role: ChatMessage["role"],
      content: string,
      phase: CleaningPhase = currentPhase,
      actions?: ChatMessageAction[]
    ) => {
      if (sessionId) {
        void pushMessage(sessionId, role, content, phase, actions, currentRunIndex);
        return undefined;
      }
      const boundActions = actions?.length ? bindActionsToRun(actions, currentRunIndex) : undefined;
      const msg: ChatMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        role,
        phase,
        content,
        timestamp: new Date().toISOString(),
        metadata: { runIndex: currentRunIndex },
        actions: boundActions,
      };
      setMessages((prev) => [...prev, msg]);
      return msg;
    },
    [sessionId, currentPhase, currentRunIndex, pushMessage, setMessages]
  );

  const buildRestoredMessages = useCallback(
    (
      _sid: string,
      session: {
        currentPhase: CleaningPhase;
        dataSource?: typeof dataSource;
        targetTable?: string;
        explorationResult?: typeof explorationResult;
        qualityReport?: typeof qualityReport;
        cleaningRules?: CleaningRule[];
        generatedSQL?: typeof generatedSQL;
        executionResult?: typeof executionResult;
      },
      runIndex = 1
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
        metadata: { runIndex },
        actions: actions?.length ? bindActionsToRun(actions, runIndex) : undefined,
      });

      if (session.dataSource) {
        const isDbSource = isDbSourceType(session.dataSource.type);
        if (isDbSource && !session.explorationResult) {
          restored.push(
            mk(
              "agent",
              `会话已恢复。数据源：${session.dataSource.name}\n\n${
                session.targetTable
                  ? `已选表：**${session.targetTable}**，请点击 **「选择数据表」** 后点击 **「开始探查」** 或 **「一键生成SQL」**。`
                  : "请点击 **「选择数据表」**，选中表后点击 **「开始探查」** 或 **「一键生成SQL」**。"
              }`,
              "explore",
              session.targetTable
                ? [
                    { id: "select-table", label: "选择数据表", type: "selectTable" },
                    { id: "run-full-pipeline-table", label: "一键生成SQL", type: "runFullPipeline" },
                  ]
                : [
                    { id: "select-table", label: "选择数据表", type: "selectTable" },
                    {
                      id: "run-full-pipeline-db",
                      label: "整库一键生成SQL",
                      type: "runFullPipeline",
                    },
                  ]
            )
          );
        } else if (!session.explorationResult) {
          restored.push(
            mk(
              "agent",
              `会话已恢复。数据源：${session.dataSource.name}\n\n点击 **「开始探查」** 查看质量报告，或 **「一键生成SQL」** 直接生成清洗方案。`,
              "explore",
              [
                { id: "start-explore", label: "开始探查", type: "startExplore" },
                { id: "run-full-pipeline", label: "一键生成SQL", type: "runFullPipeline" },
              ]
            )
          );
        }
      }

      if (session.explorationResult && !session.qualityReport) {
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

      if (session.qualityReport && !session.generatedSQL) {
        const qr = session.qualityReport;
        const er = session.explorationResult;
        const rules = session.cleaningRules ?? [];
        const tableLabel = er?.sourceName ?? session.targetTable ?? "数据表";
        restored.push(
          mk(
            "agent",
            `🔍 **探查与分析完成！**\n\n表 **${tableLabel}** · **质量评分：${qr.score.overall}/100**${
              rules.length > 0
                ? `\n\n已推荐 **${rules.length}** 条清洗规则。`
                : "\n\n数据质量良好，暂无清洗建议。"
            }`,
            "confirm",
            [
              { id: "view-explore", label: "查看探查报告", type: "viewExplore" },
              { id: "view-quality", label: "查看质量报告", type: "viewQuality" },
              { id: "view-rules", label: "查看清洗规则", type: "viewRules" },
            ]
          )
        );
      } else if (session.qualityReport && session.generatedSQL) {
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
            VIEW_PIPELINE_WITH_SQL_ACTIONS
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
        restored.push(
          mk("agent", statusText, session.currentPhase === "retry" ? "retry" : "execute")
        );
      }

      return restored;
    },
    []
  );

  const sendChatMessage = useCallback(
    async (userMessage: string) => {
      if (sessionId && isHistoricalRunView(viewingRunIndex, currentRunIndex)) {
        const msg = historicalRunReadonlyMessage(viewingRunIndex, currentRunIndex);
        void pushMessage(sessionId, "agent", msg, currentPhase);
        return null;
      }
      if (
        sessionId &&
        isHistoricalRevisionView(viewingRevisionIndex, latestRevisionIndex)
      ) {
        const msg = historicalRevisionReadonlyMessage(
          viewingRevisionIndex!,
          latestRevisionIndex
        );
        void pushMessage(sessionId, "agent", msg, currentPhase);
        return null;
      }
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
          ? bindActionsToRun([result.action as ChatMessageAction], currentRunIndex)
          : [];

        if (sessionId) {
          void pushMessage(sessionId, "agent", result.message, currentPhase, actions, currentRunIndex);
        } else {
          addMessage("agent", result.message, currentPhase, actions);
        }

        if (sessionId && result.ruleUpdatesApplied && result.ruleUpdatesApplied > 0) {
          setViewingRevisionIndex(null);
          try {
            const full = await utils.session.getFull.fetch({
              sessionId,
              runIndex: currentRunIndex,
            });
            if (full.found && full.session?.cleaningRules) {
              setCleaningRules(full.session.cleaningRules);
              setGeneratedSQL(null);
              if (full.session.latestRevisionIndex != null) {
                setLatestRevisionIndex(full.session.latestRevisionIndex);
              }
            } else {
              const rulesRes = await utils.rules.getBySession.fetch({
                sessionId,
                runIndex: currentRunIndex,
              });
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
                setGeneratedSQL(null);
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
          orchestratorRunId: result.orchestratorRunId as string | undefined,
          orchestratorState: result.orchestratorState as string | undefined,
        };
      } catch (err) {
        const fallback = "对话服务暂时不可用，请使用消息下方的快捷按钮继续操作。";
        if (sessionId) {
          void pushMessage(sessionId, "agent", fallback, currentPhase);
        } else {
          addMessage("agent", fallback, currentPhase);
        }
        console.error("Chat send failed:", err);
        return { action: undefined, autoTrigger: false, usedLlm: false, ruleUpdatesApplied: 0 };
      }
    },
    [
      sessionId,
      viewingRunIndex,
      currentRunIndex,
      viewingRevisionIndex,
      latestRevisionIndex,
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
      utils,
      setCleaningRules,
      setGeneratedSQL,
      setViewingRevisionIndex,
      setLatestRevisionIndex,
    ]
  );

  return {
    pushMessage,
    addMessage,
    buildRestoredMessages,
    sendChatMessage,
    persistMessage,
  };
}

export type ChatApi = ReturnType<typeof useChat>;
