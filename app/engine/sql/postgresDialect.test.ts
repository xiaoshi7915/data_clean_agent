import { describe, expect, it } from "vitest";
import { postgresDialect } from "./postgresDialect";

describe("PostgresDialect golden SQL", () => {
  it("quotes identifiers with double quotes", () => {
    expect(postgresDialect.quoteIdentifier("user_id")).toBe('"user_id"');
    expect(postgresDialect.quoteIdentifier('weird"name')).toBe('"weird""name"');
  });

  it("quotes tables same as identifiers", () => {
    expect(postgresDialect.quoteTable("t_users")).toBe('"t_users"');
  });

  it("builds CONCAT expression", () => {
    expect(postgresDialect.concat(['"a"', '"b"'])).toBe('CONCAT("a", "b")');
    expect(postgresDialect.concat(['"only"'])).toBe('"only"');
  });

  it("builds CONCAT_WS with escaped separator", () => {
    expect(postgresDialect.concatWs(",", ['"a"', '"b"'])).toBe("CONCAT_WS(',', \"a\", \"b\")");
    expect(postgresDialect.concatWs("a'b", ['"x"'])).toBe("CONCAT_WS('a''b', \"x\")");
  });

  it("generates backup DDL", () => {
    const sql = postgresDialect.createBackupSql("orders", "orders_backup_20260101120000");
    expect(sql).toBe(
      'CREATE TABLE "orders_backup_20260101120000" AS\nSELECT * FROM "orders";'
    );
  });

  it("generates CREATE TABLE LIKE DDL", () => {
    const sql = postgresDialect.createTableLikeSql("orders", "orders_cleaned");
    expect(sql).toBe('CREATE TABLE "orders_cleaned" (LIKE "orders" INCLUDING ALL);');
  });
});
