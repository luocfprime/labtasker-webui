import { expect, test } from "@playwright/test";

test("Server version warning is dismissible, refreshes on responses, and fits narrow screens", async ({ page }) => {
  const fixture = "http://127.0.0.1:18765";
  const version = (value: string) => page.request.post(`${fixture}/__test__/version`, {
    data: JSON.stringify(value), headers: { "Content-Type": "application/json" },
  });
  await page.request.post(`${fixture}/__test__/reset`);
  await version("0.1.0");
  await page.goto("/");
  await page.getByLabel("Server URL").fill("http://127.0.0.1:18765");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const warning = page.locator(".server-version-warning");
  await expect(warning).toContainText("Server 0.1.0 is older than Client");
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 700 }]) {
    await page.setViewportSize(viewport);
    const bounds = await warning.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
  }
  await page.screenshot({ path: "test-results/server-version-warning.png" });
  await page.getByRole("button", { name: "Dismiss Server version warning" }).click();
  await page.getByRole("heading", { name: "robotwin", exact: true }).click();
  await expect(warning).toHaveCount(0);
  await version("0.2.0");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(warning).toContainText("Server 0.2.0");
  await version("999.0.0");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(warning).toHaveCount(0);
  await page.request.post(`${fixture}/__test__/reset`);
});
