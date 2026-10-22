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

  it("does not let masked client config override server host when merging credentials", async () => {
    mockedResolve.mockResolvedValue({
      host: "db.internal",
      port: 3306,
      database: "prod",
      username: "app",
      password: "real-secret",
    });

    const result = await resolveDbConfigInput("sess_1", {
      host: "evil.example.com",
      port: 3306,
      database: "prod",
      username: "app",
      password: MASKED_PASSWORD,
      schema: "analytics",
    });

    expect(result.host).toBe("db.internal");
    expect(result.password).toBe("real-secret");
    expect(result.schema).toBe("analytics");
  });
});
