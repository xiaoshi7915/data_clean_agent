import { describe, expect, it, vi, beforeEach } from "vitest";
import type { DBConnectionConfig } from "@contracts/types";
import { MASKED_PASSWORD } from "../lib/dataSourceSanitizer";

vi.mock("./sessionService", () => ({
  resolveDbConfigForSession: vi.fn(),
}));

import { resolveDbConfigForSession } from "./sessionService";
import { resolveDbConfigInput } from "./sessionCredentialService";

const mockedResolve = vi.mocked(resolveDbConfigForSession);

const storedConfig: DBConnectionConfig = {
  host: "db.internal",
  port: 3306,
  database: "production",
  username: "app_user",
  password: "real-secret",
  schema: "public",
};

describe("resolveDbConfigInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedResolve.mockResolvedValue(storedConfig);
  });

  it("客户端提供完整密码时直接使用客户端配置", async () => {
    const clientConfig: DBConnectionConfig = {
      host: "other.host",
      port: 5432,
      database: "other_db",
      username: "other",
      password: "client-password",
    };

    const result = await resolveDbConfigInput("sess_1", clientConfig);
    expect(result).toEqual(clientConfig);
    expect(mockedResolve).not.toHaveBeenCalled();
  });

  it("密码脱敏时忽略客户端 host/port/database/username，防止凭证中继", async () => {
    const result = await resolveDbConfigInput("sess_1", {
      host: "attacker.evil",
      port: 3306,
      database: "probe",
      username: "victim",
      password: MASKED_PASSWORD,
    });

    expect(result).toEqual({
      host: "db.internal",
      port: 3306,
      database: "production",
      username: "app_user",
      password: "real-secret",
      schema: "public",
    });
  });

  it("密码脱敏时允许客户端覆盖 schema", async () => {
    const result = await resolveDbConfigInput("sess_1", {
      host: "attacker.evil",
      port: 3306,
      database: "probe",
      username: "victim",
      password: MASKED_PASSWORD,
      schema: "custom_schema",
    });

    expect(result.schema).toBe("custom_schema");
    expect(result.host).toBe("db.internal");
    expect(result.password).toBe("real-secret");
  });

  it("无客户端 config 时返回服务端存储配置", async () => {
    const result = await resolveDbConfigInput("sess_1", undefined);
    expect(result).toEqual(storedConfig);
  });
});
