import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Info,
  BarChart3,
  Shield,
  Target,
  Sparkles,
  FileCheck,
} from "lucide-react";
import type { QualityReport } from "@contracts/types";
import type { ScoreDiffEntry } from "@/lib/pipelineRunDiff";

interface QualityPanelProps {
  report: QualityReport;
  scoreDiff?: ScoreDiffEntry[];
  onConfirmAll: () => void;
  onAdjust: () => void;
}

export function QualityPanel({ report, scoreDiff }: QualityPanelProps) {
  const { score, highPriorityIssues, mediumPriorityIssues, lowPriorityIssues, summary } = report;

  const getScoreColor = (value: number) => {
    if (value >= 90) return "text-emerald-500";
    if (value >= 70) return "text-primary";
    if (value >= 50) return "text-amber-500";
    return "text-destructive";
  };

  const getScoreBg = (value: number) => {
    if (value >= 90) return "bg-emerald-500";
    if (value >= 70) return "bg-primary";
    if (value >= 50) return "bg-amber-500";
    return "bg-destructive";
  };

  const getScoreLabel = (value: number) => {
    if (value >= 90) return "优秀";
    if (value >= 70) return "良好";
    if (value >= 50) return "一般";
    return "较差";
  };

  const scoreDeltaMap = new Map((scoreDiff ?? []).map((s) => [s.label, s.delta]));

  return (
    <div className="space-y-4 min-w-0 py-4">
      {/* Overall Score */}
      <Card className="border-2">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4 min-w-0">
            <div className="relative w-20 h-20 flex-shrink-0">
              <svg className="w-20 h-20 -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                  className="text-muted/20"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${(score.overall / 100) * 264} 264`}
                  className={getScoreColor(score.overall)}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-xl font-bold ${getScoreColor(score.overall)}`}>
                  {score.overall}
                </span>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <Target className="w-3.5 h-3.5 text-primary shrink-0" />
                <h3 className="text-base font-semibold">数据质量评分</h3>
                <Badge className={`${getScoreBg(score.overall)} text-white`}>
                  {getScoreLabel(score.overall)}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{summary}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dimension Scores */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 min-w-0">
        {[
          { label: "完整性", value: score.completeness, icon: <Shield className="w-3.5 h-3.5" /> },
          { label: "唯一性", value: score.uniqueness, icon: <Sparkles className="w-3.5 h-3.5" /> },
          { label: "一致性", value: score.consistency, icon: <FileCheck className="w-3.5 h-3.5" /> },
          { label: "有效性", value: score.validity, icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
          { label: "准确性", value: score.accuracy, icon: <BarChart3 className="w-3.5 h-3.5" /> },
        ].map((dim) => (
          <Card key={dim.label} className="min-w-0">
            <CardContent className="p-2.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                {dim.icon}
                <span className="text-[11px] text-muted-foreground truncate">{dim.label}</span>
              </div>
              <p className={`text-lg font-bold ${getScoreColor(dim.value)}`}>
                {dim.value}
                {scoreDeltaMap.has(dim.label) && scoreDeltaMap.get(dim.label) !== 0 && (
                  <span
                    className={`ml-1 text-[10px] font-medium ${
                      (scoreDeltaMap.get(dim.label) ?? 0) > 0
                        ? "text-emerald-600"
                        : "text-destructive"
                    }`}
                  >
                    {(scoreDeltaMap.get(dim.label) ?? 0) > 0 ? "+" : ""}
                    {scoreDeltaMap.get(dim.label)}
                  </span>
                )}
              </p>
              <Progress value={dim.value} className="h-1.5 mt-2" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Issues by Priority */}
      <div className="space-y-3">
        {/* High Priority */}
        {highPriorityIssues.length > 0 && (
          <Card className="border-destructive/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2 text-destructive">
                <AlertTriangle className="w-4 h-4" />
                高优先级问题（{highPriorityIssues.length}项）
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 sm:p-6">
              <div className="overflow-x-auto max-h-48 overflow-y-auto w-full">
                <Table className="min-w-[560px] text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>字段</TableHead>
                      <TableHead>问题类型</TableHead>
                      <TableHead>影响行数</TableHead>
                      <TableHead>比例</TableHead>
                      <TableHead>清洗建议</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {highPriorityIssues.map((issue, idx) => (
                      <TableRow key={issue.id}>
                        <TableCell className="text-xs font-medium">{idx + 1}</TableCell>
                        <TableCell className="font-mono text-xs">{issue.column}</TableCell>
                        <TableCell>
                          <Badge variant="destructive" className="text-[10px]">
                            {issue.issueType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{issue.affectedRows.toLocaleString()}</TableCell>
                        <TableCell className="text-xs text-destructive">{issue.affectedPercent}%</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{issue.suggestion}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Medium Priority */}
        {mediumPriorityIssues.length > 0 && (
          <Card className="border-amber-500/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2 text-amber-500">
                <AlertCircle className="w-4 h-4" />
                中优先级问题（{mediumPriorityIssues.length}项）
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 sm:p-6">
              <div className="overflow-x-auto max-h-40 overflow-y-auto w-full">
                <Table className="min-w-[480px] text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>字段</TableHead>
                      <TableHead>问题类型</TableHead>
                      <TableHead>影响行数</TableHead>
                      <TableHead>建议</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mediumPriorityIssues.map((issue, idx) => (
                      <TableRow key={issue.id}>
                        <TableCell className="text-xs font-medium">{idx + 1}</TableCell>
                        <TableCell className="font-mono text-xs">{issue.column}</TableCell>
                        <TableCell>
                          <Badge variant="default" className="text-[10px] bg-amber-500">
                            {issue.issueType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{issue.affectedRows.toLocaleString()}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{issue.suggestion}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Low Priority */}
        {lowPriorityIssues.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
                <Info className="w-4 h-4" />
                低优先级问题（{lowPriorityIssues.length}项）
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {lowPriorityIssues.map((issue) => (
                  <Badge key={issue.id} variant="secondary" className="text-xs">
                    {issue.column}: {issue.issueType}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
