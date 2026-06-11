import { useState } from "react";
import { createPortal } from "react-dom";
import { useCleaningSession } from "@/hooks/useCleaningSession";
import { Sidebar } from "@/components/Sidebar";
import { DataSourceEditDialog } from "@/components/datasource/DataSourceEditDialog";
import { NewDataSourceDialog } from "@/components/datasource/NewDataSourceDialog";
import { NewConversationDialog } from "@/components/datasource/NewConversationDialog";
import { PhaseIndicator } from "@/components/PhaseIndicator";
import { ExecutionPanel } from "@/components/execute/ExecutionPanel";
import { RetryPanel } from "@/components/retry/RetryPanel";
import { ChatPanel } from "@/components/ChatPanel";
import { SessionDialogs, type SessionDialogType } from "@/components/SessionDialogs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Menu, ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import type { ChatMessageAction } from "@contracts/types";

export default function Home() {
  const session = useCleaningSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openDialog, setOpenDialog] = useState<SessionDialogType>(null);
  const [isChatThinking, setIsChatThinking] = useState(false);
  const [editingDataSourceId, setEditingDataSourceId] = useState<string | null>(null);
  const [newDataSourceOpen, setNewDataSourceOpen] = useState(false);
  const [newConversationSourceId, setNewConversationSourceId] = useState<string | null>(null);

  const handleChatAction = (action: ChatMessageAction) => {
    switch (action.type) {
      case "selectTable":
        setOpenDialog("selectTable");
        break;
      case "startExplore":
        session.startExploration();
        break;
      case "runFullPipeline":
      case "runAgentPlan":
        if (session.dataSource && !session.dataSource.fileConfig && !session.targetTable) {
          setOpenDialog("selectTable");
        } else {
          void session.runFullPipelineToSQL(session.targetTable || undefined).then((ok) => {
            if (ok) setOpenDialog("sql");
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
        session.executeSQL(false);
        break;
      case "dryRunSQL":
        session.executeSQL(true);
        break;
    }
  };

  const handleAutoChatAction = (action: ChatMessageAction) => {
    handleChatAction(action);
  };

  const handleSendMessage = async (content: string) => {
    session.addMessage("user", content);
    setIsChatThinking(true);
    try {
      const result = await session.sendChatMessage(content);
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
        dataSource={session.dataSource}
        targetTable={session.targetTable}
        onSelectTable={session.setTargetTable}
        onExplore={(table) => session.startExploration(table)}
        onRunFullPipeline={async (table) => {
          const ok = await session.runFullPipelineToSQL(table);
          if (ok) setOpenDialog("sql");
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
        isLoading={session.isLoading}
        isPipelineRunning={session.isPipelineRunning}
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
      <div className="flex flex-1 min-h-0 justify-center">
        <div className="w-full max-w-3xl flex flex-col min-h-0 h-full border-x bg-card/40 backdrop-blur-sm shadow-sm">
          <ChatPanel
            messages={session.messages}
            onSendMessage={handleSendMessage}
            onMessageAction={handleChatAction}
            isLoading={session.isLoading || isChatThinking}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen w-screen bg-gradient-to-br from-background via-background to-sky-50/30 dark:to-sky-950/10 overflow-hidden">
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-80 p-0">
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
            onGoHome={() => {
              session.resetSessionState();
              setSidebarOpen(false);
            }}
          />
        </SheetContent>
      </Sheet>

      <div className="hidden md:flex w-80 flex-col border-r bg-card shrink-0">
        <Sidebar
          currentSessionId={session.sessionId}
          sessionList={session.sessionList}
          savedDataSources={session.savedDataSources}
          onNewDataSource={() => setNewDataSourceOpen(true)}
          onSelectSession={(sid) => session.loadSession(sid)}
          onNewConversation={openNewConversation}
          onDeleteSession={(sid) => session.deleteSessionById(sid)}
          onEditDataSource={setEditingDataSourceId}
          onGoHome={() => session.resetSessionState()}
        />
      </div>

      <div className="flex flex-col flex-1 min-w-0">
        <header className="flex items-center justify-between px-5 py-3.5 border-b bg-card/60 backdrop-blur-md shadow-sm">
          <div className="flex items-center gap-3 min-w-0">
            <Sheet>
              <SheetTrigger asChild className="md:hidden">
                <Button variant="ghost" size="icon">
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
            </Sheet>
          </div>
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
          />
        </header>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {renderMainContent()}
        </div>
      </div>

      {createPortal(appDialogs, document.body)}
    </div>
  );
}
