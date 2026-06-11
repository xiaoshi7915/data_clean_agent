import { describe, expect, it, beforeEach } from "vitest";
import type { ExplorationResult, QualityReport } from "@contracts/types";
import { generateCleaningRules, generateQualityReport } from "./analysisService";
import { metricRegistry } from "../../engine/metrics/metricRegistry";

const emptyReport: QualityReport = {
  score: {
    overall: 70,
    completeness: 70,
    uniqueness: 80,
    consistency: 75,
    validity: 70,
    accuracy: 70,
  },
  issues: [],
  highPriorityIssues: [],
  mediumPriorityIssues: [],
  lowPriorityIssues: [],
  summary: "test",
};

describe("generateQualityReport", () => {
  beforeEach(() => {
    metricRegistry.clearResolveCache();
  });

  it("uses MetricRegistry metricKeys and nullCount from exploration", () => {
    const exploration: ExplorationResult = {
      sourceType: "mysql",
      sourceName: "mydb.users",
      totalRows: 100,
      totalCols: 2,
      schema: [],
      sampleData: [],
      sampleSize: 0,
      issues: [],
      columnStats: [
        {
          columnName: "email",
          dataType: "varchar",
          nullRate: 10,
          nullCount: 10,
          uniqueCount: 90,
          sampleValues: ["a@b.com"],
        },
        {
          columnName: "name",
          dataType: "varchar",
          nullRate: 0,
          nullCount: 0,
          uniqueCount: 100,
          sampleValues: ["Alice"],
        },
      ],
    };

    const report = generateQualityReport(exploration);
    expect(report.metricKeys).toBeDefined();
    expect(report.metricKeys!.length).toBeGreaterThanOrEqual(3);
    expect(report.metricKeys).toContain("row_count|*|users");
    expect(report.metricKeys).toContain("null_count|email|users");
    expect(report.score.overall).toBeGreaterThan(0);
  });
});

describe("analysisService P1 rule recommendations", () => {
  it("recommends merge for first_name + last_name", () => {
    const exploration: ExplorationResult = {
      sourceType: "csv",
      sourceName: "test.csv",
      totalRows: 100,
      totalCols: 2,
      schema: [],
      sampleData: [{ first_name: "张", last_name: "三" }],
      sampleSize: 1,
      issues: [],
      columnStats: [
        {
          columnName: "first_name",
          dataType: "varchar",
          nullRate: 0,
          uniqueCount: 10,
          sampleValues: ["张"],
        },
        {
          columnName: "last_name",
          dataType: "varchar",
          nullRate: 0,
          uniqueCount: 10,
          sampleValues: ["三"],
        },
      ],
    };

    const rules = generateCleaningRules(exploration, emptyReport);
    const mergeRule = rules.find((r) => r.action === "merge" && r.name.includes("姓名"));
    expect(mergeRule).toBeDefined();
    expect(mergeRule?.parameters.sourceFields).toEqual(["first_name", "last_name"]);
  });

  it("recommends cross_field for birth_date and hire_date", () => {
    const exploration: ExplorationResult = {
      sourceType: "mysql",
      sourceName: "employees",
      totalRows: 50,
      totalCols: 2,
      schema: [],
      sampleData: [
        { birth_date: "1990-01-01", hire_date: "2015-06-01" },
      ],
      sampleSize: 1,
      issues: [],
      columnStats: [
        {
          columnName: "birth_date",
          dataType: "date",
          nullRate: 0,
          uniqueCount: 50,
          sampleValues: ["1990-01-01"],
        },
        {
          columnName: "hire_date",
          dataType: "date",
          nullRate: 0,
          uniqueCount: 50,
          sampleValues: ["2015-06-01"],
        },
      ],
    };

    const rules = generateCleaningRules(exploration, emptyReport);
    const crossRule = rules.find((r) => r.parameters.type === "cross_field");
    expect(crossRule).toBeDefined();
    expect(crossRule?.parameters.fields).toEqual(["birth_date", "hire_date"]);
  });

  it("does not auto-recommend MICE skeleton rules", () => {
    const exploration: ExplorationResult = {
      sourceType: "csv",
      sourceName: "x.csv",
      totalRows: 10,
      totalCols: 1,
      schema: [],
      sampleData: [],
      sampleSize: 0,
      issues: [],
      columnStats: [
        {
          columnName: "a",
          dataType: "varchar",
          nullRate: 0,
          uniqueCount: 1,
          sampleValues: ["x"],
        },
      ],
    };

    const rules = generateCleaningRules(exploration, emptyReport);
    const mice = rules.find((r) => r.parameters.type === "mice_impute");
    expect(mice).toBeUndefined();
  });
});
