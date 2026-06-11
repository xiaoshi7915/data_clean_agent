import { z } from "zod";
import { createRouter, protectedMutation } from "../middleware";
import { isSqlDialectSupported, unsupportedDbMessage } from "@contracts/dataSourceSupport";
import {
  executeSQLSteps,
  generateRetryContext,
  applyManualFix,
} from "../services/executionService";
import { executeFileCleaning } from "../services/fileCleaningService";
import { updateSessionPhase, incrementRetryCount } from "../services/sessionService";
import { validatePhaseTransition, PhaseValidationError } from "../services/phaseValidator";

export const executeRouter = createRouter({
  execute: protectedMutation
    .input(
      z.object({
        sessionId: z.string(),
        steps: z.array(
          z.object({
            stepNumber: z.number(),
            name: z.string(),
            operationType: z.enum(["CREATE", "UPDATE", "DELETE", "INSERT", "SELECT"]),
            sql: z.string(),
            affectedRows: z.number(),
            estimatedTime: z.string().optional(),
            riskLevel: z.enum(["high", "medium", "low"]),
            rollbackSql: z.string().optional(),
          })
        ),
        dbConfig: z.object({
          host: z.string(),
          port: z.number(),
          database: z.string(),
          username: z.string(),
          password: z.string(),
        }),
        dialect: z.enum(["mysql", "postgresql", "sqlite", "sqlserver", "oracle"]),
        dryRun: z.boolean().optional().default(false),
        metricsBefore: z.object({
          overall: z.number(),
          completeness: z.number(),
          uniqueness: z.number(),
          consistency: z.number(),
          validity: z.number(),
          accuracy: z.number(),
        }),
      })
    )
    .mutation(async ({ input }) => {
      try {
        if (!isSqlDialectSupported(input.dialect)) {
          return { success: false, error: unsupportedDbMessage(input.dialect), result: null };
        }
        await validatePhaseTransition(input.sessionId, "execute");
        const result = await executeSQLSteps(
          input.sessionId,
          input.steps,
          input.dbConfig,
          input.dialect,
          input.dryRun,
          input.metricsBefore
        );

        const phase = result.overallStatus === "failed" ? "retry" : "execute";
        await updateSessionPhase(input.sessionId, phase, "executed");

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

  executeFile: protectedMutation
    .input(
      z.object({
        sessionId: z.string(),
        filePath: z.string(),
        fileType: z.enum(["csv", "json", "xml", "xlsx"]),
        originalFileName: z.string(),
        rules: z.array(z.any()),
        dryRun: z.boolean().optional().default(false),
        metricsBefore: z.object({
          overall: z.number(),
          completeness: z.number(),
          uniqueness: z.number(),
          consistency: z.number(),
          validity: z.number(),
          accuracy: z.number(),
        }),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await validatePhaseTransition(input.sessionId, "execute");
        const result = await executeFileCleaning(
          input.filePath,
          input.fileType,
          input.originalFileName,
          input.rules,
          input.metricsBefore,
          input.dryRun
        );

        const phase = result.overallStatus === "failed" ? "retry" : "execute";
        await updateSessionPhase(input.sessionId, phase, "file_executed");

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

  getRetryContext: protectedMutation
    .input(
      z.object({
        errorMessage: z.string(),
        failedStep: z.object({
          stepNumber: z.number(),
          name: z.string(),
          operationType: z.enum(["CREATE", "UPDATE", "DELETE", "INSERT", "SELECT"]),
          sql: z.string(),
          affectedRows: z.number(),
          riskLevel: z.enum(["high", "medium", "low"]),
        }),
        retryCount: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const context = generateRetryContext(
          input.errorMessage,
          input.failedStep,
          input.retryCount
        );
        return { success: true, context };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, context: null };
      }
    }),

  applyFix: protectedMutation
    .input(
      z.object({
        sessionId: z.string(),
        steps: z.array(
          z.object({
            stepNumber: z.number(),
            name: z.string(),
            operationType: z.enum(["CREATE", "UPDATE", "DELETE", "INSERT", "SELECT"]),
            sql: z.string(),
            affectedRows: z.number(),
            riskLevel: z.enum(["high", "medium", "low"]),
            rollbackSql: z.string().optional(),
          })
        ),
        stepNumber: z.number(),
        modifiedSql: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const updatedSteps = await applyManualFix(
          input.sessionId,
          input.steps,
          input.stepNumber,
          input.modifiedSql
        );
        await incrementRetryCount(input.sessionId);
        return { success: true, steps: updatedSteps };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, steps: null };
      }
    }),
});
