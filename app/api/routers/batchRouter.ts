import { z } from "zod";
import { createRouter, protectedMutation, protectedQuery } from "../middleware";
import { getSession } from "../services/sessionService";
import { batchJobQueue } from "../services/batchJobService";

export const batchRouter = createRouter({
  /** 异步提交整库批量任务，立即返回 jobId */
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
          return { success: false, error: "会话缺少数据源", jobId: null };
        }
        if (session.dataSource.fileConfig) {
          return {
            success: false,
            error: "文件数据源暂不支持整库批量，请逐文件处理",
            jobId: null,
          };
        }

        const jobId = batchJobQueue.enqueueBatch(input.sessionId, {
          maxTables: input.maxTables,
          skipTables: input.skipTables,
        });
        return { success: true, jobId };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, jobId: null };
      }
    }),

  /** 轮询批量任务进度与结果 */
  getBatchJobStatus: protectedQuery
    .input(z.object({ jobId: z.string() }))
    .query(({ input }) => {
      const job = batchJobQueue.getBatchJob(input.jobId);
      if (!job) {
        return { success: false, error: "任务不存在或已过期", job: null };
      }
      return { success: true, job };
    }),
});
