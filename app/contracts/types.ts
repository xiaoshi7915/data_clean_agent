// ============================================================
// DataClean Agent - Core Type Definitions
// ============================================================

export type CleaningPhase =
  | "idle"
  | "explore"
  | "analyze"
  | "confirm"
  | "generate"
  | "execute"
  | "retry";

/** 会话探查范围：单表 / 单文件 / 整库 */
export type SessionScope = "table" | "file" | "whole_db";

export type DataSourceType = "mysql" | "postgresql" | "sqlite" | "sqlserver" | "oracle" | "csv" | "json" | "xml" | "xlsx";

export type DatabaseDialect = "mysql" | "postgresql" | "sqlite" | "sqlserver" | "oracle";

export type FileType = "csv" | "json" | "xml" | "xlsx";

export type RuleStatus = "pending" | "confirmed" | "skipped";

export type ExecutionStatus = "pending" | "running" | "success" | "failed" | "partial";

export type IssueSeverity = "high" | "medium" | "low";

export type CleaningAction =
  | "dedup"
  | "fill_null"
  | "format"
  | "truncate"
  | "convert_type"
  | "remove"
  | "standardize"
  | "split"
  | "merge";

/** 九大类数据质量维度（与 cleaningActionRegistry 对齐） */
export type RuleQualityCategory =
  | "integrity"
  | "accuracy"
  | "consistency"
  | "uniqueness"
  | "validity"
  | "text"
  | "document"
  | "filter"
  | "skeleton"
  | "metrics";

// ---- Data Source Configuration ----

export interface DBConnectionConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  schema?: string;
}

export interface FileUploadConfig {
  fileName: string;
  fileSize: number;
  fileType: FileType;
  filePath: string;
  encoding?: string;
  delimiter?: string;
  hasHeader?: boolean;
}

export interface DataSourceConfig {
  type: DataSourceType;
  name: string;
  dbConfig?: DBConnectionConfig;
  fileConfig?: FileUploadConfig;
}

// ---- Schema & Exploration ----

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  maxLength?: number;
  isPrimary?: boolean;
}

export interface SchemaOverview {
  tableName: string;
  columns: ColumnInfo[];
  rowCount: number;
  columnCount: number;
}

export interface DatabaseTableInfo {
  name: string;
  comment?: string;
  rowCount: number;
}

export interface ColumnStats {
  columnName: string;
  dataType: string;
  nullRate: number;
  /** 空值行数（探查阶段由 MetricRegistry 计算，供质量报告复用） */
  nullCount?: number;
  uniqueCount: number;
  sampleValues: (string | number | null)[];
  minValue?: string | number;
  maxValue?: string | number;
  avgValue?: number;
  duplicateRate?: number;
}

export interface ExplorationResult {
  sourceType: DataSourceType;
  sourceName: string;
  totalRows: number;
  totalCols: number;
  schema: ColumnInfo[];
  sampleData: Record<string, unknown>[];
  columnStats: ColumnStats[];
  sampleSize: number;
  issues: DetectedIssue[];
}

// ---- Quality Analysis ----

export interface DetectedIssue {
  id: string;
  column: string;
  issueType: string;
  severity: IssueSeverity;
  affectedRows: number;
  affectedPercent: number;
  description: string;
  suggestion: string;
}

export interface QualityScore {
  overall: number;
  completeness: number;
  uniqueness: number;
  consistency: number;
  validity: number;
  accuracy: number;
}

export interface QualityReport {
  score: QualityScore;
  issues: DetectedIssue[];
  highPriorityIssues: DetectedIssue[];
  mediumPriorityIssues: DetectedIssue[];
  lowPriorityIssues: DetectedIssue[];
  summary: string;
  /** 质量报告引用的已解析指标 cacheKey 列表（MetricRegistry 去重） */
  metricKeys?: string[];
}

// ---- Cleaning Rules ----

/** 校验/过滤规则无效值处理方式（对齐 问题数据策略） */
export type InvalidAction =
  | "reject"
  | "keep"
  | "null"
  | "empty_string"
  | "custom"
  | "flag";

/** 码表 dictMap 未匹配值处理方式 */
export type UnmatchedStrategy = "keep" | "null" | "custom" | "reject";

export interface CleaningRule {
  id: string;
  index: number;
  name: string;
  field: string;
  action: CleaningAction;
  issueDescription?: string;
  strategy?: string;
  affectedRows: number;
  affectedPercent: number;
  parameters: Record<string, unknown>;
  status: RuleStatus;
  preview?: RulePreview;
  riskNote?: string;
  riskLevel?: "high" | "medium" | "low";
}

export interface RulePreview {
  beforeAfter: { before: string; after: string }[];
}

// ---- SQL Generation ----

export interface SQLStep {
  stepNumber: number;
  name: string;
  operationType: "CREATE" | "UPDATE" | "DELETE" | "INSERT" | "SELECT";
  sql: string;
  affectedRows: number;
  estimatedTime?: string;
  riskLevel: "high" | "medium" | "low";
  rollbackSql?: string;
}

/** SQL 生成可选参数（源表过滤、问题表等） */
export interface SQLGenerationOptions {
  /** 源表读取 WHERE 子句（不含 WHERE 关键字） */
  sourceWhereClause?: string;
  /** 是否生成问题表 `{table}_err` 步骤 */
  emitProblemTable?: boolean;
}

export interface SQLGenerationResult {
  targetDialect: DatabaseDialect;
  targetTable: string;
  targetDatabase: string;
  steps: SQLStep[];
  /** 合并后的主清洗 SQL（CREATE TABLE + INSERT SELECT） */
  consolidatedSql: string;
  backupSql: string;
  rollbackSql: string;
  totalAffectedRows: number;
  /** 问题表名（启用 emitProblemTable 时） */
  problemTableName?: string;
}

// ---- Execution ----

export interface ExecutionStepResult {
  stepNumber: number;
  name: string;
  status: ExecutionStatus;
  affectedRows: number;
  error?: string;
  durationMs: number;
}

export interface ExecutionResult {
  executionId: string;
  overallStatus: ExecutionStatus;
  stepResults: ExecutionStepResult[];
  metricsBefore: QualityScore;
  metricsAfter?: QualityScore;
  backupTableName?: string;
  /** 文件型数据源清洗后的本地路径 */
  outputFilePath?: string;
  /** 清洗后文件名（含 _cleaned 后缀） */
  outputFileName?: string;
  /** 下载 API 路径 */
  downloadUrl?: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

// ---- Retry ----

export interface RetryOption {
  label: string;
  description: string;
  fixedSql: string;
  scenario: string;
}

export interface RetryContext {
  errorType: string;
  errorMessage: string;
  failedStep: number;
  failedStepName: string;
  rootCause: string;
  options: RetryOption[];
  retryCount: number;
}

export interface SessionListItem {
  sessionId: string;
  sessionTitle: string | null;
  dataSourceId: string | null;
  currentPhase: CleaningPhase;
  dataSourceName: string | null;
  targetTable: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SavedDataSourceItem {
  dataSourceId: string;
  name: string;
  type: DataSourceType;
  dbDatabase?: string | null;
  fileName?: string | null;
  sessionCount: number;
  updatedAt: string;
}

export interface PipelineRunSummary {
  runIndex: number;
  createdAt: string;
}

// ---- Session State ----

export interface SessionState {
  sessionId: string;
  currentPhase: CleaningPhase;
  dataSource?: DataSourceConfig;
  /** 会话探查范围（可由 targetTable / filePath 推断） */
  sessionScope?: SessionScope;
  targetTable?: string;
  /** 源表预过滤 WHERE 子句（不含 WHERE） */
  sourceWhereClause?: string;
  explorationResult?: ExplorationResult;
  qualityReport?: QualityReport;
  confirmedRules: CleaningRule[];
  generatedSQL?: SQLGenerationResult;
  executionResult?: ExecutionResult;
  /** 当前 run 的执行历史（最新在前） */
  executionHistory?: ExecutionResult[];
  retryContext?: RetryContext;
  lastAction: string;
  retryCount: number;
  /** 当前活跃 run 序号 */
  currentRunIndex?: number;
  /** 本次加载所展示的 run 序号 */
  viewingRunIndex?: number;
  /** 当前 run 最新里程碑 revision（无快照为 0） */
  latestRevisionIndex?: number;
  /** 会话内历史 run 列表 */
  pipelineRuns?: PipelineRunSummary[];
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

/** LLM / 对话返回的规则修改意图（自然语言解析后应用） */
export interface RuleUpdateIntent {
  field: string;
  variantKey?: string;
  fillValue?: string | number;
  /** 为 true 时将整列设为固定值（不仅限于空值） */
  replaceAll?: boolean;
  /** confirm | skip | confirmed | skipped */
  action?: string;
  /** 新增衍生列名（自然语言「在 X 后添加 Y 列」） */
  addDerivedColumn?: string;
  /** 衍生列在规则列表中的插入位置参考字段 */
  insertAfter?: string;
}

export interface ChatMessageAction {
  id: string;
  label: string;
  /** 为 true 时按钮置灰且不可点击（功能未就绪等） */
  disabled?: boolean;
  /** 该按钮关联的流水线 run_index（查看历史消息产物时使用） */
  runIndex?: number;
  /** 同 run 内里程碑 revision（查看历史规则/SQL 快照） */
  revisionIndex?: number;
  type:
    | "selectTable"
    | "startExplore"
    | "viewExplore"
    | "startAnalysis"
    | "viewQuality"
    | "viewRules"
    | "confirmAll"
    | "generateSQL"
    | "viewSQL"
    | "runFullPipeline"
    | "runAgentPlan"
    | "updateRule"
    | "skipRule"
    | "confirmRule"
    | "executeSQL"
    | "dryRunSQL";
}

export interface ChatMessage {
  id: string;
  role: "agent" | "user" | "system";
  phase: CleaningPhase;
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
  actions?: ChatMessageAction[];
}

// ---- API Request/Response Types ----

export interface CreateSessionRequest {
  dataSource: DataSourceConfig;
  targetTable?: string;
}

export interface ExploreRequest {
  sessionId: string;
  sourceConfig: DataSourceConfig;
  tableName?: string;
  limit?: number;
}

export interface AnalyzeRequest {
  sessionId: string;
  explorationResult: ExplorationResult;
}

export interface ConfirmRulesRequest {
  sessionId: string;
  rules: CleaningRule[];
}

export interface GenerateSQLRequest {
  sessionId: string;
  rules: CleaningRule[];
  dialect: DatabaseDialect;
  tableName: string;
  databaseName: string;
  /** 源表全部列名，用于生成 INSERT ... SELECT */
  columns?: string[];
}

export interface ExecuteRequest {
  sessionId: string;
  sqlSteps: SQLStep[];
  dialect: DatabaseDialect;
  dryRun?: boolean;
}

export interface RetryRequest {
  sessionId: string;
  optionIndex: number;
  manualFix?: string;
}

export interface ApplyManualFixRequest {
  sessionId: string;
  stepNumber: number;
  modifiedSql: string;
}

// ---- UI Component Props ----

export interface PhaseIndicatorProps {
  currentPhase: CleaningPhase;
  completedPhases: CleaningPhase[];
}

export interface DataSourceFormProps {
  onConnect: (config: DataSourceConfig, table?: string) => void;
  onFileUpload: (file: File) => void;
}

export interface ExplorationPanelProps {
  result: ExplorationResult;
  onConfirm: () => void;
  onSkip: () => void;
}

export interface QualityPanelProps {
  report: QualityReport;
  onConfirmAll: () => void;
  onAdjust: () => void;
}

export interface RulesPanelProps {
  rules: CleaningRule[];
  onRuleStatusChange: (ruleId: string, status: RuleStatus) => void;
  onParameterChange: (ruleId: string, params: Record<string, unknown>) => void;
  onGenerateSQL: () => void;
}

export interface SQLPanelProps {
  sqlResult: SQLGenerationResult;
  onExecute: () => void;
  onModify: (stepNumber: number, newSql: string) => void;
  onExport: () => void;
}

export interface ExecutionPanelProps {
  result: ExecutionResult;
  onRetry: () => void;
  onExportSQL: () => void;
}

export interface RetryPanelProps {
  context: RetryContext;
  onSelectOption: (index: number) => void;
  onManualFix: (fix: string) => void;
}
