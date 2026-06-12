import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TableSelectPanel } from "@/components/explore/TableSelectPanel";
import { ExplorationPanel } from "@/components/explore/ExplorationPanel";
import { QualityPanel } from "@/components/analyze/QualityPanel";
import { RulesPanel } from "@/components/rules/RulesPanel";
import { RuleRecommendationsPanel } from "@/components/rules/RuleRecommendationsPanel";
import { SQLPanel } from "@/components/sql/SQLPanel";
import { ArrowRight, Download, FileCode2, ListChecks } from "lucide-react";
import { downloadJsonFile } from "@/lib/downloadReport";
import { RunDiffBanner } from "@/components/RunDiffBanner";
import type { PipelineRunDiff } from "@/lib/pipelineRunDiff";
import type {
  CleaningRule,
  DataSourceConfig,
  ExplorationResult,
  QualityReport,
  SQLGenerationResult,
} from "@contracts/types";
import type { CustomRuleInput } from "@/components/rules/RulesPanel";

export type SessionDialogType =
  | "selectTable"
  | "explore"
  | "quality"
  | "rules"
  | "sql"
  | null;

interface SessionDialogsProps {
  openDialog: SessionDialogType;
  onClose: () => void;
  onOpenDialog: (dialog: SessionDialogType) => void;
  sessionId: string;
  dataSource: DataSourceConfig | null;
  targetTable: string;
  onSelectTable: (table: string) => void;
  onExplore: (table: string, options?: { exactRowCount?: boolean }) => void;
  onRunFullPipeline?: (table: string, options?: { exactRowCount?: boolean }) => void | Promise<void>;
  /** 选表面板探查按钮文案（开始探查 / 重新探查） */
  tableExploreButtonLabel?: string;
  explorationResult: ExplorationResult | null;
  qualityReport: QualityReport | null;
  cleaningRules: CleaningRule[];
  generatedSQL: SQLGenerationResult | null;
  onRuleStatusChange: (ruleId: string, status: CleaningRule["status"]) => void;
  onRuleParameterChange: (ruleId: string, params: Record<string, unknown>) => void;
  onAddCustomRule?: (input: CustomRuleInput) => void | Promise<void>;
  onDeleteCustomRule?: (ruleId: string) => void | Promise<void>;
  onConfirmAllRules: () => void;
  onGenerateSQL: () => void;
  onStartAnalysis: () => void;
  onExecuteSQL: (dryRun: boolean) => void;
  onModifySQL: (stepNum: number, newSql: string) => void;
  onExportSQL: () => void;
  onExportArtifactBundle?: () => void | Promise<void>;
  scriptOnly?: boolean;
  onExportContractYaml?: () => void | Promise<void>;
  onExportContractJson?: () => void | Promise<void>;
  onImportContract?: (
    source: string,
    format?: "yaml" | "json" | "auto"
  ) => void | Promise<boolean>;
  isLoading: boolean;
  isPipelineRunning?: boolean;
  /** 历史 run 只读 */
  readOnly?: boolean;
  /** 与上一 run 的差异（高亮用） */
  runDiff?: PipelineRunDiff | null;
}

export function SessionDialogs({
  openDialog,
  onClose,
  onOpenDialog,
  sessionId,
  dataSource,
  targetTable,
  onSelectTable,
  onExplore,
  onRunFullPipeline,
  tableExploreButtonLabel,
  explorationResult,
  qualityReport,
  cleaningRules,
  generatedSQL,
  onRuleStatusChange,
  onRuleParameterChange,
  onAddCustomRule,
  onDeleteCustomRule,
  onConfirmAllRules,
  onGenerateSQL,
  onStartAnalysis,
  onExecuteSQL,
  onModifySQL,
  onExportSQL,
  onExportArtifactBundle,
  scriptOnly = true,
  onExportContractYaml,
  onExportContractJson,
  onImportContract,
  isLoading,
  isPipelineRunning = false,
  readOnly = false,
  runDiff = null,
}: SessionDialogsProps) {
  const confirmedCount = cleaningRules.filter((r) => r.status === "confirmed").length;
  const pendingCount = cleaningRules.filter((r) => r.status === "pending").length;

  return (
    <>
      <Dialog
        open={openDialog === "selectTable" && !dataSource?.fileConfig}
        onOpenChange={(o) => !o && onClose()}
      >
        <DialogContent className="sm:max-w-4xl w-full min-w-[36rem] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>选择要探查的数据表</DialogTitle>
          </DialogHeader>
          {dataSource && (
            <TableSelectPanel
              embedded
              sessionId={sessionId}
              dataSource={dataSource}
              selectedTable={targetTable}
              onSelectTable={onSelectTable}
              exploreButtonLabel={tableExploreButtonLabel}
              onExplore={(table, options) => {
                onExplore(table, options);
                onClose();
              }}
              onRunFullPipeline={async (table, options) => {
                if (onRunFullPipeline) {
                  await onRunFullPipeline(table, options);
                  onClose();
                }
              }}
              isLoading={isLoading}
              isPipelineRunning={isPipelineRunning}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={openDialog === "explore"} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-6xl max-w-[95vw] w-full h-[90vh] max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
          {explorationResult && (
            <Button
              variant="outline"
              size="sm"
              className="absolute top-4 right-14 z-10 h-8 gap-1.5 text-xs"
              onClick={() =>
                downloadJsonFile(
                  explorationResult,
                  `exploration_${explorationResult.sourceName}_${Date.now()}.json`
                )
              }
            >
              <Download className="w-3.5 h-3.5" />
              下载
            </Button>
          )}
          <DialogHeader className="px-6 pt-6 pb-3 shrink-0 border-b">
            <DialogTitle className="text-base">数据探查报告</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6">
            {explorationResult && (
              <ExplorationPanel
                embedded
                result={explorationResult}
                onConfirm={() => {
                  onClose();
                  onStartAnalysis();
                }}
                onSkip={() => {
                  onClose();
                  onStartAnalysis();
                }}
                isLoading={isLoading}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={openDialog === "quality"} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-6xl max-w-[95vw] w-full h-[90vh] max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
          {qualityReport && (
            <Button
              variant="outline"
              size="sm"
              className="absolute top-4 right-14 z-10 h-8 gap-1.5 text-xs"
              onClick={() =>
                downloadJsonFile(qualityReport, `quality_report_${Date.now()}.json`)
              }
            >
              <Download className="w-3.5 h-3.5" />
              下载
            </Button>
          )}
          <DialogHeader className="px-6 pt-6 pb-3 shrink-0 border-b">
            <DialogTitle className="text-base">质量分析报告</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6">
            {runDiff?.hasBaseline && (
              <div className="pt-4">
                <RunDiffBanner diff={runDiff} />
              </div>
            )}
            {qualityReport && (
              <QualityPanel
                report={qualityReport}
                scoreDiff={runDiff?.scores}
                onConfirmAll={() => {
                  if (readOnly) return;
                  onClose();
                  onConfirmAllRules();
                }}
                onAdjust={() => {
                  onClose();
                  onOpenDialog("rules");
                }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={openDialog === "rules"} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-6xl max-w-[95vw] w-full h-[90vh] max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-3 shrink-0 border-b">
            <DialogTitle className="text-base">清洗规则确认</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6">
            <RuleRecommendationsPanel
              rules={cleaningRules}
              onAddRule={(ruleId) => onRuleStatusChange(ruleId, "confirmed")}
            />
            <RulesPanel
              embedded
              hideFooter
              rules={cleaningRules}
              readOnly={readOnly}
              ruleDiff={runDiff?.rules}
              availableFields={explorationResult?.schema.map((c) => c.name) ?? []}
              onRuleStatusChange={onRuleStatusChange}
              onParameterChange={onRuleParameterChange}
              onAddCustomRule={onAddCustomRule}
              onDeleteCustomRule={onDeleteCustomRule}
              onConfirmAll={onConfirmAllRules}
              onGenerateSQL={onGenerateSQL}
              onExportYaml={onExportContractYaml}
              onExportJson={onExportContractJson}
              onImportContract={onImportContract}
              isLoading={isLoading}
            />
          </div>
          <div className="shrink-0 border-t bg-background px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-muted-foreground">
              已确认{" "}
              <span className="font-semibold text-foreground">{confirmedCount}</span> /{" "}
              {cleaningRules.length} 条规则
            </div>
            <div className="flex items-center gap-2">
              {pendingCount > 0 && (
                <Button
                  variant="outline"
                  onClick={onConfirmAllRules}
                  disabled={isLoading || readOnly}
                  className="gap-2"
                >
                  <ListChecks className="w-4 h-4" />
                  确认全部
                </Button>
              )}
              <Button
                onClick={() => {
                  onClose();
                  onGenerateSQL();
                }}
                disabled={isLoading || readOnly || confirmedCount === 0}
                className="gap-2"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    生成中...
                  </span>
                ) : (
                  <>
                    <FileCode2 className="w-4 h-4" />
                    生成清洗SQL
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={openDialog === "sql"} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-6xl max-w-[95vw] w-full h-[90vh] max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-3 shrink-0 border-b">
            <DialogTitle className="text-base">清洗 SQL</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6">
            {generatedSQL && (
              <SQLPanel
                embedded
                sqlResult={generatedSQL}
                readOnly={readOnly}
                stepDiff={runDiff?.sqlSteps}
                scriptOnly={scriptOnly}
                onExecute={() => {
                  onClose();
                  onExecuteSQL(false);
                }}
                onDryRun={() => {
                  onClose();
                  onExecuteSQL(true);
                }}
                onModify={onModifySQL}
                onExport={onExportSQL}
                onExportBundle={() => void onExportArtifactBundle?.()}
                isLoading={isLoading}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
