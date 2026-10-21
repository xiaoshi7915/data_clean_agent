import { describe, expect, it, vi, beforeEach } from "vitest";
import { MASKED_PASSWORD } from "../lib/dataSourceSanitizer";
import { resolveDbConfigInput } from "./sessionCredentialService";

vi.mock("./sessionService", () => ({
  resolveDbConfigForSession: vi.fn(),
}));

import { resolveDbConfigForSession } from "./sessionService";

const serverConfig = {
  host: "db.internal",
  port: 5432,
  database: "prod",
  username: "app",
  password: "real-secret",
  schema: "public",
};

describe("resolveDbConfigInput", () => {
  beforeEach(() => {
    vi.mocked(resolveDbConfigForSession).mockReset();
    vi.mocked(resolveDbConfigForSession).mockResolvedValue(serverConfig);
  });

  it("脱敏密码时忽略客户端 host 覆盖，仅允许 schema", async () => {
    const resolved = await resolveDbConfigInput("sess_1", {
      host: "evil.example",
      port: 9999,
      database: "stolen",
      username: "attacker",
      password: MASKED_PASSWORD,
      schema: "staging",
    });

    expect(resolved.host).toBe("db.internal");
    expect(resolved.port).toBe(5432);
    expect(resolved.database).toBe("prod");
    expect(resolved.username).toBe("app");
    expect(resolved.password).toBe("real-secret");
    expect(resolved.schema).toBe("staging");
  });
});
