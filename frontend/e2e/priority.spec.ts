import { expect, test } from "@playwright/test";

test("signed priorities render consistently in the table and task details", async ({ page }) => {
  await page.request.post("http://127.0.0.1:18765/__test__/reset");
  await page.goto("/");
  await page.getByLabel("Server URL").fill("http://127.0.0.1:18765");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("heading", { name: "robotwin" })).toBeVisible();
  const seed = await (await page.request.get("/api/webui/queues/robotwin/tasks")).json();
  const priorities = [-100, -1, 0, 1, 100];
  const items = priorities.map((priority, i) => ({ ...seed.items[0], status: "running", started_at: new Date().toISOString(), id: `priority_${i}`, name: `priority-test-${i}`, priority }));
  await page.route("**/api/webui/queues/robotwin/tasks?*", (route) => route.fulfill({ json: { items, next_cursor: null } }));
  await page.route("**/api/webui/queues/robotwin/tasks/priority_*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop();
    return route.fulfill({ json: items.find((item) => item.id === id) });
  });
  await page.getByRole("heading", { name: "robotwin" }).click();
  const firstName = page.locator('tr[data-task-id="priority_0"] .task-name');
  await expect(firstName).toBeVisible();
  const node = await firstName.elementHandle();
  // A live-duration tick must update time without replacing clickable cells.
  await page.waitForTimeout(1200);
  expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
  for (let i = 0; i < priorities.length; i++) {
    const value = priorities[i];
    const display = `${value}${value > 0 ? "↑" : value < 0 ? "↓" : ""}`;
    const row = page.locator(`tr[data-task-id="priority_${i}"]`);
    await expect(row.locator(".priority-value")).toHaveText(display);
    await row.locator(".task-name").click();
    const drawer = page.locator("aside.drawer");
    await expect(drawer.locator(".priority-value")).toHaveText(display);
    await expect(page).toHaveURL(new RegExp(`task=priority_${i}`));
    await expect(row).toHaveClass(/chosen/);
  }
  await page.locator("aside.drawer").getByRole("button", { name: "Close" }).click();
  await expect(page.locator("aside.drawer")).toHaveCount(0);
  await expect(page).not.toHaveURL(/task=/);
});
