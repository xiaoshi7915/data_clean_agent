import {
  mysqlTable,
  varchar,
  text,
  timestamp,
  int,
  json,
  mysqlEnum,
} from "drizzle-orm/mysql-core";

/** 与 init.sql 一致：INT AUTO_INCREMENT，避免 drizzle-kit push 误判为 serial 类型变更 */
const autoId = () => int("id").autoincrement().primaryKey();

// ---- Saved Data Sources ----
export const savedDataSources = mysqlTable("saved_data_sources", {
  id: autoId(),
  dataSourceId: varchar("data_source_id", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  type: mysqlEnum("type", [
    "mysql",
    "postgresql",
    "sqlite",
    "sqlserver",
    "oracle",
    "csv",
    "json",
    "xml",
    "xlsx",
  ]).notNull(),
  dbHost: varchar("db_host", { length: 255 }),
  dbPort: int("db_port"),
  dbDatabase: varchar("db_database", { length: 255 }),
  dbSchema: varchar("db_schema", { length: 255 }),
  dbUsername: varchar("db_username", { length: 255 }),
  /** AES-256-GCM 加密存储（enc:v1: 前缀）；历史明文兼容 */
  dbPassword: varchar("db_password", { length: 512 }),
  fileName: varchar("file_name", { length: 255 }),
  fileType: mysqlEnum("file_type", ["csv", "json", "xml", "xlsx"]),
  filePath: varchar("file_path", { length: 500 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

// ---- Cleaning Sessions ----
export const cleaningSessions = mysqlTable("cleaning_sessions", {
  id: autoId(),
  sessionId: varchar("session_id", { length: 64 }).notNull().unique(),
  dataSourceId: varchar("data_source_id", { length: 64 }),
  sessionTitle: varchar("session_title", { length: 255 }),
  currentPhase: mysqlEnum("current_phase", [
    "idle",
    "explore",
    "analyze",
    "confirm",
    "generate",
    "execute",
    "retry",
  ]).notNull().default("idle"),
  dataSourceType: mysqlEnum("data_source_type", [
    "mysql",
    "postgresql",
    "sqlite",
    "sqlserver",
    "oracle",
    "csv",
    "json",
    "xml",
    "xlsx",
  ]),
  dataSourceName: varchar("data_source_name", { length: 255 }),
  targetTable: varchar("target_table", { length: 255 }),
  dbHost: varchar("db_host", { length: 255 }),
  dbPort: int("db_port"),
  dbDatabase: varchar("db_database", { length: 255 }),
  dbSchema: varchar("db_schema", { length: 255 }),
  fileName: varchar("file_name", { length: 255 }),
  fileType: mysqlEnum("file_type", ["csv", "json", "xml", "xlsx"]),
  filePath: varchar("file_path", { length: 500 }),
  retryCount: int("retry_count").notNull().default(0),
  lastAction: varchar("last_action", { length: 100 }),
  /** 最近一次导出的清洗契约 YAML 快照 */
  contractYaml: text("contract_yaml"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

// ---- Exploration Results ----
export const explorationResults = mysqlTable("exploration_results", {
  id: autoId(),
  sessionId: varchar("session_id", { length: 64 }).notNull(),
  sourceType: varchar("source_type", { length: 50 }).notNull(),
  sourceName: varchar("source_name", { length: 255 }).notNull(),
  totalRows: int("total_rows").notNull(),
  totalCols: int("total_cols").notNull(),
  schema: json("schema").notNull(),
  sampleData: json("sample_data").notNull(),
  columnStats: json("column_stats").notNull(),
  issues: json("issues"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---- Quality Reports ----
export const qualityReports = mysqlTable("quality_reports", {
  id: autoId(),
  sessionId: varchar("session_id", { length: 64 }).notNull(),
  overallScore: int("overall_score").notNull(),
  completenessScore: int("completeness_score").notNull(),
  uniquenessScore: int("uniqueness_score").notNull(),
  consistencyScore: int("consistency_score").notNull(),
  validityScore: int("validity_score").notNull(),
  accuracyScore: int("accuracy_score").notNull(),
  highPriorityIssues: json("high_priority_issues").notNull(),
  mediumPriorityIssues: json("medium_priority_issues").notNull(),
  lowPriorityIssues: json("low_priority_issues").notNull(),
  summary: text("summary"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---- Cleaning Rules ----
export const cleaningRules = mysqlTable("cleaning_rules", {
  id: autoId(),
  sessionId: varchar("session_id", { length: 64 }).notNull(),
  ruleId: varchar("rule_id", { length: 50 }).notNull(),
  ruleIndex: int("rule_index").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  field: varchar("field", { length: 255 }).notNull(),
  action: mysqlEnum("action", [
    "dedup",
    "fill_null",
    "format",
    "truncate",
    "convert_type",
    "remove",
    "standardize",
    "split",
    "merge",
  ]).notNull(),
  issueDescription: text("issue_description"),
  strategy: text("strategy"),
  affectedRows: int("affected_rows").notNull().default(0),
  affectedPercent: varchar("affected_percent", { length: 20 }),
  parameters: json("parameters"),
  status: mysqlEnum("status", ["pending", "confirmed", "skipped"]).notNull().default("pending"),
  preview: json("preview"),
  riskNote: text("risk_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

// ---- SQL Steps ----
export const sqlSteps = mysqlTable("sql_steps", {
  id: autoId(),
  sessionId: varchar("session_id", { length: 64 }).notNull(),
  stepNumber: int("step_number").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  operationType: mysqlEnum("operation_type", ["CREATE", "UPDATE", "DELETE", "INSERT", "SELECT"]).notNull(),
  sql: text("sql").notNull(),
  rollbackSql: text("rollback_sql"),
  affectedRows: int("affected_rows").notNull().default(0),
  estimatedTime: varchar("estimated_time", { length: 50 }),
  riskLevel: mysqlEnum("risk_level", ["high", "medium", "low"]).notNull().default("medium"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---- Execution Logs ----
export const executionLogs = mysqlTable("execution_logs", {
  id: autoId(),
  sessionId: varchar("session_id", { length: 64 }).notNull(),
  executionId: varchar("execution_id", { length: 64 }).notNull(),
  overallStatus: mysqlEnum("overall_status", ["pending", "running", "success", "failed", "partial"]).notNull(),
  stepResults: json("step_results"),
  metricsBefore: json("metrics_before"),
  metricsAfter: json("metrics_after"),
  backupTableName: varchar("backup_table_name", { length: 255 }),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---- Chat Messages ----
export const chatMessages = mysqlTable("chat_messages", {
  id: autoId(),
  sessionId: varchar("session_id", { length: 64 }).notNull(),
  messageId: varchar("message_id", { length: 64 }).notNull(),
  role: mysqlEnum("role", ["agent", "user", "system"]).notNull(),
  phase: mysqlEnum("phase", [
    "idle",
    "explore",
    "analyze",
    "confirm",
    "generate",
    "execute",
    "retry",
  ]).notNull().default("idle"),
  content: text("content").notNull(),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---- Orchestration Runs（多步编排持久化） ----
export const orchestrationRuns = mysqlTable("orchestration_runs", {
  id: autoId(),
  runId: varchar("run_id", { length: 64 }).notNull().unique(),
  sessionId: varchar("session_id", { length: 64 }).notNull(),
  state: mysqlEnum("state", [
    "schema_explore",
    "quality_analyze",
    "human_confirm",
    "repair_generate",
    "sql_verify",
    "script_gen",
    "artifact_export",
    "external_verify",
    "done",
    "failed",
  ]).notNull().default("schema_explore"),
  /** 完整 OrchestratorContext JSON 快照 */
  context: json("context").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

// ---- File Uploads (for local file processing) ----
export const fileUploads = mysqlTable("file_uploads", {
  id: autoId(),
  sessionId: varchar("session_id", { length: 64 }),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileSize: int("file_size").notNull(),
  fileType: mysqlEnum("file_type", ["csv", "json", "xml", "xlsx"]).notNull(),
  filePath: varchar("file_path", { length: 500 }).notNull(),
  encoding: varchar("encoding", { length: 50 }),
  delimiter: varchar("delimiter", { length: 10 }),
  hasHeader: int("has_header").notNull().default(1),
  rowCount: int("row_count"),
  columnCount: int("column_count"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Type exports
export type SavedDataSourceRecord = typeof savedDataSources.$inferSelect;
export type CleaningSession = typeof cleaningSessions.$inferSelect;
export type ExplorationResultRecord = typeof explorationResults.$inferSelect;
export type QualityReportRecord = typeof qualityReports.$inferSelect;
export type CleaningRuleRecord = typeof cleaningRules.$inferSelect;
export type SQLStepRecord = typeof sqlSteps.$inferSelect;
export type ExecutionLogRecord = typeof executionLogs.$inferSelect;
export type ChatMessageRecord = typeof chatMessages.$inferSelect;
export type FileUploadRecord = typeof fileUploads.$inferSelect;
export type OrchestrationRunRecord = typeof orchestrationRuns.$inferSelect;
