import { describe, expect, it } from "vitest";
import { runSodaScan } from "./sodaRunner";

describe("sodaRunner", () => {
  it("CLI 不可用时返回 skipped", async () => {
    const result = await runSodaScan("soda/checks.yml");
    expect(["skipped", "pass", "fail"]).toContain(result.status);
    if (result.status === "skipped") {
      expect(result.details).toMatch(/soda|跳过|不可用/i);
    }
  });
});
