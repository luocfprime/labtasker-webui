import { expect, test } from "@playwright/test";
test("custom columns show missing values blank, reorder and survive reload", async ({page}) => {
  await page.request.post("http://127.0.0.1:18765/__test__/reset");
  await page.goto("/");
  await page.getByLabel("Server URL").fill("http://127.0.0.1:18765");
  await page.getByRole("button", {name:"Connect", exact:true}).click();
  await page.getByRole("heading", {name:"robotwin"}).click();
  await page.locator(".column-menu summary").click();
  const menu = page.locator(".column-menu");
  for (const path of ["args.foo.bar", "priority"]) {
    await menu.getByLabel("Custom column · JSON path", {exact:true}).fill(path);
    await menu.getByRole("button", {name:"Add",exact:true}).click();
  }
  await expect(page.locator('td[data-column-id="path:args.foo.bar"]').first()).toHaveText("");
  const custom = page.locator('td[data-column-id="path:priority"]').first();
  const native = page.locator('td[data-column-id="priority"]').first();
  await expect(custom).toHaveText((await native.innerText()).replace(/[↑↓]/g, '').trim());
  await menu.getByRole("button", {name:"Reorder priority",exact:true}).dragTo(menu.locator('[data-column-order-id="path:args.foo.bar"]'));
  const order = () => page.locator("thead th[data-column-id]").evaluateAll((cells)=>cells.map((cell)=>cell.getAttribute("data-column-id")));
  expect((await order()).slice(-2)).toEqual(["path:priority", "path:args.foo.bar"]);
  await page.reload();
  await expect(custom).toBeVisible();
  expect((await order()).slice(-2)).toEqual(["path:priority", "path:args.foo.bar"]);
  await page.locator(".column-menu summary").click();
  await menu.getByRole("button", {name:"Remove args.foo.bar",exact:true}).click();
  await expect(page.locator('th[data-column-id="path:args.foo.bar"]')).toHaveCount(0);
});
