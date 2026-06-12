import { z } from "zod";
import { createRouter, protectedMutation } from "../middleware";
import { runBatchPipelineForDatabase } from "../services/batchPipelineService";
import { getSession } from "../services/sessionService";

export const batchRouter = createRouter({
  runDatabaseBatch: protectedMutation
    .input(
      z.object({
        sessionId: z.string(),
        maxTables: z.number().int().positive().max(50).optional(),
        skipTables: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const session = await getSession(input.sessionId);
        if (!session?.dataSource) {
          return { success: false, error: "会话缺少数据源", result: null };
        }
        if (session.dataSource.fileConfig) {
          return {
            success: false,
            error: "文件数据源暂不支持整库批量，请逐文件处理",
            result: null,
          };
        }

        const result = await runBatchPipelineForDatabase(input.sessionId, {
          maxTables: input.maxTables,
          skipTables: input.skipTables,
        });
        return { success: true, result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, result: null };
      }
    }),
});
