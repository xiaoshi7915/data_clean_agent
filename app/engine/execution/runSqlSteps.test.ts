import { describe, expect, it, vi } from "vitest";
import { runSqlSteps } from "./runSqlSteps";
import type { SQLStep, QualityScore } from "@contracts/types";
import type { SqlExecutor } from "./sqlExecutor";

const metricsBefore: QualityScore = {
  overall: 70,
  completeness: 70,
  uniqueness: 80,
  consistency: 75,
  validity: 70,
  accuracy: 70,
};

function makeStep(stepNumber: number, name: string, sql: string): SQLStep {
  return {
    stepNumber,
    name,
    operationType: "UPDATE",
    sql,
    affectedRows: 0,
    riskLevel: "medium",
  };
}

describe("runSqlSteps", () => {
  it("中间步骤失败时停止执行后续步骤", async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes("step-1")) {
        throw new Error("constraint violation");
      }
      return { affectedRows: 1, rows: [] };
    });

    const executor: SqlExecutor = { execute };
    const steps = [
      makeStep(0, "备份", "CREATE TABLE t_backup AS SELECT * FROM t"),
      makeStep(1, "清洗", "UPDATE t SET col = 1 WHERE step-1"),
      makeStep(2, "收尾", "UPDATE t SET col = 2 WHERE step-2"),
    ];

    const result = await runSqlSteps({
      sessionId: "sess_test",
      steps,
      executor,
      metricsBefore,
    });

    expect(result.overallStatus).toBe("partial");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.stepResults).toHaveLength(2);
    expect(result.stepResults[1]?.status).toBe("failed");
  });

  it("首步失败时标记为 failed", async () => {
    const execute = vi.fn(async () => {
      throw new Error("backup failed");
    });

    const result = await runSqlSteps({
      sessionId: "sess_test",
      steps: [makeStep(0, "备份", "CREATE TABLE t_backup AS SELECT * FROM t")],
      executor: { execute },
      metricsBefore,
    });

    expect(result.overallStatus).toBe("failed");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
