import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Database,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Columns,
  Rows3,
  FileSearch,
  BarChart3,
} from "lucide-react";
import type { ExplorationResult } from "@contracts/types";

interface ExplorationPanelProps {
  result: ExplorationResult;
  onConfirm: () => void;
  onSkip: () => void;
  isLoading: boolean;
  embedded?: boolean;
}

export function ExplorationPanel({ result, onConfirm, onSkip, isLoading, embedded }: ExplorationPanelProps) {
  const issueCount = result.issues.length;

  return (
    <div className="space-y-4 min-w-0 py-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <FileSearch className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">数据源探查报告</h2>
            <p className="text-xs text-muted-foreground truncate">{result.sourceName}</p>
          </div>
          {(result.sampleBasedStats || result.rowCountApproximate) && (
            <Badge variant="secondary" className="shrink-0">
              基于抽样探查
            </Badge>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={onSkip} disabled={isLoading}>
            跳过分析
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={isLoading} className="gap-2">
            进入质量分析
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 min-w-0">
        <Card className="min-w-0">
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5">
              <Rows3 className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-xs text-muted-foreground truncate">总行数</span>
            </div>
            <p className="text-lg font-bold mt-1">
              {result.totalRows.toLocaleString()}
              {result.rowCountApproximate && (
                <span className="text-xs font-normal text-muted-foreground ml-1">估算行数</span>
              )}
            </p>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5">
              <Columns className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-xs text-muted-foreground truncate">总列数</span>
            </div>
            <p className="text-lg font-bold mt-1">{result.totalCols}</p>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span className="text-xs text-muted-foreground truncate">潜在问题</span>
            </div>
            <p className="text-lg font-bold mt-1">{issueCount}</p>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-xs text-muted-foreground truncate">数据源</span>
            </div>
            <p className="text-sm font-bold mt-1 truncate">{result.sourceType.toUpperCase()}</p>
          </CardContent>
        </Card>
      </div>

      {/* Schema Overview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Columns className="w-4 h-4" />
            Schema 概览
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:p-6">
          <div className="overflow-x-auto w-full">
          {embedded ? (
            <Table className="min-w-[640px] text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>字段名</TableHead>
                  <TableHead>数据类型</TableHead>
                  <TableHead>可空</TableHead>
                  <TableHead>空值率</TableHead>
                  <TableHead>唯一值数</TableHead>
                  <TableHead>示例值</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.columnStats.map((col) => (
                  <TableRow key={col.columnName}>
                    <TableCell className="font-mono text-xs font-medium">
                      {col.columnName}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {col.dataType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {col.nullRate > 0 ? (
                        <Badge variant="secondary" className="text-xs">可空</Badge>
                      ) : (
                        <Badge variant="default" className="text-xs bg-emerald-500">NOT NULL</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={col.nullRate > 10 ? "text-destructive font-medium" : col.nullRate > 0 ? "text-amber-500" : "text-emerald-500"}>
                        {col.nullRate}%
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">
                      {col.uniqueCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap max-w-none">
                      {col.sampleValues.slice(0, 3).map((v) => String(v)).join(", ")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <ScrollArea className="max-h-64">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>字段名</TableHead>
                    <TableHead>数据类型</TableHead>
                    <TableHead>可空</TableHead>
                    <TableHead>空值率</TableHead>
                    <TableHead>唯一值数</TableHead>
                    <TableHead>示例值</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.columnStats.map((col) => (
                    <TableRow key={col.columnName}>
                      <TableCell className="font-mono text-xs font-medium">
                        {col.columnName}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {col.dataType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {col.nullRate > 0 ? (
                          <Badge variant="secondary" className="text-xs">可空</Badge>
                        ) : (
                          <Badge variant="default" className="text-xs bg-emerald-500">NOT NULL</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className={col.nullRate > 10 ? "text-destructive font-medium" : col.nullRate > 0 ? "text-amber-500" : "text-emerald-500"}>
                          {col.nullRate}%
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">
                        {col.uniqueCount.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap max-w-none">
                        {col.sampleValues.slice(0, 3).map((v) => String(v)).join(", ")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
          </div>
        </CardContent>
      </Card>

      {/* Sample Data */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileSearch className="w-4 h-4" />
            样本数据（前{Math.min(5, result.sampleData.length)}行）
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {result.schema.map((col) => (
                  <TableHead key={col.name} className="text-xs font-mono whitespace-nowrap">
                    {col.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.sampleData.slice(0, 5).map((row, idx) => (
                <TableRow key={idx}>
                  {result.schema.map((col) => (
                    <TableCell key={col.name} className="text-xs text-muted-foreground whitespace-nowrap">
                      {row[col.name] === null || row[col.name] === undefined
                        ? <span className="text-destructive/50 italic">NULL</span>
                        : String(row[col.name])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Issues */}
      {result.issues.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              初步发现的问题
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {result.issues.map((issue, idx) => (
              <div
                key={issue.id}
                className={`flex items-start gap-3 p-3 rounded-lg border ${
                  issue.severity === "high"
                    ? "border-destructive/20 bg-destructive/5"
                    : issue.severity === "medium"
                    ? "border-amber-500/20 bg-amber-500/5"
                    : "border-border bg-muted/50"
                }`}
              >
                <span className="text-xs font-bold mt-0.5 min-w-[20px]">{idx + 1}.</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-medium">{issue.column}</span>
                    <Badge
                      variant={issue.severity === "high" ? "destructive" : issue.severity === "medium" ? "default" : "secondary"}
                      className="text-[10px] h-5"
                    >
                      {issue.severity}
                    </Badge>
                  </div>
                  <p className="text-sm mt-1">{issue.description}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    影响 {issue.affectedRows.toLocaleString()} 行 ({issue.affectedPercent}%)
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Action bar */}
      <div className={`flex items-center justify-between ${embedded ? "pb-6" : "pb-4"}`}>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span className="text-sm text-muted-foreground">探查完成</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onSkip} disabled={isLoading}>
            跳过分析
          </Button>
          <Button onClick={onConfirm} disabled={isLoading} className="gap-2">
            <BarChart3 className="w-4 h-4" />
            进入质量分析
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
