import { expect, test, type Page } from "@playwright/test";

async function open(page: Page) {
  await page.request.post("http://127.0.0.1:18765/__test__/reset");
  await page.goto("/");
  await page.getByLabel("Server URL").fill("http://127.0.0.1:18765");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("heading", { name: "robotwin", exact: true }).click();
  await expect(page.getByText("train-policy", { exact: true })).toBeVisible();
}

test("Progress minimum width survives reloading", async ({ page }, info) => {
  await open(page);
  const handle = page.getByRole("separator", {
    name: "Resize Progress",
    exact: true,
  });
  await handle.focus();
  await handle.press("ArrowLeft");
  await handle.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", "56");
  await page.screenshot({ path: info.outputPath("width-before-reload.png") });
  await page.reload();
  await expect(page.getByText("train-policy", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("width-after-reload.png") });
  await expect(handle).toHaveAttribute("aria-valuenow", "56");
});

test("Progress summary clicks do not open Task details", async ({
  page,
}, info) => {
  await open(page);
  await page
    .getByRole("button", { name: "Show Task progress: 42%", exact: true })
    .click();
  const popup = page.getByRole("dialog", {
    name: "Task progress details",
    exact: true,
  });
  await expect(popup).toBeVisible();
  await page.screenshot({ path: info.outputPath("summary-before-click.png") });
  await popup.locator(".json-node summary").first().click();
  await page.screenshot({ path: info.outputPath("summary-after-click.png") });
  await expect(page).not.toHaveURL(/task=/);
});

test("Space on a Task checkbox selects it without opening the drawer", async ({
  page,
}, info) => {
  await open(page);
  const checkbox = page.getByRole("checkbox", {
    name: "Select t_ABCDEFGHIJKL",
    exact: true,
  });
  await checkbox.focus();
  await page.screenshot({ path: info.outputPath("checkbox-before-space.png") });
  await checkbox.press("Space");
  await page.screenshot({ path: info.outputPath("checkbox-after-space.png") });
  await expect(checkbox).toBeChecked();
  await expect(page).not.toHaveURL(/task=/);
  await checkbox.press("Space");
  await expect(checkbox).not.toBeChecked();
  const row = page.locator('tr[data-task-id="t_ABCDEFGHIJKL"]');
  await row.focus();
  await row.press("Enter");
  await expect(page).toHaveURL(/task=t_ABCDEFGHIJKL/);
});

test("Escape inside a pinned Progress summary dismisses it", async ({
  page,
}, info) => {
  await open(page);
  await page
    .getByRole("button", { name: "Show Task progress: 42%", exact: true })
    .click();
  const popup = page.getByRole("dialog", {
    name: "Task progress details",
    exact: true,
  });
  const timestamp = popup.locator("time");
  await timestamp.focus();
  await page.screenshot({ path: info.outputPath("summary-before-escape.png") });
  await timestamp.press("Escape");
  await page.screenshot({ path: info.outputPath("summary-after-escape.png") });
  await expect(popup).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Show Task progress: 42%", exact: true }),
  ).toBeFocused();
});

test("29 completed out of 100 displays 29 percent", async ({ page }, info) => {
  await page.route("**/api/webui/queues/robotwin/tasks?*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    for (const task of data.items) {
      if (task.id === "t_RUNNING12345")
        task.progress = { completed: 29, total: 100 };
    }
    await route.fulfill({ response, json: data });
  });
  await open(page);
  const running = page.locator('tr[data-task-id="t_RUNNING12345"]');
  await running.getByRole("button", { name: /Show Task progress/ }).click();
  await page.screenshot({ path: info.outputPath("progress-29-of-100.png") });
  await expect(running.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "29",
  );
});

test("a reported ETA takes precedence over the linear fallback", async ({
  page,
}) => {
  await page.route("**/api/webui/queues/robotwin/tasks?*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    for (const task of data.items) {
      if (task.id === "t_RUNNING12345") {
        task.progress.eta = 600;
        task.progress_updated_at = new Date(Date.now() - 2 * 60_000).toISOString();
      }
    }
    await route.fulfill({ response, json: data });
  });
  await open(page);
  await page
    .getByRole("button", { name: "Show Task progress: 42%", exact: true })
    .hover();
  const eta = page.locator('[data-tooltip^="Worker-reported ETA"]');
  await expect(eta).toHaveText("8m remaining");
});
