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
  | "done"
  | "failed";

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
  scriptGen?: ScriptGenAgentOutput;
  artifacts?: ExportArtifactsOutput;
  errors: string[];
}
