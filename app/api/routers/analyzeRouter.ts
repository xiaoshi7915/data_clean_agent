import { z } from "zod";
import { createRouter, protectedMutation } from "../middleware";
import { runQualityAgent } from "../agents/qualityAgent";
import { updateSessionPhase } from "../services/sessionService";
import { validatePhaseTransition, PhaseValidationError } from "../services/phaseValidator";
import { getDb } from "../queries/connection";
import { qualityReports, cleaningRules } from "@db/schema";
import type { CleaningAction, RuleStatus, ExplorationResult } from "@contracts/types";

export const analyzeRouter = createRouter({
  analyze: protectedMutation
    .input(
      z.object({
        sessionId: z.string(),
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
        await validatePhaseTransition(input.sessionId, "analyze");
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

        // Save quality report to DB
        const db = getDb();
        await db.insert(qualityReports).values({
          sessionId: input.sessionId,
          overallScore: report.score.overall,
          completenessScore: report.score.completeness,
          uniquenessScore: report.score.uniqueness,
          consistencyScore: report.score.consistency,
          validityScore: report.score.validity,
          accuracyScore: report.score.accuracy,
          highPriorityIssues: report.highPriorityIssues,
          mediumPriorityIssues: report.mediumPriorityIssues,
          lowPriorityIssues: report.lowPriorityIssues,
          summary: report.summary,
        });

        // Save rules to DB
        for (const rule of rules) {
          await db.insert(cleaningRules).values({
            sessionId: input.sessionId,
            ruleId: rule.id,
            ruleIndex: rule.index,
            name: rule.name,
            field: rule.field,
            action: rule.action as CleaningAction,
            issueDescription: rule.issueDescription ?? null,
            strategy: rule.strategy ?? null,
            affectedRows: rule.affectedRows,
            affectedPercent: String(rule.affectedPercent),
            parameters: rule.parameters,
            status: rule.status as RuleStatus,
            riskNote: rule.riskNote ?? null,
          });
        }

        await updateSessionPhase(input.sessionId, "analyze", "analyzed");

        return { success: true, report, rules };
      } catch (error) {
        const message =
          error instanceof PhaseValidationError
            ? error.message
            : error instanceof Error
            ? error.message
            : String(error);
        return { success: false, error: message, report: null, rules: [] };
      }
    }),
});
