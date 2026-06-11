import { describe, expect, it } from "vitest";
import { mysqlDialect } from "./mysqlDialect";

describe("MysqlDialect golden SQL", () => {
  it("quotes identifiers with backticks", () => {
    expect(mysqlDialect.quoteIdentifier("user_id")).toBe("`user_id`");
    expect(mysqlDialect.quoteIdentifier("weird`name")).toBe("`weird``name`");
  });

  it("quotes tables same as identifiers", () => {
    expect(mysqlDialect.quoteTable("t_users")).toBe("`t_users`");
  });

  it("builds CONCAT expression", () => {
    expect(mysqlDialect.concat(["`a`", "`b`"])).toBe("CONCAT(`a`, `b`)");
    expect(mysqlDialect.concat(["`only`"])).toBe("`only`");
  });

  it("builds CONCAT_WS with escaped separator", () => {
    expect(mysqlDialect.concatWs(",", ["`a`", "`b`"])).toBe("CONCAT_WS(',', `a`, `b`)");
    expect(mysqlDialect.concatWs("a'b", ["`x`"])).toBe("CONCAT_WS('a''b', `x`)");
  });

  it("generates backup DDL", () => {
    const sql = mysqlDialect.createBackupSql("orders", "orders_backup_20260101120000");
    expect(sql).toBe(
      "CREATE TABLE `orders_backup_20260101120000` AS\nSELECT * FROM `orders`;"
    );
  });

  it("generates CREATE TABLE LIKE DDL", () => {
    const sql = mysqlDialect.createTableLikeSql("orders", "orders_cleaned");
    expect(sql).toBe("CREATE TABLE `orders_cleaned` LIKE `orders`;");
  });
});
