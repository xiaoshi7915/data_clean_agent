import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { createRouter, protectedMutation } from "../middleware";
import { validateSQL } from "../services/sqlGenerationService";
import { runRepairAgent } from "../agents/repairAgent";
import { runVerifyAgent } from "../agents/verifyAgent";
import { updateSessionPhase } from "../services/sessionService";
import { resolveDbConfigInput } from "../services/sessionCredentialService";
import { validatePhaseTransition, PhaseValidationError } from "../services/phaseValidator";
import { getDb } from "../queries/connection";
import { sqlSteps } from "@db/schema";
import { isSqlDialectSupported, unsupportedDialectMessage } from "@contracts/dataSourceSupport";

const sqlStepSchema = z.object({
  stepNumber: z.number(),
  name: z.string(),
  operationType: z.enum(["CREATE", "UPDATE", "DELETE", "INSERT", "SELECT"]),
  sql: z.string(),
  affectedRows: z.number(),
  estimatedTime: z.string().optional(),
  riskLevel: z.enum(["high", "medium", "low"]),
  rollbackSql: z.string().optional(),
});

const dbConfigSchema = z.object({
  host: z.string(),
  port: z.number(),
  database: z.string(),
  username: z.string(),
  password: z.string(),
  schema: z.string().optional(),
});

export const sqlRouter = createRouter({
  generate: protectedMutation
    .input(
      z.object({
        sessionId: z.string(),
        rules: z.array(
          z.object({
            id: z.string(),
            index: z.number(),
            name: z.string(),
            field: z.string(),
            action: z.enum([
              "dedup",
              "fill_null",
              "format",
              "truncate",
              "convert_type",
              "remove",
              "standardize",
              "split",
              "merge",
            ]),
            issueDescription: z.string().optional(),
            strategy: z.string().optional(),
            affectedRows: z.number(),
            affectedPercent: z.number(),
            parameters: z.record(z.string(), z.unknown()).optional(),
            status: z.enum(["pending", "confirmed", "skipped"]),
            preview: z.any().optional(),
            riskNote: z.string().optional(),
            riskLevel: z.enum(["high", "medium", "low"]).optional(),
          })
        ),
        dialect: z.enum(["mysql", "postgresql", "sqlite", "sqlserver", "oracle"]),
        tableName: z.string(),
        databaseName: z.string(),
        columns: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        if (!isSqlDialectSupported(input.dialect)) {
          return { success: false, error: unsupportedDialectMessage(input.dialect), result: null };
        }
        await validatePhaseTransition(input.sessionId, "generate");
        const agentResult = runRepairAgent({
          sessionId: input.sessionId,
          rules: input.rules.map((r) => ({
            ...r,
            issueDescription: r.issueDescription ?? "",
            strategy: r.strategy ?? "",
            parameters: r.parameters ?? {},
          })),
          dialect: input.dialect,
          tableName: input.tableName,
          databaseName: input.databaseName,
          columns: input.columns ?? [],
        });
        if (!agentResult.success || !agentResult.data) {
          return { success: false, error: agentResult.error ?? "SQL生成失败", result: null };
        }
        const result = agentResult.data.sqlResult;

        // Save SQL steps to DB
        const db = getDb();
        for (const step of result.steps) {
          await db.insert(sqlSteps).values({
            sessionId: input.sessionId,
            stepNumber: step.stepNumber,
            name: step.name,
            operationType: step.operationType,
            sql: step.sql,
            rollbackSql: step.rollbackSql ?? null,
            affectedRows: step.affectedRows,
            estimatedTime: step.estimatedTime ?? null,
            riskLevel: step.riskLevel,
          });
        }

        await updateSessionPhase(input.sessionId, "generate", "sql_generated");

        return { success: true, result };
      } catch (error) {
        const message =
          error instanceof PhaseValidationError
            ? error.message
            : error instanceof Error
            ? error.message
            : String(error);
        return { success: false, error: message, result: null };
      }
    }),

  validate: protectedMutation
    .input(z.object({ sql: z.string() }))
    .mutation(({ input }) => {
      const result = validateSQL(input.sql);
      return result;
    }),

  /** SQL 步骤校验：静态规则 + 可选 EXPLAIN（经 verifyAgent） */
  verify: protectedMutation
    .input(
      z.object({
        sessionId: z.string(),
        steps: z.array(sqlStepSchema),
        dialect: z.enum(["mysql", "postgresql", "sqlite", "sqlserver", "oracle"]),
        dbConfig: dbConfigSchema.optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        if (!isSqlDialectSupported(input.dialect)) {
          return {
            success: false,
            valid: false,
            stepResults: [],
            error: unsupportedDialectMessage(input.dialect),
          };
        }
        const resolvedDbConfig = input.dbConfig
          ? await resolveDbConfigInput(input.sessionId, input.dbConfig)
          : await resolveDbConfigInput(input.sessionId, undefined);
        const agentResult = await runVerifyAgent({
          sessionId: input.sessionId,
          steps: input.steps,
          dialect: input.dialect,
          dbConfig: resolvedDbConfig,
        });
        if (!agentResult.success || !agentResult.data) {
          return {
            success: false,
            valid: false,
            stepResults: [],
            error: agentResult.error ?? "校验失败",
          };
        }
        return {
          success: true,
          valid: agentResult.data.valid,
          stepResults: agentResult.data.stepResults,
          error: undefined,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, valid: false, stepResults: [], error: message };
      }
    }),

  modifyStep: protectedMutation
    .input(
      z.object({
        sessionId: z.string(),
        stepNumber: z.number(),
        newSql: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(sqlSteps)
        .set({ sql: input.newSql })
        .where(
          and(
            eq(sqlSteps.sessionId, input.sessionId),
            eq(sqlSteps.stepNumber, input.stepNumber)
          )
        );
      return { success: true };
    }),
});
