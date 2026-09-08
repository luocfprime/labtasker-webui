import { expect, test } from "@playwright/test";

test("large list virtualizes, preserves reading position, resizes columns and formats dates", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.request.post("http://127.0.0.1:18765/__test__/reset");
  await page.goto("/");
  await page.getByLabel("Server URL").fill("http://127.0.0.1:18765");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("heading", { name: "robotwin" })).toBeVisible();
  const seed = await (
    await page.request.get("/api/webui/queues/robotwin/tasks")
  ).json();
  const items = Array.from({ length: 2000 }, (_, i) => ({
    ...seed.items[0],
    id: `large_${i}`,
    name: `large-task-${i}`,
  }));
  let newTask = false;
  let requests = 0;
  await page.route("**/api/webui/queues/robotwin/tasks?*", async (route) => {
    requests++;
    await route.fulfill({
      json: {
        items: newTask
          ? [{ ...items[0], id: "new-task", name: "new-task" }, ...items]
          : items,
        next_cursor: null,
      },
    });
  });
  await page.getByRole("heading", { name: "robotwin" }).click();
  await expect(page.locator(".list-summary")).toContainText("Loaded 2000 /");
  expect(await page.locator("tbody tr[data-task-id]").count()).toBeLessThan(50);
  const time = page.locator("tbody time").first();
  await expect(time).toHaveText(/^\d{2}-\d{2} \d{2}:\d{2}$/);
  await expect(time).toHaveAttribute("data-tooltip", /T.*Z/);
  await time.hover();
  await expect(page.getByRole("tooltip")).toBeVisible({ timeout: 250 });
  await expect(page.getByRole("tooltip")).toContainText("Z");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  const taskName = page.locator("tbody .task-name").first();
  await taskName.hover();
  await expect(page.getByRole("tooltip")).toHaveText("large-task-0", { timeout: 250 });
  await page.locator(".crumb").hover();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  const handle = page.getByRole("separator", {
    name: "Resize Task",
    exact: true,
  });
  const headers = page.locator(".virtual-table thead th:not(.table-filler)");
  const widths = () => headers.evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().width));
  const beforeWidths = await widths();
  const initialWidth = Number(await handle.getAttribute("aria-valuenow"));
  const bounds = (await handle.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 10);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + 10);
  await page.mouse.up();
  await expect(handle).toHaveAttribute(
    "aria-valuenow",
    String(initialWidth + 60),
  );
  const afterWidths = await widths();
  const coverage = await page.locator(".table-wrap").evaluate((el) => {
    const table = el.querySelector("table")!;
    const filler = table.querySelector("thead .table-filler")!;
    return { container: el.clientWidth, table: table.getBoundingClientRect().width,
      end: filler.getBoundingClientRect().right, tableEnd: table.getBoundingClientRect().right };
  });
  expect(coverage.table).toBeGreaterThanOrEqual(coverage.container - 1);
  expect(coverage.end).toBeCloseTo(coverage.tableEnd, 0);
  for (let i = 0; i < beforeWidths.length; i++) {
    expect(afterWidths[i] - beforeWidths[i]).toBeCloseTo(i === 2 ? 60 : 0, 0);
  }
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  const shrunkWidths = await widths();
  for (let i = 0; i < beforeWidths.length; i++) {
    expect(shrunkWidths[i] - afterWidths[i]).toBeCloseTo(i === 2 ? -16 : 0, 0);
  }
  await page.keyboard.press("ArrowRight");
  await page.reload();
  await expect(handle).toHaveAttribute(
    "aria-valuenow",
    String(initialWidth + 60),
  );
  const beforeFit = await widths();
  await page.locator('th[data-column-id="task"]').dblclick();
  const fitted = Number(await handle.getAttribute("aria-valuenow"));
  expect(fitted).toBeLessThan(initialWidth + 60);
  const afterFit = await widths();
  for (let i = 0; i < beforeFit.length; i++) {
    if (i !== 2) expect(afterFit[i]).toBeCloseTo(beforeFit[i], 0);
  }
  await handle.press("ArrowRight");
  await handle.dblclick();
  await expect(handle).toHaveAttribute("aria-valuenow", String(fitted));
  const list = page.locator(".table-wrap");
  await list.evaluate((el) => {
    el.scrollTop = 4200;
  });
  await expect
    .poll(async () =>
      page
        .locator("tbody tr[data-task-id]")
        .first()
        .getAttribute("data-task-id"),
    )
    .not.toBe("large_0");
  const anchor = await page
    .locator("tbody tr[data-task-id]")
    .first()
    .getAttribute("data-task-id");
  const scrollTop = await list.evaluate((el) => el.scrollTop);
  newTask = true;
  const requestsWhileReading = requests;
  await page.waitForTimeout(6000);
  expect(requests).toBe(requestsWhileReading);
  await expect(
    page.getByRole("button", { name: /new tasks available/ }),
  ).toHaveCount(0);
  await expect(page.locator("tbody tr[data-task-id]").first()).toHaveAttribute(
    "data-task-id",
    anchor!,
  );
  expect(await list.evaluate((el) => el.scrollTop)).toBe(scrollTop);
  expect(await page.locator("tbody tr[data-task-id]").count()).toBeLessThan(50);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("new-task", { exact: true }).first(),
  ).toBeVisible();
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(page.locator(".list-summary")).toContainText("Loaded 2001 /");
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(
    page.getByText("large-task-1999", { exact: true }),
  ).toBeVisible();
  expect(requests).toBeGreaterThan(1);
});
