import { describe, expect, it, vi, beforeEach } from "vitest";
import { assertWritableRun } from "./pipelineRunService";

vi.mock("../queries/connection", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../queries/connection";

const mockedGetDb = vi.mocked(getDb);

describe("assertWritableRun", () => {
  beforeEach(() => {
    mockedGetDb.mockReset();
  });

  it("返回校验时刻钉住的 currentRunIndex，供写路径复用", async () => {
    const limit = vi.fn().mockResolvedValue([{ currentRunIndex: 3 }]);
    const select = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit }) }) });
    mockedGetDb.mockReturnValue({ select } as never);

    const runIndex = await assertWritableRun("sess_1");
    expect(runIndex).toBe(3);
  });

  it("客户端 runIndex 与当前不一致时拒绝写入", async () => {
    const limit = vi.fn().mockResolvedValue([{ currentRunIndex: 2 }]);
    const select = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit }) }) });
    mockedGetDb.mockReturnValue({ select } as never);

    await expect(assertWritableRun("sess_1", 1)).rejects.toThrow(/历史快照/);
  });
});
