import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { History } from "lucide-react";
import type { PipelineRunSummary } from "@contracts/types";

interface PipelineRunSwitcherProps {
  runs: PipelineRunSummary[];
  currentRunIndex: number;
  viewingRunIndex: number;
  onSwitch: (runIndex: number) => void;
  disabled?: boolean;
}

/** 会话内流水线运行版本切换（重试历史对比） */
export function PipelineRunSwitcher({
  runs,
  currentRunIndex,
  viewingRunIndex,
  onSwitch,
  disabled,
}: PipelineRunSwitcherProps) {
  if (runs.length <= 1) return null;

  return (
    <div className="flex items-center gap-2 shrink-0">
      <History className="w-4 h-4 text-muted-foreground" />
      <Select
        value={String(viewingRunIndex)}
        onValueChange={(v) => onSwitch(Number(v))}
        disabled={disabled}
      >
        <SelectTrigger className="h-8 w-[140px] text-xs">
          <SelectValue placeholder="选择运行" />
        </SelectTrigger>
        <SelectContent>
          {runs.map((run) => (
            <SelectItem key={run.runIndex} value={String(run.runIndex)}>
              第{run.runIndex}次
              {run.runIndex === currentRunIndex ? "（当前）" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {viewingRunIndex !== currentRunIndex && (
        <Badge variant="secondary" className="text-xs">
          历史快照
        </Badge>
      )}
    </div>
  );
}
