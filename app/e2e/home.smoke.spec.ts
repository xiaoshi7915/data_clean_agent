import { test, expect } from "@playwright/test";

test("首页加载并展示使用流程", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "数据清洗智能体使用流程" })).toBeVisible();
  await expect(page.getByText("新建数据源")).toBeVisible();
});
