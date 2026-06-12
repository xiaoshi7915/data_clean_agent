import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

import {
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Zap,
  RotateCcw,
  Download,
  TrendingUp,
  ArrowLeft,
} from "lucide-react";
import type { ExecutionResult } from "@contracts/types";

interface ExecutionPanelProps {
  result: ExecutionResult | null;
  /** 当前 run 的历史执行记录（最新在前） */
  executionHistory?: ExecutionResult[];
  onRetry: () => void;
  onExportSQL: () => void;
  /** SCRIPT_ONLY 模式：提示导出脚本包而非真实执行 */
  scriptOnly?: boolean;
  onExportBundle?: () => void;
  isFileSource?: boolean;
  /** 返回会话聊天视图（不丢失执行结果等会话状态） */
  onBack?: () => void;
}

export function ExecutionPanel({
  result,
  executionHistory = [],
  onRetry,
  onExportSQL,
  scriptOnly = false,
  onExportBundle,
  isFileSource = false,
  onBack,
}: ExecutionPanelProps) {
  const backButton = onBack ? (
    <Button variant="outline" onClick={onBack} className="gap-1.5 w-fit">
      <ArrowLeft className="w-3.5 h-3.5" />
      返回会话
    </Button>
  ) : null;

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        {backButton && <div className="self-start w-full mb-2">{backButton}</div>}
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          <Play className="w-8 h-8 text-primary" />
        </div>
        <h3 className="text-lg font-semibold">{scriptOnly ? "脚本已就绪" : "准备执行"}</h3>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          {scriptOnly
            ? "请导出脚本包后在本地/调度系统执行"
            : isFileSource
              ? "清洗方案已就绪，请点击执行生成 _cleaned 文件"
              : "SQL已生成，请点击执行按钮开始数据清洗"}
        </p>
        {scriptOnly && onExportBundle && (
          <Button onClick={onExportBundle} className="gap-1.5">
            <Download className="w-3.5 h-3.5" />
            导出脚本包
          </Button>
        )}
      </div>
    );
  }

  const successSteps = result.stepResults.filter((s) => s.status === "success").length;
  const failedSteps = result.stepResults.filter((s) => s.status === "failed").length;
  const totalSteps = result.stepResults.length;
  const progress = totalSteps > 0 ? (successSteps / totalSteps) * 100 : 0;

  const hasFailures = failedSteps > 0;
  const isComplete = result.overallStatus === "success" || result.overallStatus === "partial";

  return (
    <div className="space-y-4">
      {backButton}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
            result.overallStatus === "success"
              ? "bg-emerald-500/10"
              : result.overallStatus === "partial"
              ? "bg-amber-500/10"
              : "bg-destructive/10"
          }`}>
            {result.overallStatus === "success" ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            ) : result.overallStatus === "partial" ? (
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            ) : (
              <XCircle className="w-5 h-5 text-destructive" />
            )}
          </div>
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              执行
              {isComplete ? "完成" : "中"}
              <Badge
                variant={
                  result.overallStatus === "success"
                    ? "default"
                    : result.overallStatus === "partial"
                    ? "default"
                    : "destructive"
                }
                className={
                  result.overallStatus === "success"
                    ? "bg-emerald-500"
                    : result.overallStatus === "partial"
                    ? "bg-amber-500"
                    : ""
                }
              >
                {result.overallStatus === "success" ? "全部成功" : result.overallStatus === "partial" ? "部分成功" : "执行失败"}
              </Badge>
            </h2>
            <p className="text-sm text-muted-foreground">
              {successSteps}/{totalSteps} 步骤成功
              {result.backupTableName && ` | 备份表：${result.backupTableName}`}
              {result.outputFileName && ` | 输出文件：${result.outputFileName}`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {result.downloadUrl && (
            <Button asChild variant="default" className="gap-1.5">
              <a href={result.downloadUrl} download={result.outputFileName}>
                <Download className="w-3.5 h-3.5" />
                下载清洗文件
              </a>
            </Button>
          )}
          {hasFailures && (
            <Button variant="outline" onClick={onRetry} className="gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" />
              重试/修正
            </Button>
          )}
          {scriptOnly && onExportBundle && (
            <Button variant="default" onClick={onExportBundle} className="gap-1.5">
              <Download className="w-3.5 h-3.5" />
              导出脚本包
            </Button>
          )}
          {!scriptOnly && !isFileSource && (
            <Button variant="outline" onClick={onExportSQL} className="gap-1.5">
              <Download className="w-3.5 h-3.5" />
              导出SQL
            </Button>
          )}
        </div>
      </div>

      {/* Progress */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">执行进度</span>
            <span className="text-sm text-muted-foreground">{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-2" />
          <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              {successSteps} 成功
            </span>
            {failedSteps > 0 && (
              <span className="flex items-center gap-1">
                <XCircle className="w-3 h-3 text-destructive" />
                {failedSteps} 失败
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {result.startedAt ? new Date(result.startedAt).toLocaleTimeString() : "-"}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Step Results */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            步骤执行详情
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {result.stepResults.map((step) => (
              <div
                key={step.stepNumber}
                className={`flex items-center gap-3 p-3 rounded-lg border ${
                  step.status === "success"
                    ? "border-emerald-500/20 bg-emerald-500/5"
                    : step.status === "failed"
                    ? "border-destructive/20 bg-destructive/5"
                    : "border-border bg-muted/50"
                }`}
              >
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                  step.status === "success"
                    ? "bg-emerald-500/10"
                    : step.status === "failed"
                    ? "bg-destructive/10"
                    : "bg-muted"
                }`}>
                  {step.status === "success" ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  ) : step.status === "failed" ? (
                    <XCircle className="w-3.5 h-3.5 text-destructive" />
                  ) : (
                    <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-muted-foreground">步骤{step.stepNumber}</span>
                    <span className="text-sm font-medium">{step.name}</span>
                  </div>
                  {step.error && (
                    <p className="text-xs text-destructive mt-0.5">{step.error}</p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  {step.affectedRows > 0 && (
                    <p className="text-xs font-medium">{step.affectedRows.toLocaleString()} 行</p>
                  )}
                  <p className="text-xs text-muted-foreground">{step.durationMs}ms</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Execution History */}
      {executionHistory.length > 1 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              执行历史（{executionHistory.length} 次）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {executionHistory.map((run) => {
                const ok = run.stepResults.filter((s) => s.status === "success").length;
                const fail = run.stepResults.filter((s) => s.status === "failed").length;
                const totalMs = run.stepResults.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
                return (
                  <div
                    key={run.executionId}
                    className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-muted/30 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{run.executionId}</p>
                      <p className="text-xs text-muted-foreground">
                        {run.startedAt ? new Date(run.startedAt).toLocaleString() : "-"}
                        {" · "}
                        {ok}/{run.stepResults.length} 步成功
                        {fail > 0 ? ` · ${fail} 失败` : ""}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <Badge
                        variant={run.overallStatus === "success" ? "default" : "destructive"}
                        className={run.overallStatus === "success" ? "bg-emerald-500" : ""}
                      >
                        {run.overallStatus}
                      </Badge>
                      <p className="text-xs text-muted-foreground mt-1">{totalMs}ms</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quality Comparison */}
      {result.metricsAfter && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              清洗效果对比
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-xs text-muted-foreground mb-2">清洗前</p>
                <div className="space-y-1.5">
                  {[
                    { label: "总分", value: result.metricsBefore.overall },
                    { label: "完整性", value: result.metricsBefore.completeness },
                    { label: "唯一性", value: result.metricsBefore.uniqueness },
                    { label: "一致性", value: result.metricsBefore.consistency },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{item.label}</span>
                      <span className="text-sm font-medium">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-2">清洗后</p>
                <div className="space-y-1.5">
                  {[
                    { label: "总分", value: result.metricsAfter.overall, delta: result.metricsAfter.overall - result.metricsBefore.overall },
                    { label: "完整性", value: result.metricsAfter.completeness, delta: result.metricsAfter.completeness - result.metricsBefore.completeness },
                    { label: "唯一性", value: result.metricsAfter.uniqueness, delta: result.metricsAfter.uniqueness - result.metricsBefore.uniqueness },
                    { label: "一致性", value: result.metricsAfter.consistency, delta: result.metricsAfter.consistency - result.metricsBefore.consistency },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{item.label}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium">{item.value}</span>
                        {item.delta !== undefined && item.delta !== 0 && (
                          <span className={`text-xs ${item.delta > 0 ? "text-emerald-500" : "text-destructive"}`}>
                            {item.delta > 0 ? "+" : ""}{item.delta}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error Display */}
      {result.error && (
        <Card className="border-destructive">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2 text-destructive">
              <XCircle className="w-4 h-4" />
              执行错误
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="p-3 rounded-lg bg-destructive/5 font-mono text-xs text-destructive overflow-x-auto">
              {result.error}
            </pre>
            <Button variant="outline" onClick={onRetry} className="mt-3 gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" />
              进入重试模式
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
