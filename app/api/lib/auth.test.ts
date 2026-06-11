import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { assertAuthenticated, extractBearerToken, verifyApiToken } from "./auth";

describe("auth", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("extractBearerToken 解析 Bearer 头", () => {
    const req = new Request("http://localhost", {
      headers: { Authorization: "Bearer secret-token" },
    });
    expect(extractBearerToken(req)).toBe("secret-token");
  });

  it("未配置 APP_SECRET 时开发环境放行", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_SECRET", "");
    const req = new Request("http://localhost");
    expect(verifyApiToken(req)).toBe(true);
  });

  it("生产环境缺少令牌时拒绝", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_SECRET", "prod-secret");
    const req = new Request("http://localhost");
    expect(verifyApiToken(req)).toBe(false);
    expect(() => assertAuthenticated(req)).toThrow(TRPCError);
  });

  it("Bearer 与 APP_SECRET 匹配时通过", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_SECRET", "prod-secret");
    const req = new Request("http://localhost", {
      headers: { Authorization: "Bearer prod-secret" },
    });
    expect(verifyApiToken(req)).toBe(true);
    expect(() => assertAuthenticated(req)).not.toThrow();
  });
});
