import { useState } from "react";
import { createPortal } from "react-dom";
import { useCleaningSession } from "@/hooks/useCleaningSession";
import { trpc } from "@/providers/trpc";
import type { ChatMessage, ChatMessageAction, CleaningPhase } from "@contracts/types";
import { Sidebar } from "@/components/Sidebar";
import { DataSourceEditDialog } from "@/components/datasource/DataSourceEditDialog";
import { NewDataSourceDialog } from "@/components/datasource/NewDataSourceDialog";
import { NewConversationDialog } from "@/components/datasource/NewConversationDialog";
import { PhaseIndicator } from "@/components/PhaseIndicator";
import { PipelineRunSwitcher } from "@/components/PipelineRunSwitcher";
import {
  RunDiffBanner,
  ReadOnlyRunBanner,
  ReadOnlyRevisionBanner,
} from "@/components/RunDiffBanner";
import { OrchestratorProgress } from "@/components/OrchestratorProgress";
import { ExecutionPanel } from "@/components/execute/ExecutionPanel";
import { RetryPanel } from "@/components/retry/RetryPanel";
import { ChatPanel } from "@/components/ChatPanel";
import { SessionDialogs, type SessionDialogType } from "@/components/SessionDialogs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Menu, ArrowRight, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  targetRunIndexForViewAction,
  targetRevisionIndexForViewAction,
} from "@/lib/chatActionRun";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export default function Home() {
  const session = useCleaningSession();
  const { data: runtimeConfig } = trpc.artifact.config.useQuery();
  const scriptOnly = runtimeConfig?.scriptOnly ?? true;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openDialog, setOpenDialog] = useState<SessionDialogType>(null);
  const [isChatThinking, setIsChatThinking] = useState(false);
  const [editingDataSourceId, setEditingDataSourceId] = useState<string | null>(null);
  const [newDataSourceOpen, setNewDataSourceOpen] = useState(false);
  const [newConversationSourceId, setNewConversationSourceId] = useState<string | null>(null);
  const [orchestratorRunId, setOrchestratorRunId] = useState<string | undefined>();
  const [orchestratorState, setOrchestratorState] = useState<string | undefined>();
  /** 从顶部「重试」进入选表流程时，选表面板显示「重新探查」 */
  const [reExploreFromRetry, setReExploreFromRetry] = useState(false);

  const RETRY_TOAST = "已开始新一轮清洗，历史结果已保留，可通过运行版本切换对比";

  const { data: orchestratorRuns } = trpc.orchestrator.listBySession.useQuery(
    { sessionId: session.sessionId! },
    { enabled: !!session.sessionId, refetchInterval: session.sessionId ? 5000 : false }
  );

  const activeRun = orchestratorRuns?.runs?.find(
    (r) => r.state !== "done" && r.state !== "failed"
  );
  const displayRunId = orchestratorRunId ?? activeRun?.runId;
  const displayRunState = orchestratorState ?? activeRun?.state;

  const handlePhaseClick = (phase: CleaningPhase) => {
    switch (phase) {
      case "explore":
        if (session.explorationResult) setOpenDialog("explore");
        break;
      case "analyze":
        if (session.qualityReport) setOpenDialog("quality");
        break;
      case "confirm":
        setOpenDialog("rules");
        break;
      case "generate":
        if (session.generatedSQL) setOpenDialog("sql");
        else if (session.cleaningRules.length > 0) setOpenDialog("rules");
        break;
      case "execute":
        break;
      default:
        break;
    }
  };

  /** 顶部「重试」：在当前会话内重置流程，保留已绑定表/文件 */
  const handleRetryRestart = () => {
    void session.retryInPlace().then((ok) => {
      if (!ok) return;
      toast.success(RETRY_TOAST);
      setReExploreFromRetry(true);
    });
  };

  const openTableSelectDialog = async () => {
    const outcome = await session.requestOpenTableSelect();
    if (outcome === "file") {
      toast.info("文件数据源无需选表，请直接点击「开始探查」");
      return;
    }
    if (outcome === "new_session") {
      toast.info("当前会话已绑定数据表，已为您创建新会话");
    }
    setOpenDialog("selectTable");
  };

  const handleSelectTable = async (table: string) => {
    const result = await session.selectSessionTargetTable(table);
    if (result === "needs_new_session") {
      toast.info("当前会话已绑定其他数据表，将为您创建新会话");
      const created = await session.retryWithNewSession();
      if (created) {
        await session.selectSessionTargetTable(table);
        if (!created.isFileSource) {
          setOpenDialog("selectTable");
        }
      }
    }
  };

  const handleChatAction = async (action: ChatMessageAction, message?: ChatMessage) => {
    const switchToRun = targetRunIndexForViewAction(action, session.viewingRunIndex, message);
    if (switchToRun != null) {
      const ok = await session.switchPipelineRun(switchToRun);
      if (!ok) {
        toast.error("无法加载该次运行的数据");
        return;
      }
    }

    const effectiveRunIndex = action.runIndex ?? session.viewingRunIndex;
    const switchToRevision = targetRevisionIndexForViewAction(
      action,
      session.viewingRevisionIndex,
      session.latestRevisionIndex,
      message
    );
    if (switchToRevision != null) {
      const ok = await session.switchPipelineRevision(switchToRevision, effectiveRunIndex);
      if (!ok) {
        toast.error("无法加载该里程碑的规则/SQL 快照");
        return;
      }
    }

    switch (action.type) {
      case "selectTable":
        setReExploreFromRetry(false);
        void openTableSelectDialog();
        break;
      case "startExplore":
        void session.runAutoExploreAndAnalyze(session.targetTable || undefined).then((result) => {
          if (result) setReExploreFromRetry(false);
        });
        break;
      case "runFullPipeline":
        if (action.id === "run-full-pipeline-db") {
          void session.runBatchDatabasePipeline();
          break;
        }
        if (session.dataSource && !session.dataSource.fileConfig && !session.targetTable) {
          void openTableSelectDialog();
        } else {
          void session.runPipelineToGenerateSQL(session.targetTable || undefined);
        }
        break;
      case "runAgentPlan":
        if (session.dataSource && !session.dataSource.fileConfig && !session.targetTable) {
          void openTableSelectDialog();
        } else {
          void session.runAutoExploreAndAnalyze(session.targetTable || undefined).then((result) => {
            if (result) setReExploreFromRetry(false);
          });
        }
        break;
      case "updateRule":
      case "viewRules":
        setOpenDialog("rules");
        break;
      case "skipRule":
      case "confirmRule":
        setOpenDialog("rules");
        break;
      case "viewExplore":
        setOpenDialog("explore");
        break;
      case "startAnalysis":
        session.startAnalysis();
        break;
      case "viewQuality":
        setOpenDialog("quality");
        break;
      case "confirmAll":
        session.confirmAll();
        break;
      case "generateSQL":
        session.generateCleaningSQL();
        break;
      case "viewSQL":
        setOpenDialog("sql");
        break;
      case "executeSQL":
        if (scriptOnly) {
          void session.exportArtifactBundle();
        } else {
          session.executeSQL(false);
        }
        break;
      case "dryRunSQL":
        session.executeSQL(true);
        break;
    }
  };

  const handleAutoChatAction = (action: ChatMessageAction) => {
    void handleChatAction(action);
  };

  const handleSendMessage = async (content: string) => {
    session.addMessage("user", content);
    setIsChatThinking(true);
    try {
      const result = await session.sendChatMessage(content);
      if (result?.orchestratorRunId) {
        setOrchestratorRunId(result.orchestratorRunId);
      }
      if (result?.orchestratorState) {
        setOrchestratorState(result.orchestratorState);
      }
      if (result?.autoTrigger && result.action) {
        handleAutoChatAction(result.action);
      }
    } finally {
      setIsChatThinking(false);
    }
  };

  const openNewConversation = (dataSourceId: string) => {
    setSidebarOpen(false);
    window.setTimeout(() => setNewConversationSourceId(dataSourceId), 320);
  };

  const isFileSource = !!session.dataSource?.fileConfig;

  const exportSQL = () => {
    if (!session.generatedSQL) return;
    const sql = session.generatedSQL.steps.map((s) => s.sql).join("\n\n");
    const blob = new Blob([sql], { type: "text/sql" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clean_${session.generatedSQL.targetTable}_${Date.now()}.sql`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const appDialogs = (
    <>
      <DataSourceEditDialog
        dataSourceId={editingDataSourceId}
        open={!!editingDataSourceId}
        onOpenChange={(open) => !open && setEditingDataSourceId(null)}
        onSaved={() => session.refreshLists()}
      />

      <NewDataSourceDialog
        open={newDataSourceOpen}
        onOpenChange={setNewDataSourceOpen}
        onSave={session.saveDataSourceOnly}
        isLoading={session.isLoading}
      />

      <NewConversationDialog
        dataSourceId={newConversationSourceId}
        savedDataSources={session.savedDataSources}
        open={!!newConversationSourceId}
        onOpenChange={(open) => !open && setNewConversationSourceId(null)}
        onConfirm={async (dataSourceId, title) => {
          const id = await session.createConversationFromDataSource(dataSourceId, title);
          if (!id) throw new Error("创建对话失败");
        }}
        isLoading={session.isLoading}
      />

      <SessionDialogs
        openDialog={openDialog}
        onClose={() => setOpenDialog(null)}
        onOpenDialog={setOpenDialog}
        sessionId={session.sessionId}
        dataSource={session.dataSource}
        targetTable={session.targetTable}
        onSelectTable={(table) => void handleSelectTable(table)}
        tableExploreButtonLabel={
          reExploreFromRetry || session.currentPhase === "retry" ? "重新探查" : "开始探查"
        }
        onExplore={async (table) => {
          const result = await session.runAutoExploreAndAnalyze(table);
          if (result) setReExploreFromRetry(false);
        }}
        onRunFullPipeline={async (table) => {
          await session.runPipelineToGenerateSQL(table);
        }}
        explorationResult={session.explorationResult}
        qualityReport={session.qualityReport}
        cleaningRules={session.cleaningRules}
        generatedSQL={session.generatedSQL}
        onRuleStatusChange={session.updateRuleStatus}
        onRuleParameterChange={session.updateRuleParameters}
        onAddCustomRule={(input) => void session.addCustomRule(input)}
        onDeleteCustomRule={(ruleId) => void session.deleteCustomRule(ruleId)}
        onConfirmAllRules={session.confirmAll}
        onGenerateSQL={session.generateCleaningSQL}
        onStartAnalysis={session.startAnalysis}
        onExecuteSQL={session.executeSQL}
        onModifySQL={(stepNum, newSql) => session.modifySQLStep(stepNum, newSql)}
        onExportSQL={exportSQL}
        onExportArtifactBundle={() => void session.exportArtifactBundle()}
        scriptOnly={scriptOnly}
        onExportContractYaml={() => void session.exportContractYaml()}
        onExportContractJson={() => void session.exportContractJson()}
        onImportContract={(source, format) => session.importContract(source, format)}
        isLoading={session.isLoading}
        isPipelineRunning={session.isPipelineRunning}
        readOnly={session.isViewingHistoricalSnapshot}
        runDiff={session.pipelineRunDiff}
      />
    </>
  );

  const renderMainContent = () => {
    if (!session.sessionId) {
      const workflowSteps = [
        "新建数据源",
        "选择数据源新建对话",
        "选表探查",
        "质量分析",
        "确认规则",
        "生成 SQL",
        "执行清洗",
      ];

      return (
        <div className="flex flex-1 min-h-0 items-center justify-center px-6 py-12">
          <div className="w-full max-w-lg text-center space-y-6">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary mx-auto">
              <Sparkles className="w-6 h-6" />
            </div>
            <div className="space-y-2">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                数据清洗智能体使用流程
              </h2>
              <p className="text-sm text-muted-foreground">
                按以下步骤完成从数据接入到清洗执行
              </p>
            </div>
            <ol className="text-left space-y-2.5 mx-auto max-w-sm">
              {workflowSteps.map((step, index) => (
                <li
                  key={step}
                  className="flex items-center gap-3 text-sm text-foreground/90 rounded-lg px-3 py-2 bg-sky-50/60 dark:bg-sky-950/20 border border-sky-100/80 dark:border-sky-900/40"
                >
                  <span className="flex shrink-0 items-center justify-center w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-semibold">
                    {index + 1}
                  </span>
                  <span className="flex-1">{step}</span>
                  {index < workflowSteps.length - 1 && (
                    <ArrowRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground/50 hidden sm:block" />
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>
      );
    }

    if (session.currentPhase === "execute") {
      return (
        <ScrollArea className="h-full flex-1">
          <div className="p-6 lg:p-8 max-w-3xl mx-auto">
            <ExecutionPanel
              result={session.executionResult}
              executionHistory={session.executionHistory}
              scriptOnly={scriptOnly}
              onExportBundle={() => void session.exportArtifactBundle()}
              onRetry={() => {
                if (session.executionResult?.error && session.generatedSQL) {
                  const failedStep = session.executionResult.stepResults.find((s) => s.status === "failed");
                  if (failedStep) {
                    const step = session.generatedSQL.steps.find((s) => s.stepNumber === failedStep.stepNumber);
                    if (step) {
                      session.handleRetry(session.executionResult.error, step);
                      session.setCurrentPhase("retry");
                    }
                  }
                }
              }}
              onExportSQL={exportSQL}
              isFileSource={isFileSource}
            />
          </div>
        </ScrollArea>
      );
    }

    if (session.currentPhase === "retry" && session.retryContext) {
      return (
        <ScrollArea className="h-full flex-1">
          <div className="p-6 lg:p-8 max-w-3xl mx-auto">
            <RetryPanel
              context={session.retryContext}
              onSelectOption={(idx) => {
                const option = session.retryContext?.options[idx];
                if (option && session.generatedSQL) {
                  const failedStep = session.generatedSQL.steps.find(
                    (s) => s.stepNumber === session.retryContext?.failedStep
                  );
                  if (failedStep) {
                    session.applyManualFix(failedStep.stepNumber, option.fixedSql);
                    session.setCurrentPhase("generate");
                  }
                }
              }}
              onManualFix={(fix) => {
                if (session.generatedSQL && session.retryContext) {
                  const failedStep = session.generatedSQL.steps.find(
                    (s) => s.stepNumber === session.retryContext?.failedStep
                  );
                  if (failedStep) {
                    session.applyManualFix(failedStep.stepNumber, fix);
                    session.setCurrentPhase("generate");
                  }
                }
              }}
              retryCount={session.retryCount}
            />
          </div>
        </ScrollArea>
      );
    }

    return (
      <div className="flex flex-1 min-h-0 min-w-0 justify-center">
        <div className="w-full max-w-3xl flex flex-col min-h-0 h-full border-x bg-card/40 backdrop-blur-sm shadow-sm">
          <ChatPanel
            messages={session.messages}
            onSendMessage={handleSendMessage}
            onMessageAction={handleChatAction}
            isLoading={session.isLoading || isChatThinking}
            actionContext={{
              currentPhase: session.currentPhase,
              targetTable: session.targetTable,
              isFileSource,
              isViewingHistoricalRun: session.isViewingHistoricalSnapshot,
              isViewingHistoricalRevision: session.isViewingHistoricalRevision,
              explorationResult: session.explorationResult,
              qualityReport: session.qualityReport,
              cleaningRules: session.cleaningRules,
              generatedSQL: session.generatedSQL,
              executionResult: session.executionResult,
            }}
            readOnly={session.isViewingHistoricalSnapshot}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen w-screen bg-gradient-to-br from-background via-background to-sky-50/30 dark:to-sky-950/10 overflow-hidden">
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-[22rem] min-w-[20rem] p-0">
          <Sidebar
            currentSessionId={session.sessionId}
            sessionList={session.sessionList}
            savedDataSources={session.savedDataSources}
            onNewDataSource={() => {
              setNewDataSourceOpen(true);
              setSidebarOpen(false);
            }}
            onSelectSession={async (sid) => {
              await session.loadSession(sid);
              setSidebarOpen(false);
            }}
            onNewConversation={openNewConversation}
            onDeleteSession={async (sid) => {
              await session.deleteSessionById(sid);
            }}
            onEditDataSource={setEditingDataSourceId}
            onDeleteDataSource={(sourceId) => session.deleteDataSourceById(sourceId)}
            onGoHome={() => {
              session.resetSessionState();
              setSidebarOpen(false);
            }}
          />
        </SheetContent>
      </Sheet>

      <div className="hidden md:flex w-[22rem] min-w-[20rem] flex-col border-r bg-card shrink-0">
        <Sidebar
          currentSessionId={session.sessionId}
          sessionList={session.sessionList}
          savedDataSources={session.savedDataSources}
          onNewDataSource={() => setNewDataSourceOpen(true)}
          onSelectSession={(sid) => session.loadSession(sid)}
          onNewConversation={openNewConversation}
          onDeleteSession={(sid) => session.deleteSessionById(sid)}
          onEditDataSource={setEditingDataSourceId}
          onDeleteDataSource={(sourceId) => session.deleteDataSourceById(sourceId)}
          onGoHome={() => session.resetSessionState()}
        />
      </div>

      <div className="flex flex-col flex-1 min-w-0">
        <header className="flex items-center gap-3 px-5 py-3.5 border-b bg-card/60 backdrop-blur-md shadow-sm">
          <div className="flex items-center gap-3 min-w-0 shrink-0 md:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
            </Sheet>
          </div>
          <div className="flex flex-1 items-center justify-center min-w-0 overflow-x-auto gap-2">
            <PhaseIndicator
              currentPhase={session.currentPhase}
              completedPhases={(() => {
                const phases: typeof session.currentPhase[] = [];
                const order = ["explore", "analyze", "confirm", "generate", "execute"];
                const currentIdx = order.indexOf(session.currentPhase);
                for (let i = 0; i < currentIdx; i++) {
                  phases.push(order[i] as typeof session.currentPhase);
                }
                if (session.currentPhase !== "idle" && session.currentPhase !== "retry") {
                  phases.push(session.currentPhase);
                }
                return phases;
              })()}
              onPhaseClick={session.sessionId ? handlePhaseClick : undefined}
              onRetryClick={session.sessionId ? handleRetryRestart : undefined}
            />
            {session.sessionId && session.pipelineRuns.length > 1 && (
              <PipelineRunSwitcher
                runs={session.pipelineRuns}
                currentRunIndex={session.currentRunIndex}
                viewingRunIndex={session.viewingRunIndex}
                onSwitch={(runIndex) => void session.switchPipelineRun(runIndex)}
                disabled={session.isLoading}
              />
            )}
            {session.sessionId && (
              <OrchestratorProgress
                runId={displayRunId}
                state={displayRunState}
              />
            )}
          </div>
          {(session.isViewingHistoricalSnapshot ||
            session.pipelineRunDiff?.hasBaseline) && (
            <div className="px-4 pb-2 space-y-2 shrink-0">
              {session.isViewingHistoricalRun && (
                <ReadOnlyRunBanner
                  viewingRunIndex={session.viewingRunIndex}
                  currentRunIndex={session.currentRunIndex}
                  onSwitchToCurrent={() => void session.switchPipelineRun(session.currentRunIndex)}
                />
              )}
              {session.isViewingHistoricalRevision && (
                <ReadOnlyRevisionBanner
                  viewingRevisionIndex={session.viewingRevisionIndex!}
                  latestRevisionIndex={session.latestRevisionIndex}
                  onSwitchToLatest={() =>
                    void session.switchToLiveRevision(session.viewingRunIndex)
                  }
                />
              )}
              <RunDiffBanner diff={session.pipelineRunDiff} />
            </div>
          )}
        </header>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {renderMainContent()}
        </div>
      </div>

      {createPortal(appDialogs, document.body)}
    </div>
  );
}
