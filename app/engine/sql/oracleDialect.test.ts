import { describe, expect, it } from "vitest";
import { oracleDialect } from "./oracleDialect";

describe("OracleDialect", () => {
  it("quotes schema-qualified tables with owner prefix", () => {
    expect(oracleDialect.quoteTable("HR.EMPLOYEES")).toBe('"HR"."EMPLOYEES"');
  });

  it("uppercases unqualified table names", () => {
    expect(oracleDialect.quoteTable("employees")).toBe('"EMPLOYEES"');
  });
});
