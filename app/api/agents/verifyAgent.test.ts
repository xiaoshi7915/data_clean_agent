import { describe, expect, it } from "vitest";
import { enhancedValidateSQL } from "./verifyAgent";

describe("verifyAgent", () => {
  it("enhancedValidateSQL 拒绝空 SQL", () => {
    const result = enhancedValidateSQL("");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("不能为空"))).toBe(true);
  });

  it("enhancedValidateSQL 通过合法 SELECT", () => {
    const result = enhancedValidateSQL("SELECT 1;");
    expect(result.valid).toBe(true);
  });

  it("enhancedValidateSQL 拦截 TRUNCATE", () => {
    const result = enhancedValidateSQL("TRUNCATE TABLE users;");
    expect(result.valid).toBe(false);
  });
});
