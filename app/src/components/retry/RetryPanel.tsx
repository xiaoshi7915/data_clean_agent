import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  Wrench,
  FileCode2,
  CheckCircle2,
  AlertCircle,
  Lightbulb,
  Zap,
  ChevronRight,
} from "lucide-react";
import type { RetryContext } from "@contracts/types";

interface RetryPanelProps {
  context: RetryContext;
  onSelectOption: (index: number) => void;
  onManualFix: (fix: string) => void;
  retryCount: number;
}

export function RetryPanel({ context, onSelectOption, onManualFix, retryCount }: RetryPanelProps) {
  const [manualSql, setManualSql] = useState("");
  const [showManualEdit, setShowManualEdit] = useState(false);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);

  const handleManualSubmit = () => {
    if (manualSql.trim()) {
      onManualFix(manualSql.trim());
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
            <Wrench className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              重试与修正
              <Badge variant="outline" className="text-xs">
                重试 {retryCount}/3
              </Badge>
            </h2>
            <p className="text-sm text-muted-foreground">
              步骤 {context.failedStep}: {context.failedStepName}
            </p>
          </div>
        </div>
      </div>

      {/* Error Diagnosis */}
      <Card className="border-destructive/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-4 h-4" />
            错误诊断
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">错误类型</p>
              <Badge variant="destructive" className="text-xs">
                {context.errorType}
              </Badge>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">失败步骤</p>
              <span className="text-sm font-medium">
                步骤 {context.failedStep}: {context.failedStepName}
              </span>
            </div>
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-1">错误信息</p>
            <pre className="p-3 rounded-lg bg-destructive/5 font-mono text-xs text-destructive overflow-x-auto">
              {context.errorMessage}
            </pre>
          </div>

          <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/10">
            <Lightbulb className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-medium text-primary mb-0.5">根因分析</p>
              <p className="text-xs text-muted-foreground">{context.rootCause}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Retry Options */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          修正方案
        </h3>

        {context.options.map((option, idx) => (
          <Card
            key={idx}
            className={`cursor-pointer transition-all ${
              selectedOption === idx
                ? "border-primary ring-1 ring-primary"
                : "hover:border-primary/30"
            }`}
            onClick={() => setSelectedOption(idx)}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant={selectedOption === idx ? "default" : "outline"} className="text-xs">
                    {option.label}
                  </Badge>
                  <CardTitle className="text-sm">{option.description}</CardTitle>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-2 p-2 rounded-lg bg-muted/50 mb-2">
                <FileCode2 className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                <pre className="font-mono text-xs text-muted-foreground overflow-x-auto">
                  <code>{option.fixedSql}</code>
                </pre>
              </div>
              <p className="text-xs text-muted-foreground">
                适用场景：{option.scenario}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Separator />

      {/* Actions */}
      <div className="flex flex-col gap-3">
        {selectedOption !== null && (
          <Button
            onClick={() => onSelectOption(selectedOption)}
            className="w-full gap-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            应用选中的修正方案
          </Button>
        )}

        {!showManualEdit ? (
          <Button
            variant="outline"
            onClick={() => setShowManualEdit(true)}
            className="w-full gap-2"
          >
            <FileCode2 className="w-4 h-4" />
            手动编辑SQL
          </Button>
        ) : (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileCode2 className="w-4 h-4" />
                手动编辑SQL
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                placeholder="输入修正后的SQL语句..."
                value={manualSql}
                onChange={(e) => setManualSql(e.target.value)}
                className="min-h-32 font-mono text-xs"
                spellCheck={false}
              />
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowManualEdit(false)} className="flex-1">
                  取消
                </Button>
                <Button onClick={handleManualSubmit} disabled={!manualSql.trim()} className="flex-1 gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  应用修改
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Retry limit warning */}
      {retryCount >= 3 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/10">
          <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-muted-foreground">
            已达到最大重试次数（3次）。建议导出SQL手动执行，或简化清洗规则分步执行。
          </div>
        </div>
      )}
    </div>
  );
}
