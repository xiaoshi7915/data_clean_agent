import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { createRouter, publicQuery, protectedMutation } from "../middleware";
import { updateSessionPhase } from "../services/sessionService";
import { validatePhaseTransition, PhaseValidationError, HistoricalRunWriteError } from "../services/phaseValidator";
import { assertWritableRun, getCurrentRunIndex } from "../services/pipelineRunService";
import { getDb } from "../queries/connection";
import { cleaningRules } from "@db/schema";
import type { CleaningAction, CleaningRule, RuleStatus } from "@contracts/types";

const cleaningActionSchema = z.enum([
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

export const rulesRouter = createRouter({
  updateStatus: protectedMutation
    .input(
      z.object({
        sessionId: z.string(),
        runIndex: z.number().int().positive().optional(),
        ruleId: z.string(),
        status: z.enum(["pending", "confirmed", "skipped"]),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await assertWritableRun(input.sessionId, input.runIndex);
        const runIndex = input.runIndex ?? (await getCurrentRunIndex(input.sessionId));
        const db = getDb();
        await db
          .update(cleaningRules)
          .set({ status: input.status as RuleStatus })
          .where(
            and(
              eq(cleaningRules.sessionId, input.sessionId),
              eq(cleaningRules.runIndex, runIndex),
              eq(cleaningRules.ruleId, input.ruleId)
            )
          );
        return { success: true };
      } catch (error) {
        const message =
          error instanceof HistoricalRunWriteError
            ? error.message
            : error instanceof Error
            ? error.message
            : String(error);
        return { success: false, error: message };
      }
    }),

  updateParameters: protectedMutation
    .input(
      z.object({
        sessionId: z.string(),
        runIndex: z.number().int().positive().optional(),
        ruleId: z.string(),
        parameters: z.record(z.string(), z.unknown()),
        action: z
          .enum([
            "dedup",
            "fill_null",
            "format",
            "truncate",
            "convert_type",
            "remove",
            "standardize",
            "split",
            "merge",
          ])
          .optional(),
        strategy: z.string().optional(),
        name: z.string().optional(),
        riskNote: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await assertWritableRun(input.sessionId, input.runIndex);
        const runIndex = input.runIndex ?? (await getCurrentRunIndex(input.sessionId));
        const db = getDb();
        const rows = await db
          .select({ parameters: cleaningRules.parameters })
          .from(cleaningRules)
          .where(
            and(
              eq(cleaningRules.sessionId, input.sessionId),
              eq(cleaningRules.runIndex, runIndex),
              eq(cleaningRules.ruleId, input.ruleId)
            )
          )
          .limit(1);

        const existingParams = (rows[0]?.parameters as Record<string, unknown>) || {};
        const mergedParameters = { ...existingParams, ...input.parameters };
        const updates: Record<string, unknown> = { parameters: mergedParameters };
        if (input.action) updates.action = input.action;
        if (input.strategy) updates.strategy = input.strategy;
        if (input.name) updates.name = input.name;
        if (input.riskNote !== undefined) updates.riskNote = input.riskNote;

        await db
          .update(cleaningRules)
          .set(updates)
          .where(
            and(
              eq(cleaningRules.sessionId, input.sessionId),
              eq(cleaningRules.runIndex, runIndex),
              eq(cleaningRules.ruleId, input.ruleId)
            )
          );
        return { success: true };
      } catch (error) {
        const message =
          error instanceof HistoricalRunWriteError
            ? error.message
            : error instanceof Error
            ? error.message
            : String(error);
        return { success: false, error: message };
      }
    }),

  confirmAll: protectedMutation
    .input(
      z.object({
        sessionId: z.string(),
        runIndex: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await validatePhaseTransition(input.sessionId, "confirm", input.runIndex);
        const runIndex = input.runIndex ?? (await getCurrentRunIndex(input.sessionId));
        const db = getDb();
        await db
          .update(cleaningRules)
          .set({ status: "confirmed" })
          .where(
            and(
              eq(cleaningRules.sessionId, input.sessionId),
              eq(cleaningRules.runIndex, runIndex)
            )
          );
        await updateSessionPhase(input.sessionId, "confirm", "all_confirmed");
        return { success: true };
      } catch (error) {
        const message =
          error instanceof PhaseValidationError || error instanceof HistoricalRunWriteError
            ? error.message
            : error instanceof Error
            ? error.message
            : String(error);
        return { success: false, error: message };
      }
    }),

  getBySession: publicQuery
    .input(
      z.object({
        sessionId: z.string(),
        runIndex: z.number().int().positive().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      const runIndex = input.runIndex ?? (await getCurrentRunIndex(input.sessionId));
      const rules = await db
        .select()
        .from(cleaningRules)
        .where(
          and(eq(cleaningRules.sessionId, input.sessionId), eq(cleaningRules.runIndex, runIndex))
        )
        .orderBy(cleaningRules.ruleIndex);
      return { rules };
    }),

  createCustom: protectedMutation
    .input(
      z.object({
        sessionId: z.string(),
        runIndex: z.number().int().positive().optional(),
        field: z.string().min(1),
        action: cleaningActionSchema,
        name: z.string().min(1),
        description: z.string().optional(),
        parameters: z.record(z.string(), z.unknown()).optional(),
        riskLevel: z.enum(["high", "medium", "low"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await assertWritableRun(input.sessionId, input.runIndex);
        const db = getDb();
        const runIndex = await getCurrentRunIndex(input.sessionId);
        const existing = await db
          .select({ ruleIndex: cleaningRules.ruleIndex })
          .from(cleaningRules)
          .where(
            and(eq(cleaningRules.sessionId, input.sessionId), eq(cleaningRules.runIndex, runIndex))
          );

        const nextIndex =
          existing.length > 0 ? Math.max(...existing.map((r) => r.ruleIndex)) + 1 : 1;
        const ruleId = `custom_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const parameters = { ...(input.parameters ?? {}), isCustom: true };
        const description = input.description?.trim() || input.name;

        await db.insert(cleaningRules).values({
          sessionId: input.sessionId,
          runIndex,
          ruleId,
          ruleIndex: nextIndex,
          name: input.name,
          field: input.field,
          action: input.action as CleaningAction,
          issueDescription: description,
          strategy: description,
          affectedRows: 0,
          affectedPercent: "0",
          parameters,
          status: "pending",
          riskNote: "用户自定义规则，请确认参数后再生成 SQL",
        });

        const rule: CleaningRule = {
          id: ruleId,
          index: nextIndex,
          name: input.name,
          field: input.field,
          action: input.action,
          issueDescription: description,
          strategy: description,
          affectedRows: 0,
          affectedPercent: 0,
          parameters,
          status: "pending",
          riskNote: "用户自定义规则，请确认参数后再生成 SQL",
          riskLevel: input.riskLevel ?? "medium",
        };

        return { success: true, rule };
      } catch (error) {
        const message =
          error instanceof HistoricalRunWriteError
            ? error.message
            : error instanceof Error
            ? error.message
            : String(error);
        return { success: false, error: message, rule: null };
      }
    }),

  deleteCustom: protectedMutation
    .input(
      z.object({
        sessionId: z.string(),
        runIndex: z.number().int().positive().optional(),
        ruleId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await assertWritableRun(input.sessionId, input.runIndex);
        const runIndex = input.runIndex ?? (await getCurrentRunIndex(input.sessionId));
        const db = getDb();
        const rows = await db
          .select()
          .from(cleaningRules)
          .where(
            and(
              eq(cleaningRules.sessionId, input.sessionId),
              eq(cleaningRules.runIndex, runIndex),
              eq(cleaningRules.ruleId, input.ruleId)
            )
          )
          .limit(1);

        if (rows.length === 0) {
          return { success: false, error: "规则不存在" };
        }

        const params = (rows[0].parameters as Record<string, unknown>) || {};
        if (params.isCustom !== true) {
          return { success: false, error: "仅可删除自定义规则" };
        }

        await db
          .delete(cleaningRules)
          .where(
            and(
              eq(cleaningRules.sessionId, input.sessionId),
              eq(cleaningRules.runIndex, runIndex),
              eq(cleaningRules.ruleId, input.ruleId)
            )
          );

        return { success: true };
      } catch (error) {
        const message =
          error instanceof HistoricalRunWriteError
            ? error.message
            : error instanceof Error
            ? error.message
            : String(error);
        return { success: false, error: message };
      }
    }),
});
