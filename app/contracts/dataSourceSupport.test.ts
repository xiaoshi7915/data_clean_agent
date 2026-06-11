import { describe, expect, it } from "vitest";
import {
  SUPPORTED_DB_DRIVER_TYPES,
  SUPPORTED_SQL_DIALECTS,
  isDbExploreSupported,
  isSqlDialectSupported,
  unsupportedDbMessage,
  unsupportedDialectMessage,
} from "./dataSourceSupport";

describe("dataSourceSupport", () => {
  it("五大关系库均已标记为可探查", () => {
    expect(SUPPORTED_DB_DRIVER_TYPES).toEqual(
      expect.arrayContaining(["mysql", "postgresql", "sqlite", "sqlserver", "oracle"])
    );
    for (const type of ["mysql", "postgresql", "sqlite", "sqlserver", "oracle"]) {
      expect(isDbExploreSupported(type)).toBe(true);
    }
  });

  it("五大 SQL 方言均已标记为可生成/执行", () => {
    expect(SUPPORTED_SQL_DIALECTS).toEqual(
      expect.arrayContaining(["mysql", "postgresql", "sqlite", "sqlserver", "oracle"])
    );
    for (const dialect of ["mysql", "postgresql", "sqlite", "sqlserver", "oracle"]) {
      expect(isSqlDialectSupported(dialect)).toBe(true);
    }
  });

  it("未支持类型返回明确提示", () => {
    expect(unsupportedDbMessage("unknown")).toContain("尚未实现");
    expect(unsupportedDialectMessage("unknown")).toContain("尚未实现");
    expect(unsupportedDialectMessage("mysql")).toContain("已支持");
  });
});
