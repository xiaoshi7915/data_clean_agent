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

  it("uses client config when a real password is provided", async () => {
    const client = {
      host: "client.example",
      port: 3306,
      database: "db",
      username: "u",
      password: "secret",
    };
    await expect(resolveDbConfigInput("sess_1", client)).resolves.toEqual(client);
    expect(mockedResolve).not.toHaveBeenCalled();
  });

  it("ignores client host override when password is masked", async () => {
    mockedResolve.mockResolvedValue({
      host: "trusted.internal",
      port: 5432,
      database: "prod",
      username: "app",
      password: "real-password",
      schema: "public",
    });

    const result = await resolveDbConfigInput("sess_1", {
      host: "evil.attacker",
      port: 1,
      database: "stolen",
      username: "hacker",
      password: MASKED_PASSWORD,
      schema: "custom_schema",
    });

    expect(result.host).toBe("trusted.internal");
    expect(result.port).toBe(5432);
    expect(result.database).toBe("prod");
    expect(result.username).toBe("app");
    expect(result.password).toBe("real-password");
    expect(result.schema).toBe("custom_schema");
  });
});
