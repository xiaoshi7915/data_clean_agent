import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FileCode2,
  Play,
  TestTube,
  Download,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Copy,
  Check,
  Pencil,
  RotateCcw,
  ArrowRight,
  Database,
} from "lucide-react";
import type { SQLGenerationResult } from "@contracts/types";
import type { SqlStepDiffEntry } from "@/lib/pipelineRunDiff";
import { diffKindClassName, diffKindLabel } from "@/lib/pipelineRunDiff";

interface SQLPanelProps {
  sqlResult: SQLGenerationResult;
  onExecute: () => void;
  onDryRun: () => void;
  onModify: (stepNumber: number, newSql: string) => void;
  onExport: () => void;
  onExportBundle?: () => void;
  isLoading: boolean;
  embedded?: boolean;
  /** SCRIPT_ONLY 模式：隐藏真实执行，显示导出脚本包 */
  scriptOnly?: boolean;
  readOnly?: boolean;
  stepDiff?: SqlStepDiffEntry[];
}

export function SQLPanel({
  sqlResult,
  onExecute,
  onDryRun,
  onModify,
  onExport,
  onExportBundle,
  isLoading,
  embedded,
  scriptOnly = false,
  readOnly = false,
  stepDiff,
}: SQLPanelProps) {
  const stepDiffMap = new Map((stepDiff ?? []).map((s) => [s.stepNumber, s.kind]));
  const [activeTab, setActiveTab] = useState(embedded ? "consolidated" : "overview");
  const [editingStep, setEditingStep] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [copied, setCopied] = useState(false);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEdit = (step: typeof sqlResult.steps[0]) => {
    setEditingStep(step.stepNumber);
    setEditValue(step.sql);
  };

  const handleSaveEdit = () => {
    if (editingStep !== null) {
      onModify(editingStep, editValue);
      setEditingStep(null);
    }
  };

  const allSQL = sqlResult.steps.map((s) => s.sql).join("\n\n");
  const consolidatedSql = sqlResult.consolidatedSql || sqlResult.steps.find((s) => s.operationType === "INSERT")?.sql || "";

  return (
    <div className="space-y-4">
      {/* 合并清洗 SQL 主语句 */}
      {consolidatedSql && (
        <Card className="border-2 border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileCode2 className="w-4 h-4 text-primary" />
                主清洗 SQL（CREATE TABLE + INSERT SELECT）
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => handleCopy(consolidatedSql)}
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                复制
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="p-4 rounded-lg bg-background font-mono text-xs overflow-x-auto border">
              <code>{consolidatedSql}</code>
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <FileCode2 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">数据清洗SQL方案</h2>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Database className="w-3.5 h-3.5" />
              {sqlResult.targetDialect} | {sqlResult.targetDatabase}.{sqlResult.targetTable}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onExport} className="gap-1.5">
            <Download className="w-3.5 h-3.5" />
            导出SQL
          </Button>
          {scriptOnly && onExportBundle && (
            <Button variant="default" size="sm" onClick={onExportBundle} disabled={isLoading} className="gap-1.5">
              <Download className="w-3.5 h-3.5" />
              导出脚本包
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onDryRun} disabled={isLoading} className="gap-1.5">
            <TestTube className="w-3.5 h-3.5" />
            模拟执行
          </Button>
          {!scriptOnly && (
            <Button size="sm" onClick={onExecute} disabled={isLoading} className="gap-1.5">
              {isLoading ? (
                <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              执行清洗
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">总步骤</p>
            <p className="text-xl font-bold">{sqlResult.steps.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">预计影响行数</p>
            <p className="text-xl font-bold">{sqlResult.totalAffectedRows.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">高风险步骤</p>
            <p className="text-xl font-bold text-destructive">
              {sqlResult.steps.filter((s) => s.riskLevel === "high").length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">数据库方言</p>
            <p className="text-lg font-bold">{sqlResult.targetDialect.toUpperCase()}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="consolidated">主清洗 SQL</TabsTrigger>
          <TabsTrigger value="overview">执行概览</TabsTrigger>
          <TabsTrigger value="sql">全部步骤</TabsTrigger>
          <TabsTrigger value="rollback">回滚方案</TabsTrigger>
        </TabsList>

        <TabsContent value="consolidated" className="mt-4">
          <Card>
            <CardContent className="p-4">
              <pre className="p-4 rounded-lg bg-muted/50 font-mono text-xs overflow-x-auto">
                <code>{consolidatedSql || "暂无合并 SQL"}</code>
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <ScrollArea className={embedded ? undefined : "max-h-96"}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">步骤</TableHead>
                      <TableHead>名称</TableHead>
                      <TableHead>操作</TableHead>
                      <TableHead>影响行数</TableHead>
                      <TableHead>耗时预估</TableHead>
                      <TableHead>风险</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sqlResult.steps.map((step) => {
                      const diffKind = stepDiffMap.get(step.stepNumber);
                      return (
                      <TableRow
                        key={step.stepNumber}
                        className={
                          diffKind && diffKind !== "unchanged"
                            ? `border ${diffKindClassName(diffKind)}`
                            : undefined
                        }
                      >
                        <TableCell className="font-mono text-xs font-medium">
                          {step.stepNumber}
                          {diffKind && diffKind !== "unchanged" && (
                            <Badge variant="outline" className={`ml-1 text-[9px] ${diffKindClassName(diffKind)}`}>
                              {diffKindLabel(diffKind)}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm font-medium">{step.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs font-mono">
                            {step.operationType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {step.affectedRows > 0 ? step.affectedRows.toLocaleString() : "-"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {step.estimatedTime}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {step.riskLevel === "high" ? (
                              <ShieldAlert className="w-3.5 h-3.5 text-destructive" />
                            ) : step.riskLevel === "medium" ? (
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                            ) : (
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                            )}
                            <Badge
                              variant={
                                step.riskLevel === "high"
                                  ? "destructive"
                                  : step.riskLevel === "medium"
                                  ? "default"
                                  : "secondary"
                              }
                              className="text-[10px]"
                            >
                              {step.riskLevel === "high" ? "高" : step.riskLevel === "medium" ? "中" : "低"}
                            </Badge>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                    })}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sql" className="mt-4 space-y-3">
          {sqlResult.steps.map((step) => (
            <Card key={step.stepNumber} className={step.riskLevel === "high" ? "border-destructive/20" : ""}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs font-mono">
                      步骤 {step.stepNumber}
                    </Badge>
                    <CardTitle className="text-sm">{step.name}</CardTitle>
                    {step.riskLevel === "high" && (
                      <Badge variant="destructive" className="text-[10px]">高风险</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => handleCopy(step.sql)}
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => !readOnly && handleEdit(step)}
                      disabled={readOnly}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {editingStep === step.stepNumber ? (
                  <div className="space-y-2">
                    <textarea
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="w-full h-32 p-3 rounded-lg border bg-muted font-mono text-xs resize-y focus:outline-none focus:ring-2 focus:ring-primary"
                      spellCheck={false}
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingStep(null)}
                      >
                        取消
                      </Button>
                      <Button size="sm" onClick={handleSaveEdit}>
                        保存修改
                      </Button>
                    </div>
                  </div>
                ) : (
                  <pre className="p-3 rounded-lg bg-muted/50 font-mono text-xs overflow-x-auto">
                    <code>{step.sql}</code>
                  </pre>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="rollback" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-primary" />
                回滚方案
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/10">
                <p className="text-xs text-amber-600 font-medium mb-1">⚠️ 注意事项</p>
                <p className="text-xs text-muted-foreground">
                  执行清洗前已自动创建备份表。如需回滚，可使用以下SQL恢复数据。
                </p>
              </div>

              <div>
                <p className="text-xs font-medium mb-2">备份SQL</p>
                <pre className="p-3 rounded-lg bg-muted/50 font-mono text-xs overflow-x-auto">
                  <code>{sqlResult.backupSql}</code>
                </pre>
              </div>

              <Separator />

              <div>
                <p className="text-xs font-medium mb-2">回滚SQL</p>
                <pre className="p-3 rounded-lg bg-muted/50 font-mono text-xs overflow-x-auto">
                  <code>{sqlResult.rollbackSql}</code>
                </pre>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => handleCopy(sqlResult.rollbackSql)} className="gap-1.5">
                  <Copy className="w-3.5 h-3.5" />
                  复制回滚SQL
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleCopy(allSQL)} className="gap-1.5">
                  <Copy className="w-3.5 h-3.5" />
                  复制全部SQL
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Separator />

      {/* Action bar */}
      <div className={`flex items-center justify-between ${embedded ? "pb-6" : "pb-4"}`}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          建议在业务低峰期执行，大表操作建议分批执行
        </div>
        <div className="flex gap-2">
          {scriptOnly && onExportBundle && (
            <Button onClick={onExportBundle} disabled={isLoading} className="gap-2">
              <Download className="w-4 h-4" />
              导出脚本包
            </Button>
          )}
          <Button variant="outline" onClick={onDryRun} disabled={isLoading || readOnly} className="gap-1.5">
            <TestTube className="w-4 h-4" />
            模拟执行
          </Button>
          {!scriptOnly && (
            <Button onClick={onExecute} disabled={isLoading || readOnly} className="gap-2">
              {isLoading ? (
                <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              执行清洗
              <ArrowRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
