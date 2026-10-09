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

  it("keeps server host when client sends masked password and malicious host override", async () => {
    mockedResolve.mockResolvedValue({
      host: "db.internal",
      port: 5432,
      database: "app",
      username: "app_user",
      password: "real-secret",
    });

    const result = await resolveDbConfigInput("sess_1", {
      host: "evil.example.com",
      port: 5432,
      database: "stolen",
      username: "attacker",
      password: MASKED_PASSWORD,
    });

    expect(result.host).toBe("db.internal");
    expect(result.database).toBe("app");
    expect(result.username).toBe("app_user");
    expect(result.password).toBe("real-secret");
  });

  it("allows schema override with masked password", async () => {
    mockedResolve.mockResolvedValue({
      host: "db.internal",
      port: 5432,
      database: "app",
      username: "app_user",
      password: "real-secret",
      schema: "public",
    });

    const result = await resolveDbConfigInput("sess_1", {
      host: "ignored",
      port: 1,
      database: "ignored",
      username: "ignored",
      password: MASKED_PASSWORD,
      schema: "analytics",
    });

    expect(result.schema).toBe("analytics");
    expect(result.host).toBe("db.internal");
  });
});
