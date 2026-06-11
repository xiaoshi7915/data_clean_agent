import { z } from "zod";
import { createRouter, protectedMutation, rateLimitedMutation } from "../middleware";
import { isSqlDialectSupported, unsupportedDialectMessage } from "@contracts/dataSourceSupport";
import { env } from "../lib/env";
import {
  executeSQLSteps,
  generateRetryContext,
  applyManualFix,
} from "../services/executionService";
import { executeFileCleaning } from "../services/fileCleaningService";
import { updateSessionPhase, incrementRetryCount } from "../services/sessionService";
import { validatePhaseTransition, PhaseValidationError } from "../services/phaseValidator";

export const executeRouter = createRouter({
  execute: rateLimitedMutation("execute.run")
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
        if (!input.dryRun && env.scriptOnly && !env.allowExecute) {
          return {
            success: false,
            error:
              "SCRIPT_ONLY 模式已启用：禁止对生产库执行写操作。请使用 dry-run 模拟执行，或通过「导出脚本包」在本地执行。开发环境可设置 ALLOW_EXECUTE=true 解除限制。",
            result: null,
          };
        }
        if (!isSqlDialectSupported(input.dialect)) {
          return { success: false, error: unsupportedDialectMessage(input.dialect), result: null };
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
        if (!input.dryRun && env.scriptOnly && !env.allowExecute) {
          return {
            success: false,
            error:
              "SCRIPT_ONLY 模式已启用：禁止对生产库执行文件清洗写操作。请使用 dry-run 或导出脚本包本地执行。设置 ALLOW_EXECUTE=true 可在开发环境解除限制。",
            result: null,
          };
        }
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
