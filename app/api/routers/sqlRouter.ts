import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { createRouter, protectedMutation } from "../middleware";
import { generateCleaningSQL, validateSQL } from "../services/sqlGenerationService";
import { updateSessionPhase } from "../services/sessionService";
import { validatePhaseTransition, PhaseValidationError } from "../services/phaseValidator";
import { getDb } from "../queries/connection";
import { sqlSteps } from "@db/schema";
import { isSqlDialectSupported, unsupportedDialectMessage } from "@contracts/dataSourceSupport";

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
        const result = generateCleaningSQL(
          input.rules.map((r) => ({
            ...r,
            issueDescription: r.issueDescription ?? "",
            strategy: r.strategy ?? "",
            parameters: r.parameters ?? {},
          })),
          input.dialect,
          input.tableName,
          input.databaseName,
          input.columns ?? []
        );

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
