/** 编排状态（与 api/agents/types OrchestratorState 对齐） */
type OrchestratorState =
  | "schema_explore"
  | "quality_analyze"
  | "human_confirm"
  | "repair_generate"
  | "sql_verify"
  | "script_gen"
  | "artifact_export"
  | "external_verify"
  | "done"
  | "failed";

/** 编排状态中文标签 */
const STATE_LABELS: Record<OrchestratorState, string> = {
  schema_explore: "数据探查",
  quality_analyze: "质量分析",
  human_confirm: "规则确认",
  repair_generate: "SQL 生成",
  sql_verify: "SQL 校验",
  script_gen: "脚本生成",
  artifact_export: "脚本包导出",
  external_verify: "外部校验",
  done: "已完成",
  failed: "失败",
};

interface OrchestratorProgressProps {
  runId?: string;
  state?: OrchestratorState | string;
  repairRound?: number;
  className?: string;
}

/** 展示当前 orchestration run 状态（来自 orchestrator.listBySession / chat 回传） */
export function OrchestratorProgress({
  runId,
  state,
  repairRound = 0,
  className = "",
}: OrchestratorProgressProps) {
  if (!runId || !state) return null;

  const label = STATE_LABELS[state as OrchestratorState] ?? state;
  const isTerminal = state === "done" || state === "failed";
  const isPaused = state === "human_confirm";

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs border ${
        isTerminal
          ? state === "done"
            ? "bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/30 dark:border-emerald-800"
            : "bg-destructive/10 border-destructive/30 text-destructive"
          : isPaused
            ? "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/30 dark:border-amber-800"
            : "bg-sky-50 border-sky-200 text-sky-900 dark:bg-sky-950/30 dark:border-sky-800"
      } ${className}`}
      title={`编排 runId: ${runId}`}
    >
      <span className="font-medium">编排</span>
      <span className="opacity-70">·</span>
      <span>{label}</span>
      {repairRound > 0 && (
        <>
          <span className="opacity-70">·</span>
          <span>修复轮次 {repairRound}</span>
        </>
      )}
    </div>
  );
}
