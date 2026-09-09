import { expect, test } from "@playwright/test";

test.beforeEach(async ({page}) => {
  await page.request.post("http://127.0.0.1:18765/__test__/reset");
  for (const path of ["**/task-groups?*", "**/worker-groups"]) {
    await page.route(path, route => route.fulfill({json: {items: [], next_cursor: null}}));
  }
  await page.goto("/");
  await page.getByLabel("Server URL").fill("http://127.0.0.1:18765");
  await page.getByRole("button", {name: "Connect", exact: true}).click();
  await page.getByRole("heading", {name: "robotwin", exact: true}).click();
});

test("reverse Tab from View actions returns to its trigger and closes the menu", async ({page}) => {
  const trigger = page.getByRole("button", {name: "View actions", exact: true});
  const menu = page.getByRole("menu", {name: "View actions", exact: true});
  await trigger.click();
  await expect(menu.getByRole("menuitem", {name: "Save as…", exact: true})).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(trigger).toBeFocused();
  await expect(menu).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(menu).toBeVisible();
  await trigger.click();
  await expect(menu).toHaveCount(0);
});

test("moving focus to Data view closes View actions before keyboard opening", async ({page}) => {
  const trigger = page.getByRole("button", {name: "View actions", exact: true});
  const menu = page.getByRole("menu", {name: "View actions", exact: true});
  const picker = page.getByRole("combobox", {name: "Data view", exact: true});
  await trigger.click();
  await expect(menu.getByRole("menuitem", {name: "Save as…", exact: true})).toBeFocused();
  await picker.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox", {name: "Data view", exact: true})).toBeVisible();
  await expect(menu).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("View actions closes when focus leaves via its trigger", async ({page}) => {
  const trigger = page.getByRole("button", {name: "View actions", exact: true});
  const menu = page.getByRole("menu", {name: "View actions", exact: true});
  await trigger.click();
  await expect(menu).toBeVisible();
  await trigger.focus();
  await page.getByRole("button", {name: "All Queues", exact: true}).focus();
  await expect(menu).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});
