import { expect, test } from "@playwright/test";

test("compact status counts, route navigation, Worker freshness and connection return", async ({page}) => {
  await page.request.post("http://127.0.0.1:18765/__test__/reset");
  await page.route("**/task-groups?*", async route => {
    const inactive = new URL(route.request().url()).searchParams.get("include_inactive") === "true";
    await route.fulfill({json: {group_by: ["routes", "status"], count: 4, items: [
      {key: {routes: "waiting-route", status: "pending"}, count: 3},
      ...(inactive ? [{key: {routes: "completed-route", status: "succeeded"}, count: 1}] : []),
    ], next_cursor: null}});
  });
  await page.route("**/worker-groups", route => route.fulfill({json: {group_by: ["route", "status"], count: 2, items: [
    {key: {route: "gpu-long-route-name-for-hover", status: "idle"}, count: 2},
  ], next_cursor: null}}));
  await page.route("**/workers?*", route => route.fulfill({json: {items: [
    {id: "normal-worker", queue: "robotwin", route: "gpu-long-route-name-for-hover", status: "idle", task_id: null, last_seen_at: new Date(Date.now()-60000).toISOString(), expires_at: new Date(Date.now()+240000).toISOString()},
    {id: "delayed-worker", queue: "robotwin", route: "gpu-long-route-name-for-hover", status: "idle", task_id: null, last_seen_at: new Date(Date.now()-150000).toISOString(), expires_at: new Date(Date.now()+150000).toISOString()},
  ], next_cursor: null}}));
  await page.goto("/");
  await page.getByLabel("Server URL").fill("http://127.0.0.1:18765");
  await page.getByRole("button", {name: "Connect", exact: true}).click();
  await page.getByRole("heading", {name: "robotwin", exact: true}).click();
  await expect(page.locator(".stats .all")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".stats .all strong")).toHaveText("4");
  await expect(page.locator(".toolbar")).toHaveCSS("border-top-width", "0px");
  await expect(page.locator(".table-wrap")).toHaveCSS("border-top-width", "0px");
  await expect(page.locator(".route-waiting").first()).toBeVisible();
  expect((await page.getByLabel("Task name", {exact:true}).boundingBox())!.width).toBeGreaterThanOrEqual(220);
  const railHeader = (await page.locator(".route-all").boundingBox())!;
  const tabHeader = (await page.locator(".workspace-tabs").boundingBox())!;
  expect(railHeader.y).toBeCloseTo(tabHeader.y, 0);
  expect(railHeader.height).toBeCloseTo(tabHeader.height, 0);
  const allBackground = await page.locator(".stats .all").evaluate(el => getComputedStyle(el).backgroundColor);
  const count = page.locator(".stats .pending");
  await expect(count).toContainText("pending");
  const number = await count.locator("strong").boundingBox();
  const word = await count.locator("span").boundingBox();
  expect(number!.x + number!.width).toBeLessThan(word!.x);
  expect(Math.abs(number!.y + number!.height - word!.y - word!.height)).toBeLessThan(8);
  await expect(page.getByRole("button", {name: /waiting-route/})).toContainText("No active Workers");
  await expect(page.getByRole("button", {name: /completed-route/})).toHaveCount(0);
  await page.getByLabel("Include inactive routes").check();
  await expect(page.getByRole("button", {name: /completed-route/})).toBeVisible();
  await count.click();
  await expect(count).toHaveAttribute("aria-pressed", "true");
  await expect(count).toHaveCSS("box-shadow", "none");
  expect(await count.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(allBackground);
  await page.locator(".stats .all").click();
  await expect(page).not.toHaveURL(/status=pending/);
  const toggle = page.locator(".routes-toggle");
  const toggleBefore = (await toggle.boundingBox())!;
  const tabsBefore = (await page.locator(".workspace-tabs").boundingBox())!;
  await page.getByRole("button", {name: "Collapse Routes"}).click();
  expect((await toggle.boundingBox())!.y).toBeCloseTo(toggleBefore.y, 0);
  expect((await page.locator(".workspace-tabs").boundingBox())!.y).toBeCloseTo(tabsBefore.y, 0);
  await expect(page.locator(".workspace-tabs .routes-toggle")).toHaveCount(0);
  await expect(page.getByRole("complementary", {name: "Routes"})).toHaveCount(0);
  await page.getByRole("button", {name: "Show Routes"}).click();
  await page.getByRole("button", {name: "Workers", exact: true}).click();
  await expect(page.locator("tr", {hasText: "normal-worker"})).not.toContainText("Expires");
  await expect(page.locator("tr", {hasText: "delayed-worker"})).toContainText("Update delayed · Expires in");
  const picker = page.getByRole("combobox", {name: "Worker status"});
  await expect(picker).toContainText("All statuses");
  await expect(picker).toHaveCSS("height", "32px");
  await picker.click();
  await page.getByRole("option", {name: "Idle", exact: true}).click();
  await expect(page).toHaveURL(/worker_status=idle/);
  await expect(page.locator(".worker-idle-count")).toHaveAttribute("aria-pressed", "true");
  const idleColor = await page.locator(".worker-idle-count strong").evaluate(el => getComputedStyle(el).color);
  const busyColor = await page.locator(".worker-busy-count strong").evaluate(el => getComputedStyle(el).color);
  expect(idleColor).not.toBe(busyColor);
  await page.locator(".worker-route").first().hover();
  await expect(page.getByRole("tooltip")).toHaveText("gpu-long-route-name-for-hover", {timeout: 250});
  await page.getByRole("button", {name: "Change", exact: true}).click();
  await page.getByRole("button", {name: "Back to workspace"}).click();
  await expect(page.getByRole("button", {name: "Workers", exact: true})).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({path: test.info().outputPath("workers.png")});
});
