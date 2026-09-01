import { describe, expect, it } from "vitest";
import { sqlserverDialect } from "./sqlserverDialect";

describe("SqlServerDialect", () => {
  it("quotes schema-qualified tables", () => {
    expect(sqlserverDialect.quoteTable("sales.Orders")).toBe("[sales].[Orders]");
  });

  it("quotes unqualified tables", () => {
    expect(sqlserverDialect.quoteTable("Orders")).toBe("[Orders]");
  });
});
