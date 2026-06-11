import { describe, expect, it, beforeEach } from "vitest";
import { checkRateLimit, rateLimitKeyFromRequest, resetRateLimitsForTests, RateLimitError } from "./rateLimit";

describe("rateLimit", () => {
  beforeEach(() => {
    resetRateLimitsForTests();
  });

  it("窗口内超限抛出 RateLimitError", () => {
    const key = "test:ip:1";
    for (let i = 0; i < 30; i++) {
      checkRateLimit(key, 30);
    }
    expect(() => checkRateLimit(key, 30)).toThrow(RateLimitError);
  });

  it("rateLimitKeyFromRequest 优先使用 Bearer", () => {
    const req = new Request("http://localhost", {
      headers: { Authorization: "Bearer my-long-secret-token" },
    });
    const key = rateLimitKeyFromRequest(req, "chat");
    expect(key).toMatch(/^chat:token:/);
  });
});
