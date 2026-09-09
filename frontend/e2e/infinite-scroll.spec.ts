import { expect, test } from "@playwright/test";

test("scroll appends pages, preserves selection, deduplicates and resets filters", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.request.post("http://127.0.0.1:18765/__test__/reset");
  await page.goto("/");
  await page.getByLabel("Server URL").fill("http://127.0.0.1:18765");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("heading", { name: "robotwin" })).toBeVisible();
  const seed = await (
    await page.request.get("/api/webui/queues/robotwin/tasks")
  ).json();
  const makeTask = (i: number) => ({
    ...seed.items[0],
    id: `scroll_${i}`,
    name: `scroll-task-${i}`,
  });
  let updated = false;
  await page.route("**/api/webui/queues/robotwin/tasks?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("name_fuzzy") === "filtered") {
      await route.fulfill({
        json: {
          items: [{ ...makeTask(99), name: "filtered-task" }],
          next_cursor: null,
        },
      });
    } else if (url.searchParams.get("cursor") === "next") {
      await route.fulfill({
        json: {
          items: Array.from({ length: 11 }, (_, i) => makeTask(i + 29)),
          next_cursor: null,
        },
      });
    } else {
      await route.fulfill({
        json: {
          items: Array.from({ length: 30 }, (_, i) => ({
            ...makeTask(i),
            ...(updated && i === 0 ? { name: "refreshed-task" } : {}),
          })),
          next_cursor: "next",
        },
      });
    }
  });
  await page.getByRole("heading", { name: "robotwin" }).click();
  await expect(page.locator(".list-summary")).toContainText("Loaded 30 /");
  await page.getByLabel("Select scroll_0", { exact: true }).check();
  const list = page.locator(".table-wrap");
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.locator(".list-summary")).toContainText("Loaded 40 /");
  await list.evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(
    page.getByLabel("Select scroll_0", { exact: true }),
  ).toBeChecked();
  await expect(page.getByRole("button", { name: "Next →" })).toHaveCount(0);
  updated = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("refreshed-task", { exact: true })).toHaveCount(
    1,
  );
  await expect(page.locator(".list-summary")).toContainText("Loaded 40 /");
  await page.getByLabel("Task name", { exact: true }).fill("filtered");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByText("filtered-task", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Select scroll_99", { exact: true }),
  ).not.toBeChecked();
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0);
});

test("short first page fills the viewport and failed append can be retried", async ({
  page,
}) => {
  await page.request.post("http://127.0.0.1:18765/__test__/reset");
  await page.goto("/");
  await page.getByLabel("Server URL").fill("http://127.0.0.1:18765");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("heading", { name: "robotwin" })).toBeVisible();
  const seed = await (
    await page.request.get("/api/webui/queues/robotwin/tasks")
  ).json();
  let fail = true;
  await page.route("**/api/webui/queues/robotwin/tasks?*", async (route) => {
    if (new URL(route.request().url()).searchParams.has("cursor")) {
      if (fail)
        await route.fulfill({
          status: 503,
          json: { error: { message: "Temporary failure" } },
        });
      else
        await route.fulfill({
          json: {
            items: [{ ...seed.items[0], id: "last", name: "last-task" }],
            next_cursor: null,
          },
        });
    } else
      await route.fulfill({
        json: { items: [seed.items[0]], next_cursor: "next" },
      });
  });
  await page.getByRole("heading", { name: "robotwin" }).click();
  await expect(page.getByText("Could not load more tasks.")).toBeVisible({
    timeout: 15000,
  });
  await expect(page.locator("tbody tr")).toHaveCount(1);
  fail = false;
  await page
    .locator(".load-more")
    .getByRole("button", { name: "Retry now" })
    .click();
  await expect(page.getByText("last-task", { exact: true })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(page.getByText("Could not load more tasks.")).toHaveCount(0);
});
