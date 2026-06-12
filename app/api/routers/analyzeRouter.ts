import { z } from "zod";
import { createRouter, protectedMutation } from "../middleware";
import { runQualityAgent } from "../agents/qualityAgent";
import { validatePhaseTransition, PhaseValidationError, HistoricalRunWriteError } from "../services/phaseValidator";
import { persistAnalysis } from "../services/explorationPersistenceService";
import type { ExplorationResult } from "@contracts/types";

export const analyzeRouter = createRouter({
  analyze: protectedMutation
    .input(
      z.object({
        sessionId: z.string(),
        runIndex: z.number().int().positive().optional(),
        explorationResult: z.object({
          sourceType: z.string(),
          sourceName: z.string(),
          totalRows: z.number(),
          totalCols: z.number(),
          schema: z.array(z.any()),
          sampleData: z.array(z.record(z.string(), z.unknown())),
          columnStats: z.array(z.any()),
          sampleSize: z.number(),
          issues: z.array(z.any()),
        }),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await validatePhaseTransition(input.sessionId, "analyze", input.runIndex);
        const exploration = input.explorationResult as ExplorationResult;
        const agentResult = runQualityAgent({ sessionId: input.sessionId, exploration });
        if (!agentResult.success || !agentResult.data) {
          return {
            success: false,
            error: agentResult.error ?? "分析失败",
            report: null,
            rules: [],
          };
        }
        const { report, rules } = agentResult.data;

        await persistAnalysis(input.sessionId, report, rules, { phase: "before" });

        return { success: true, report, rules };
      } catch (error) {
        const message =
          error instanceof PhaseValidationError || error instanceof HistoricalRunWriteError
            ? error.message
            : error instanceof Error
            ? error.message
            : String(error);
        return { success: false, error: message, report: null, rules: [] };
      }
    }),
});
