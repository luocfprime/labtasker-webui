import { expect, test } from "@playwright/test";

test("connect, inspect, requeue, and delete selected filtered tasks", async ({
  page,
}) => {
  await page.request.post("http://127.0.0.1:18765/__test__/reset");
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Connect to Labtasker" }),
  ).toBeVisible();
  await page.getByLabel("Server URL").fill("http://127.0.0.1:18765");
  await page.getByRole("button", { name: "Connect" }).click();

  await expect(page.getByRole("heading", { name: "Queues" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "robotwin" })).toBeVisible();
  await page.getByRole("heading", { name: "robotwin" }).click();

  await expect(
    page.getByText("generate-rollouts", { exact: true }),
  ).toBeVisible();
  await page.getByText("generate-rollouts", { exact: true }).click();
  const drawer = page.locator("aside.drawer");
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByText("CUDA out of memory", { exact: true }),
  ).toBeVisible();
  await drawer.getByRole("button", { name: "Requeue" }).click();
  await expect(drawer.locator(".task-summary .badge")).toHaveText(/pending/i);
  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(drawer).toBeHidden();

  const statusSelect = page.getByRole("combobox", { name: "All statuses" });
  await statusSelect.click();
  await page.locator(".crumb").click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await statusSelect.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await statusSelect.click();
  await page.getByRole("option", { name: "pending", exact: true }).click();
  await expect(page).toHaveURL(/status=pending/);
  await page.getByRole("checkbox", { name: "Select loaded tasks" }).check();
  await page.getByRole("button", { name: "Delete Tasks" }).click();

  const dialog = page.getByRole("dialog", { name: "Delete 2 Tasks?" });
  await expect(dialog).toContainText("2 immutable Task IDs");
  await dialog
    .getByRole("button", { name: "Delete permanently" })
    .press("Enter");
  await expect(dialog.getByRole("button", { name: "Done" })).toBeEnabled();
  await expect(dialog).toContainText("2 deleted");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(
    page.getByRole("heading", { name: "No matching Tasks" }),
  ).toBeVisible();
});
