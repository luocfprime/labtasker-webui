import { expect, test } from "@playwright/test";

test("failed Worker append retries its cursor without a duplicate corner notification", async ({page}) => {
  await page.request.post("http://127.0.0.1:18765/__test__/reset");
  await page.setViewportSize({width: 1280, height: 720});
  for (const path of ["**/task-groups?*", "**/worker-groups"]) {
    await page.route(path, route => route.fulfill({json: {items: [], next_cursor: null}}));
  }
  const worker = (id: string) => ({
    id, queue: "robotwin", route: "pagination-route", status: "idle", task_id: null,
    last_seen_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 300_000).toISOString(),
  });
  const firstPage = Array.from({length: 50}, (_, index) => worker(`worker-${index}`));
  const cursors: (string | null)[] = [];
  let failAppend = true;
  await page.route("**/workers?*", route => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    cursors.push(cursor);
    if (cursor === "workers-page-2") {
      return route.fulfill(failAppend
        ? {status: 400, json: {error: {message: "Worker page unavailable", code: "invalid_request"}}}
        : {json: {items: [worker("recovered-worker")], next_cursor: null}});
    }
    return route.fulfill({json: {items: firstPage, next_cursor: "workers-page-2"}});
  });
  await page.goto("/");
  await page.getByLabel("Server URL").fill("http://127.0.0.1:18765");
  await page.getByRole("button", {name: "Connect", exact: true}).click();
  await page.getByRole("heading", {name: "robotwin", exact: true}).click();
  await page.getByRole("button", {name: "Workers", exact: true}).click();
  const table = page.locator(".worker-table");
  await expect(table.locator("tbody tr")).toHaveCount(50);
  await table.evaluate(element => { element.scrollTop = element.scrollHeight; });
  const retry = table.getByRole("button", {name: "Retry loading", exact: true});
  await expect(retry).toBeVisible();
  await expect(page.locator(".observation-notice")).toHaveCount(0);
  await expect(table.locator("tbody tr")).toHaveCount(50);
  expect(cursors.filter(cursor => cursor === "workers-page-2")).toHaveLength(1);

  const firstPageRequests = cursors.filter(cursor => cursor === null).length;
  failAppend = false;
  await retry.click();
  await expect(table.getByText("recovered-worker", {exact: true})).toBeVisible();
  await expect(table.locator("tbody tr")).toHaveCount(51);
  await expect(retry).toHaveCount(0);
  await expect(page.locator(".observation-notice")).toHaveCount(0);
  expect(cursors.filter(cursor => cursor === "workers-page-2")).toHaveLength(2);
  expect(cursors.filter(cursor => cursor === null)).toHaveLength(firstPageRequests);
});
