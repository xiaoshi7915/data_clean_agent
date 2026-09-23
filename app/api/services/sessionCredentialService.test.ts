import { describe, expect, it, vi, beforeEach } from "vitest";
import { MASKED_PASSWORD } from "../lib/dataSourceSanitizer";
import { resolveDbConfigInput } from "./sessionCredentialService";

vi.mock("./sessionService", () => ({
  resolveDbConfigForSession: vi.fn(),
}));

import { resolveDbConfigForSession } from "./sessionService";

const mockedResolve = vi.mocked(resolveDbConfigForSession);

describe("resolveDbConfigInput", () => {
  beforeEach(() => {
    mockedResolve.mockReset();
  });

  it("脱敏密码时不允许客户端覆盖 host，仅合并 schema", async () => {
    mockedResolve.mockResolvedValue({
      host: "prod-db.internal",
      port: 5432,
      database: "app",
      username: "app_user",
      password: "real-secret",
      schema: "public",
    });

    const result = await resolveDbConfigInput("sess_1", {
      host: "evil.example.com",
      port: 5432,
      database: "stolen",
      username: "attacker",
      password: MASKED_PASSWORD,
      schema: "reporting",
    });

    expect(result.host).toBe("prod-db.internal");
    expect(result.database).toBe("app");
    expect(result.username).toBe("app_user");
    expect(result.password).toBe("real-secret");
    expect(result.schema).toBe("reporting");
  });
});
