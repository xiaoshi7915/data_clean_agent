import type {
  CleaningRule,
  DatabaseDialect,
  ExplorationResult,
  QualityReport,
  SQLGenerationResult,
  SQLStep,
} from "@contracts/types";

/** Agent 编排状态机步骤 */
export type OrchestratorState =
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

/** 编排事件（驱动状态转移） */
export type OrchestratorEvent =
  | "explore_complete"
  | "analyze_complete"
  | "confirm_complete"
  | "repair_complete"
  | "sql_verify_pass"
  | "sql_verify_fail"
  | "script_complete"
  | "export_complete"
  | "verify_pass"
  | "verify_fail"
  | "advance_pipeline"
  | "fail";

/** 外部校验结果（Soda / webhook） */
export interface VerificationResult {
  status: "pass" | "fail" | "skipped";
  details?: string;
  checksFailed?: number;
  checksPassed?: number;
  rawOutput?: string;
}

/** 前端可执行动作（由 handleUserMessage 返回） */
export interface OrchestratorFrontendAction {
  type: string;
  label: string;
  autoTrigger?: boolean;
}

/** 单步 Agent 类型 */
export type AgentStepKind =
  | "schema"
  | "quality"
  | "repair"
  | "verify"
  | "scriptGen"
  | "exportArtifacts";

export interface AgentStep {
  kind: AgentStepKind;
  label: string;
}

/** 通用 Agent 输入上下文 */
export interface AgentInput {
  sessionId: string;
  tableName?: string;
  dialect?: DatabaseDialect;
  databaseName?: string;
  exploration?: ExplorationResult;
  qualityReport?: QualityReport;
  rules?: CleaningRule[];
  sqlResult?: SQLGenerationResult;
  steps?: SQLStep[];
  columns?: string[];
}

/** 通用 Agent 输出 */
export interface AgentOutput<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface SchemaAgentOutput {
  exploration: ExplorationResult;
}

export interface QualityAgentOutput {
  report: QualityReport;
  rules: CleaningRule[];
}

export interface RepairAgentOutput {
  sqlResult: SQLGenerationResult;
}

export interface VerifyAgentOutput {
  valid: boolean;
  stepResults: Array<{ stepNumber: number; valid: boolean; errors: string[] }>;
}

export interface ScriptGenAgentOutput {
  checksYaml: string;
  sodaChecksPath: string;
}

export interface ExportArtifactsOutput {
  files: Array<{ path: string; content: string }>;
  manifest: Record<string, unknown>;
}

export interface OrchestratorContext {
  state: OrchestratorState;
  input: AgentInput;
  exploration?: ExplorationResult;
  qualityReport?: QualityReport;
  rules?: CleaningRule[];
  sqlResult?: SQLGenerationResult;
  verifyResult?: VerifyAgentOutput;
  externalVerification?: VerificationResult;
  scriptGen?: ScriptGenAgentOutput;
  artifacts?: ExportArtifactsOutput;
  /** 修复轮次（verify_fail 后回环 quality_analyze） */
  repairRound?: number;
  errors: string[];
}
