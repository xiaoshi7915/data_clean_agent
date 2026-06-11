import { describe, expect, it, vi, beforeEach } from "vitest";
import { runsRouter } from "./runsRouter";

vi.mock("../agents/orchestrator", () => ({
  ingestVerificationResult: vi.fn().mockResolvedValue({
    ctx: { state: "done", repairRound: 0, errors: [], input: { sessionId: "s" } },
  }),
}));

import { ingestVerificationResult } from "../agents/orchestrator";
import {
  canonicalVerificationPayload,
  signWebhookPayload,
} from "../lib/webhookHmac";

function createCaller(auth?: string, signature?: string) {
  const headers: Record<string, string> = {};
  if (auth) headers.Authorization = `Bearer ${auth}`;
  if (signature) headers["X-Signature"] = signature;
  return runsRouter.createCaller({
    req: new Request("http://localhost/api/trpc", { headers }),
    resHeaders: new Headers(),
  });
}

describe("runsRouter", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_SECRET", "test-secret");
    vi.stubEnv("WEBHOOK_HMAC_SECRET", "webhook-key");
    vi.clearAllMocks();
  });

  it("有效 X-Signature 时 verificationResult 推进状态", async () => {
    const input = { runId: "run_abc", status: "pass" as const, details: "all good" };
    const payload = canonicalVerificationPayload(input);
    const sig = signWebhookPayload(payload);

    const caller = createCaller("test-secret", sig);
    const res = await caller.verificationResult(input);
    expect(res.success).toBe(true);
    expect(res.state).toBe("done");
    expect(ingestVerificationResult).toHaveBeenCalledWith("run_abc", "pass", "all good");
  });

  it("无效 X-Signature 被拒绝", async () => {
    const caller = createCaller("test-secret", "sha256=invalid");
    await expect(
      caller.verificationResult({ runId: "run_abc", status: "pass" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(ingestVerificationResult).not.toHaveBeenCalled();
  });
});
