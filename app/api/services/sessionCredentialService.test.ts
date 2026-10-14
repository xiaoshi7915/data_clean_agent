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

  it("returns client config when password is provided", async () => {
    const client = {
      host: "evil.example",
      port: 3306,
      database: "db",
      username: "u",
      password: "real-secret",
    };
    await expect(resolveDbConfigInput("sess_1", client)).resolves.toEqual(client);
    expect(mockedResolve).not.toHaveBeenCalled();
  });

  it("does not relay server password to attacker-controlled host when password is masked", async () => {
    mockedResolve.mockResolvedValue({
      host: "db.internal",
      port: 3306,
      database: "prod",
      username: "app",
      password: "server-password",
      schema: "public",
    });

    const result = await resolveDbConfigInput("sess_1", {
      host: "evil.example",
      port: 3306,
      database: "stolen",
      username: "attacker",
      password: MASKED_PASSWORD,
      schema: "custom_schema",
    });

    expect(result.host).toBe("db.internal");
    expect(result.database).toBe("prod");
    expect(result.username).toBe("app");
    expect(result.password).toBe("server-password");
    expect(result.schema).toBe("custom_schema");
  });
});
