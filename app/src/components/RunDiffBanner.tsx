import { Badge } from "@/components/ui/badge";
import { GitCompare } from "lucide-react";
import type { PipelineRunDiff } from "@/lib/pipelineRunDiff";

interface RunDiffBannerProps {
  diff: PipelineRunDiff | null;
  className?: string;
}

/** 运行版本对比摘要条（相对上一次 run 的差异统计） */
export function RunDiffBanner({ diff, className }: RunDiffBannerProps) {
  if (!diff?.hasBaseline) return null;

  const totalChanges = diff.rulesChangedCount + diff.sqlChangedCount + diff.scoreChangedCount;
  if (totalChanges === 0) {
    return (
      <div
        className={`flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground ${className ?? ""}`}
      >
        <GitCompare className="w-3.5 h-3.5 shrink-0" />
        与第 {diff.baselineRunIndex} 次运行相比，规则、SQL 与质量评分均无变化
      </div>
    );
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs ${className ?? ""}`}
    >
      <GitCompare className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <span className="text-foreground">
        对比第 {diff.baselineRunIndex} 次 → 第 {diff.viewingRunIndex} 次：
      </span>
      {diff.rulesChangedCount > 0 && (
        <Badge variant="outline" className="text-[10px] h-5">
          规则 {diff.rulesChangedCount} 处
        </Badge>
      )}
      {diff.sqlChangedCount > 0 && (
        <Badge variant="outline" className="text-[10px] h-5">
          SQL {diff.sqlChangedCount} 处
        </Badge>
      )}
      {diff.scoreChangedCount > 0 && (
        <Badge variant="outline" className="text-[10px] h-5">
          评分 {diff.scoreChangedCount} 项
        </Badge>
      )}
    </div>
  );
}

interface ReadOnlyRunBannerProps {
  viewingRunIndex: number;
  currentRunIndex: number;
  onSwitchToCurrent?: () => void;
  className?: string;
}

/** 历史运行只读提示条 */
export function ReadOnlyRunBanner({
  viewingRunIndex,
  currentRunIndex,
  onSwitchToCurrent,
  className,
}: ReadOnlyRunBannerProps) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs ${className ?? ""}`}
    >
      <span className="text-foreground">
        正在查看第 {viewingRunIndex} 次运行（历史快照，只读）。编辑请切换到第 {currentRunIndex} 次（当前）。
      </span>
      {onSwitchToCurrent && (
        <button
          type="button"
          className="text-primary underline-offset-2 hover:underline font-medium"
          onClick={onSwitchToCurrent}
        >
          回到当前运行
        </button>
      )}
    </div>
  );
}

interface ReadOnlyRevisionBannerProps {
  viewingRevisionIndex: number;
  latestRevisionIndex: number;
  onSwitchToLatest?: () => void;
  className?: string;
}

/** 同 run 内历史里程碑只读提示条 */
export function ReadOnlyRevisionBanner({
  viewingRevisionIndex,
  latestRevisionIndex,
  onSwitchToLatest,
  className,
}: ReadOnlyRevisionBannerProps) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 rounded-md border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs ${className ?? ""}`}
    >
      <span className="text-foreground">
        正在查看里程碑 v{viewingRevisionIndex}（历史快照，只读）。编辑请返回最新 v
        {latestRevisionIndex}。
      </span>
      {onSwitchToLatest && (
        <button
          type="button"
          className="text-primary underline-offset-2 hover:underline font-medium"
          onClick={onSwitchToLatest}
        >
          回到最新版本
        </button>
      )}
    </div>
  );
}
