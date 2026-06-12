import { z } from "zod";
import { createRouter, protectedMutation, protectedQuery } from "../middleware";
import {
  createPipelineSnapshot,
  getPipelineSnapshot,
  getLatestRevisionIndex,
} from "../services/pipelineSnapshotService";

export const snapshotRouter = createRouter({
  create: protectedMutation
    .input(
      z.object({
        sessionId: z.string(),
        runIndex: z.number().int().positive().optional(),
        trigger: z.string().max(64).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await createPipelineSnapshot(
          input.sessionId,
          input.runIndex,
          input.trigger
        );
        return { success: true, ...result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, revisionIndex: 0, runIndex: 1 };
      }
    }),

  get: protectedQuery
    .input(
      z.object({
        sessionId: z.string(),
        runIndex: z.number().int().positive(),
        revisionIndex: z.number().int().positive(),
      })
    )
    .query(async ({ input }) => {
      const snapshot = await getPipelineSnapshot(
        input.sessionId,
        input.runIndex,
        input.revisionIndex
      );
      if (!snapshot) {
        return { found: false, snapshot: null };
      }
      return { found: true, snapshot };
    }),

  getLatestRevision: protectedQuery
    .input(
      z.object({
        sessionId: z.string(),
        runIndex: z.number().int().positive().optional(),
      })
    )
    .query(async ({ input }) => {
      const revisionIndex = await getLatestRevisionIndex(input.sessionId, input.runIndex);
      return { revisionIndex };
    }),
});
