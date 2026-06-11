import { describe, expect, it } from "vitest";
import {
  advanceOrchestrator,
  canTransition,
  createOrchestratorContext,
  SCRIPT_ONLY_PIPELINE,
} from "./orchestrator";

describe("orchestrator", () => {
  it("初始状态为 schema_explore", () => {
    const ctx = createOrchestratorContext("sess_1", "users");
    expect(ctx.state).toBe("schema_explore");
  });

  it("合法状态转移", () => {
    expect(canTransition("schema_explore", "quality_analyze")).toBe(true);
    expect(canTransition("schema_explore", "done")).toBe(false);
  });

  it("advanceOrchestrator 推进状态", () => {
    let ctx = createOrchestratorContext("sess_1");
    ctx = advanceOrchestrator(ctx, "quality_analyze");
    expect(ctx.state).toBe("quality_analyze");
  });

  it("非法转移进入 failed", () => {
    let ctx = createOrchestratorContext("sess_1");
    ctx = advanceOrchestrator(ctx, "done");
    expect(ctx.state).toBe("failed");
    expect(ctx.errors.length).toBeGreaterThan(0);
  });

  it("SCRIPT_ONLY_PIPELINE 顺序完整", () => {
    expect(SCRIPT_ONLY_PIPELINE[0]).toBe("schema_explore");
    expect(SCRIPT_ONLY_PIPELINE.at(-1)).toBe("done");
  });
});
