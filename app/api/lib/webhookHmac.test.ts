import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  canonicalVerificationPayload,
  signWebhookPayload,
  verifyWebhookSignature,
} from "./webhookHmac";

describe("webhookHmac", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("WEBHOOK_HMAC_SECRET", "test-webhook-secret");
    vi.stubEnv("APP_SECRET", "app-secret");
  });

  it("canonical JSON 与签名 round-trip", () => {
    const payload = canonicalVerificationPayload({
      runId: "run_abc",
      status: "pass",
      details: "ok",
    });
    const sig = signWebhookPayload(payload);
    expect(verifyWebhookSignature(payload, sig)).toBe(true);
  });

  it("无效签名被拒绝", () => {
    const payload = canonicalVerificationPayload({ runId: "run_abc", status: "fail" });
    expect(verifyWebhookSignature(payload, "sha256=deadbeef")).toBe(false);
    expect(verifyWebhookSignature(payload, null)).toBe(false);
  });

  it("未配置密钥时跳过校验", () => {
    vi.stubEnv("WEBHOOK_HMAC_SECRET", "");
    vi.stubEnv("APP_SECRET", "");
    const payload = canonicalVerificationPayload({ runId: "run_x", status: "pass" });
    expect(verifyWebhookSignature(payload, null)).toBe(true);
  });
});
