import type {
  CleaningRule,
  QualityReport,
  QualityScore,
  SQLGenerationResult,
  SQLStep,
} from "@contracts/types";

/** 单次运行的可对比快照（不含探查明细，聚焦规则/SQL/质量） */
export interface PipelineRunSnapshot {
  qualityReport?: QualityReport | null;
  cleaningRules?: CleaningRule[];
  generatedSQL?: SQLGenerationResult | null;
}

export type DiffKind = "added" | "removed" | "changed" | "unchanged";

export interface RuleDiffEntry {
  key: string;
  kind: DiffKind;
  current?: CleaningRule;
  baseline?: CleaningRule;
}

export interface SqlStepDiffEntry {
  stepNumber: number;
  kind: DiffKind;
  current?: SQLStep;
  baseline?: SQLStep;
}

export interface ScoreDiffEntry {
  key: keyof QualityScore;
  label: string;
  current: number;
  baseline: number;
  delta: number;
}

export interface PipelineRunDiff {
  baselineRunIndex: number;
  viewingRunIndex: number;
  hasBaseline: boolean;
  rules: RuleDiffEntry[];
  sqlSteps: SqlStepDiffEntry[];
  scores: ScoreDiffEntry[];
  rulesChangedCount: number;
  sqlChangedCount: number;
  scoreChangedCount: number;
}

const SCORE_LABELS: Record<keyof QualityScore, string> = {
  overall: "综合",
  completeness: "完整性",
  uniqueness: "唯一性",
  consistency: "一致性",
  validity: "有效性",
  accuracy: "准确性",
};

function ruleKey(rule: CleaningRule): string {
  return rule.id || `${rule.field}:${rule.action}:${rule.index}`;
}

/** 对比两条清洗规则是否实质相同 */
function rulesEqual(a: CleaningRule, b: CleaningRule): boolean {
  return (
    a.field === b.field &&
    a.action === b.action &&
    a.status === b.status &&
    a.name === b.name &&
    JSON.stringify(a.parameters) === JSON.stringify(b.parameters)
  );
}

/** 对比两个 SQL 步骤 */
function sqlStepsEqual(a: SQLStep, b: SQLStep): boolean {
  return a.name === b.name && a.sql.trim() === b.sql.trim() && a.operationType === b.operationType;
}

/** 计算当前 run 相对 baseline run 的差异 */
export function computePipelineRunDiff(
  viewingRunIndex: number,
  baselineRunIndex: number,
  current: PipelineRunSnapshot,
  baseline: PipelineRunSnapshot
): PipelineRunDiff {
  const hasBaseline = baselineRunIndex >= 1 && baselineRunIndex < viewingRunIndex;

  const currentRules = current.cleaningRules ?? [];
  const baselineRules = baseline.cleaningRules ?? [];
  const baselineRuleMap = new Map(baselineRules.map((r) => [ruleKey(r), r]));
  const currentRuleMap = new Map(currentRules.map((r) => [ruleKey(r), r]));
  const ruleKeys = new Set([...baselineRuleMap.keys(), ...currentRuleMap.keys()]);

  const rules: RuleDiffEntry[] = [];
  for (const key of ruleKeys) {
    const cur = currentRuleMap.get(key);
    const base = baselineRuleMap.get(key);
    if (cur && !base) {
      rules.push({ key, kind: "added", current: cur });
    } else if (!cur && base) {
      rules.push({ key, kind: "removed", baseline: base });
    } else if (cur && base) {
      rules.push({
        key,
        kind: rulesEqual(cur, base) ? "unchanged" : "changed",
        current: cur,
        baseline: base,
      });
    }
  }

  const currentSteps = current.generatedSQL?.steps ?? [];
  const baselineSteps = baseline.generatedSQL?.steps ?? [];
  const stepNumbers = new Set([
    ...currentSteps.map((s) => s.stepNumber),
    ...baselineSteps.map((s) => s.stepNumber),
  ]);

  const sqlSteps: SqlStepDiffEntry[] = [];
  for (const stepNumber of [...stepNumbers].sort((a, b) => a - b)) {
    const cur = currentSteps.find((s) => s.stepNumber === stepNumber);
    const base = baselineSteps.find((s) => s.stepNumber === stepNumber);
    if (cur && !base) {
      sqlSteps.push({ stepNumber, kind: "added", current: cur });
    } else if (!cur && base) {
      sqlSteps.push({ stepNumber, kind: "removed", baseline: base });
    } else if (cur && base) {
      sqlSteps.push({
        stepNumber,
        kind: sqlStepsEqual(cur, base) ? "unchanged" : "changed",
        current: cur,
        baseline: base,
      });
    }
  }

  const scores: ScoreDiffEntry[] = [];
  const curScore = current.qualityReport?.score;
  const baseScore = baseline.qualityReport?.score;
  if (curScore && baseScore) {
    for (const key of Object.keys(SCORE_LABELS) as (keyof QualityScore)[]) {
      const currentVal = curScore[key];
      const baselineVal = baseScore[key];
      scores.push({
        key,
        label: SCORE_LABELS[key],
        current: currentVal,
        baseline: baselineVal,
        delta: currentVal - baselineVal,
      });
    }
  }

  return {
    baselineRunIndex,
    viewingRunIndex,
    hasBaseline,
    rules,
    sqlSteps,
    scores,
    rulesChangedCount: rules.filter((r) => r.kind !== "unchanged").length,
    sqlChangedCount: sqlSteps.filter((s) => s.kind !== "unchanged").length,
    scoreChangedCount: scores.filter((s) => s.delta !== 0).length,
  };
}

export function diffKindLabel(kind: DiffKind): string {
  switch (kind) {
    case "added":
      return "新增";
    case "removed":
      return "删除";
    case "changed":
      return "变更";
    case "unchanged":
      return "未变";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function diffKindClassName(kind: DiffKind): string {
  switch (kind) {
    case "added":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
    case "removed":
      return "bg-destructive/15 text-destructive border-destructive/30";
    case "changed":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
    case "unchanged":
      return "bg-muted text-muted-foreground border-transparent";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
