import { z } from "zod";

/** 与 contracts/types.ts CleaningRule 对齐的 Zod 定义 */
export const cleaningActionSchema = z.enum([
  "dedup",
  "fill_null",
  "format",
  "truncate",
  "convert_type",
  "remove",
  "standardize",
  "split",
  "merge",
]);

export const ruleStatusSchema = z.enum(["pending", "confirmed", "skipped"]);

export const rulePreviewSchema = z.object({
  beforeAfter: z.array(
    z.object({
      before: z.string(),
      after: z.string(),
    })
  ),
});

export const cleaningRuleSchema = z.object({
  id: z.string(),
  index: z.number().int().nonnegative(),
  name: z.string(),
  field: z.string(),
  action: cleaningActionSchema,
  issueDescription: z.string().optional(),
  strategy: z.string().optional(),
  affectedRows: z.number().int().nonnegative(),
  affectedPercent: z.number(),
  parameters: z.record(z.string(), z.unknown()),
  status: ruleStatusSchema,
  preview: rulePreviewSchema.nullish(),
  riskNote: z.string().optional(),
  riskLevel: z.enum(["high", "medium", "low"]).optional(),
});

export const cleaningContractMetadataSchema = z.object({
  sessionId: z.string().optional(),
  title: z.string().optional(),
  dialect: z.enum(["mysql", "postgresql", "sqlite", "sqlserver", "oracle"]).optional(),
  tableName: z.string().optional(),
  databaseName: z.string().optional(),
  exportedAt: z.string().optional(),
});

/** 校验/验证配置（Soda checks 等） */
export const cleaningContractVerificationSchema = z.object({
  sodaChecksPath: z.string().optional(),
  enabled: z.boolean().optional(),
  engine: z.enum(["sql", "spark", "soda"]).optional(),
});

/** 脚本产物配置（dbt / Airflow / Deequ 等） */
export const cleaningContractArtifactsSchema = z.object({
  includeDbt: z.boolean().optional(),
  includeScheduling: z.boolean().optional(),
  dbtModelPath: z.string().optional(),
  airflowDagPath: z.string().optional(),
});

/** 清洗契约根对象（YAML/JSON 通用 AST） */
export const cleaningContractSchema = z.object({
  version: z.string().default("1.0"),
  metadata: cleaningContractMetadataSchema.optional(),
  verification: cleaningContractVerificationSchema.optional(),
  artifacts: cleaningContractArtifactsSchema.optional(),
  rules: z.array(cleaningRuleSchema),
});

export type CleaningContract = z.infer<typeof cleaningContractSchema>;
export type CleaningContractRule = z.infer<typeof cleaningRuleSchema>;
