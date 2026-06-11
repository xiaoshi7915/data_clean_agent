import type { CleaningPhase } from "@contracts/types";
import {
  Search,
  BarChart3,
  CheckSquare,
  FileCode2,
  Play,
  RotateCcw,
  Circle,
} from "lucide-react";

interface PhaseIndicatorProps {
  currentPhase: CleaningPhase;
  completedPhases: CleaningPhase[];
}

const phases: { id: CleaningPhase; label: string; icon: React.ReactNode }[] = [
  { id: "explore", label: "探查", icon: <Search className="w-3.5 h-3.5" /> },
  { id: "analyze", label: "分析", icon: <BarChart3 className="w-3.5 h-3.5" /> },
  { id: "confirm", label: "确认", icon: <CheckSquare className="w-3.5 h-3.5" /> },
  { id: "generate", label: "生成", icon: <FileCode2 className="w-3.5 h-3.5" /> },
  { id: "execute", label: "执行", icon: <Play className="w-3.5 h-3.5" /> },
];

export function PhaseIndicator({ currentPhase, completedPhases }: PhaseIndicatorProps) {
  if (currentPhase === "idle" || currentPhase === "retry") {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted text-xs text-muted-foreground">
        <Circle className="w-3 h-3" />
        <span className="hidden sm:inline">{currentPhase === "retry" ? "重试模式" : "等待开始"}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0">
      {phases.map((phase, idx) => {
        const isCompleted = completedPhases.includes(phase.id);
        const isCurrent = currentPhase === phase.id;

        return (
          <div key={phase.id} className="flex items-center">
            <div
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all duration-300 ${
                isCurrent
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : isCompleted
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {phase.icon}
              <span className="hidden sm:inline">{phase.label}</span>
            </div>
            {idx < phases.length - 1 && (
              <div
                className={`w-4 h-px mx-0.5 ${
                  isCompleted ? "bg-primary/40" : "bg-border"
                }`}
              />
            )}
          </div>
        );
      })}
      <div className="flex items-center ml-1">
        <div className="w-4 h-px bg-destructive/40 mx-0.5" />
        <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium bg-destructive/10 text-destructive">
          <RotateCcw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">重试</span>
        </div>
      </div>
    </div>
  );
}
