import { expect, test, type Page } from "@playwright/test";

async function connect(page: Page) {
  await page.request.post("http://127.0.0.1:18765/__test__/reset");
  await page.goto("/");
  await page.getByLabel("Server URL").fill("http://127.0.0.1:18765");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("heading", { name: "robotwin", exact: true }).click();
}

test("Task progress is compact in the list and complete in Task details", async ({
  page,
}) => {
  await connect(page);

  const running = page.locator('tr[data-task-id="t_RUNNING12345"]');
  const progressCell = running.locator('td[data-column-id="progress"]');
  const ring = progressCell.getByRole("progressbar", {
    name: "Task progress: 42%",
  });
  await expect(ring).toHaveAttribute("aria-valuenow", "42");
  await expect(ring).toHaveCSS("width", "14px");
  await expect(ring).toHaveCSS("height", "14px");
  await expect(ring.locator(".progress-ring-value")).toHaveCSS("vector-effect", "none");
  await expect(progressCell).toBeEmpty();
  expect((await progressCell.boundingBox())?.width).toBeCloseTo(88, 0);

  const statusCell = running.locator('td[data-column-id="status"]');
  const statusBadge = statusCell.locator(".badge");
  const statusBounds = (await statusCell.boundingBox())!;
  const badgeBounds = (await statusBadge.boundingBox())!;
  expect(statusBounds.width).toBeGreaterThanOrEqual(104);
  expect(badgeBounds.x).toBeGreaterThanOrEqual(statusBounds.x);
  expect(badgeBounds.x + badgeBounds.width).toBeLessThanOrEqual(
    statusBounds.x + statusBounds.width,
  );

  const progressHandle = page.getByRole("separator", {
    name: "Resize Progress",
    exact: true,
  });
  await expect(progressHandle).toHaveAttribute("aria-valuemin", "56");
  await expect(progressHandle).toHaveAttribute("aria-valuenow", "88");
  await progressHandle.focus();
  await progressHandle.press("ArrowRight");
  await expect(progressHandle).toHaveAttribute("aria-valuenow", "104");
  expect((await progressCell.boundingBox())?.width).toBeCloseTo(104, 0);

  await ring.hover();
  const popover = page.getByRole("tooltip", { name: "Task progress details" });
  await expect(popover).toContainText("42%");
  await expect(popover).toContainText("42.9");
  await expect(popover).toContainText("validation_loss");

  await ring.click();
  await page.mouse.move(0, 0);
  await expect(popover).toBeVisible();
  await expect(page).not.toHaveURL(/task=/);
  await page.locator(".crumb").click();
  await expect(popover).toHaveCount(0);

  const terminalProgress = page.locator(
    'tr[data-task-id="t_SUCCEEDED123"] td[data-column-id="progress"]',
  );
  await expect(terminalProgress).toBeEmpty();

  await page.getByText("score-checkpoint", { exact: true }).click();
  const drawer = page.locator("aside.drawer");
  const progressHeading = drawer.getByRole("heading", { name: "Progress" });
  const resultHeading = drawer.getByRole("heading", { name: "Result" });
  await expect(progressHeading).toBeVisible();
  await expect(drawer).toContainText("Attempt 1");
  await expect(drawer).toContainText("validation_loss");
  expect(
    await progressHeading.evaluate(
      (progress, result) =>
        Boolean(
          progress.compareDocumentPosition(result as Node) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      await resultHeading.elementHandle(),
    ),
  ).toBe(true);
});
