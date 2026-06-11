import { describe, expect, it } from "vitest";
import {
  MASKED_PASSWORD,
  sanitizeDataSourceForClient,
  isPasswordMissing,
} from "./dataSourceSanitizer";
import type { DataSourceConfig } from "@contracts/types";

describe("dataSourceSanitizer", () => {
  it("sanitizeDataSourceForClient 脱敏密码", () => {
    const config: DataSourceConfig = {
      type: "mysql",
      name: "test",
      dbConfig: {
        host: "127.0.0.1",
        port: 3306,
        database: "db",
        username: "root",
        password: "admin123456!!",
      },
    };
    const sanitized = sanitizeDataSourceForClient(config);
    expect(sanitized?.dbConfig?.password).toBe(MASKED_PASSWORD);
    expect(sanitized?.dbConfig?.password).not.toBe("admin123456!!");
  });

  it("isPasswordMissing 识别空值与脱敏占位", () => {
    expect(isPasswordMissing("")).toBe(true);
    expect(isPasswordMissing(MASKED_PASSWORD)).toBe(true);
    expect(isPasswordMissing("real-secret")).toBe(false);
  });
});
