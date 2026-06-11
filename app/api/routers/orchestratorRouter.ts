import { z } from "zod";
import { createRouter, protectedMutation, protectedQuery } from "../middleware";
import {
  startRun,
  advanceRun,
  getRunStatus,
  listRunsBySession,
} from "../agents/orchestrator";

const orchestratorEventSchema = z.enum([
  "explore_complete",
  "analyze_complete",
  "confirm_complete",
  "repair_complete",
  "sql_verify_pass",
  "sql_verify_fail",
  "script_complete",
  "export_complete",
  "verify_pass",
  "verify_fail",
  "advance_pipeline",
  "fail",
]);

export const orchestratorRouter = createRouter({
  /** 启动新的编排运行 */
  start: protectedMutation
    .input(
      z.object({
        sessionId: z.string(),
        tableName: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { runId, ctx } = await startRun(input.sessionId, input.tableName);
      return { success: true, runId, state: ctx.state, context: ctx };
    }),

  /** 推进编排运行 */
  advance: protectedMutation
    .input(
      z.object({
        runId: z.string(),
        event: orchestratorEventSchema,
        verification: z
          .object({
            status: z.enum(["pass", "fail", "skipped"]),
            details: z.string().optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await advanceRun(input.runId, input.event, {
        verification: input.verification,
      });
      return {
        success: result.ctx.state !== "failed",
        state: result.ctx.state,
        context: result.ctx,
        transitioned: result.transitioned,
        errors: result.ctx.errors,
      };
    }),

  /** 查询运行状态 */
  status: protectedQuery
    .input(z.object({ runId: z.string() }))
    .query(async ({ input }) => {
      const status = await getRunStatus(input.runId);
      if (!status) {
        return { success: false, error: "编排运行不存在" };
      }
      return { success: true, ...status };
    }),

  /** 按会话列出编排运行 */
  listBySession: protectedQuery
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      const runs = await listRunsBySession(input.sessionId);
      return { success: true, runs };
    }),
});
