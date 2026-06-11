import { z } from "zod";
import { createRouter, protectedMutation } from "../middleware";
import { ingestVerificationResult } from "../agents/orchestrator";
import { assertWebhookSignature } from "../lib/webhookHmac";

export const runsRouter = createRouter({
  /**
   * 外部执行器回传校验结果（Soda / Airflow / dbt 等）
   * verify_pass → done；verify_fail → 修复回环（未超 MAX_REPAIR_ROUNDS）
   * 需请求头 X-Signature: sha256=<hmac>（载荷为 canonical JSON，见 README）
   */
  verificationResult: protectedMutation
    .input(
      z.object({
        runId: z.string(),
        status: z.enum(["pass", "fail"]),
        details: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      assertWebhookSignature(ctx.req, input);

      const result = await ingestVerificationResult(
        input.runId,
        input.status,
        input.details
      );
      return {
        success: result.ctx.state !== "failed",
        state: result.ctx.state,
        repairRound: result.ctx.repairRound ?? 0,
        errors: result.ctx.errors,
      };
    }),
});
