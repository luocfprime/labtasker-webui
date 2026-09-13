import { expect, test } from "@playwright/test";

test("Task columns use the default widths and preserve a saved resize", async ({ page }) => {
  await page.request.post("http://127.0.0.1:18765/__test__/reset");
  await page.goto("/");
  await page.getByLabel("Server URL").fill("http://127.0.0.1:18765");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("heading", { name: "robotwin", exact: true }).click();

  const defaults = {
    status: 117,
    progress: 88,
    attempt: 83,
    priority: 79,
    created: 103,
    updated: 103,
    duration: 86,
  };
  for (const [id, width] of Object.entries(defaults)) {
    const header = page.locator(`th[data-column-id="${id}"]`);
    await expect(header.getByRole("separator")).toHaveAttribute("aria-valuenow", String(width));
    expect((await header.boundingBox())!.width).toBeCloseTo(width, 0);
  }

  const progress = page.getByRole("separator", { name: "Resize Progress", exact: true });
  await progress.focus();
  await progress.press("ArrowRight");
  await expect(progress).toHaveAttribute("aria-valuenow", "104");
  await page.reload();
  await expect(progress).toHaveAttribute("aria-valuenow", "104");
  for (const [id, width] of Object.entries(defaults)) {
    if (id !== "progress") {
      await expect(page.locator(`th[data-column-id="${id}"]`).getByRole("separator"))
        .toHaveAttribute("aria-valuenow", String(width));
    }
  }
});
