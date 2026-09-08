import { expect, test } from "@playwright/test";

test("column picker stays open for selection and dismisses outside or with Escape", async ({
  page,
}) => {
  await page.request.post("http://127.0.0.1:18765/__test__/reset");
  await page.goto("/");
  await page.getByLabel("Server URL").fill("http://127.0.0.1:18765");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("heading", { name: "robotwin" }).click();
  const menu = page.locator(".column-menu");
  const trigger = menu.locator("summary");
  await trigger.click();
  await menu.getByLabel("Priority", { exact: true }).uncheck();
  await expect(menu).toHaveAttribute("open", "");
  await expect(
    page.getByRole("columnheader", { name: "Priority", exact: true }),
  ).toHaveCount(0);
  await menu.getByLabel("Priority", { exact: true }).check();
  await expect(
    page.getByRole("columnheader", { name: "Priority", exact: true }),
  ).toBeVisible();
  await page.getByRole("heading", { name: "robotwin" }).click();
  await expect(menu).not.toHaveAttribute("open");
  await trigger.click();
  await menu.getByLabel("Status", { exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(menu).not.toHaveAttribute("open");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByLabel("Task name", { exact: true }).focus();
  await expect(menu).not.toHaveAttribute("open");
  await trigger.click();
  await trigger.click();
  await expect(menu).not.toHaveAttribute("open");
});
