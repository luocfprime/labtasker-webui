import { expect, test } from "@playwright/test";

test("notification Retry belongs to the active Worker filter", async ({page}) => {
  await page.request.post("http://127.0.0.1:18765/__test__/reset");
  for (const path of ["**/task-groups?*", "**/worker-groups"]) {
    await page.route(path, route => route.fulfill({json: {items: [], next_cursor: null}}));
  }
  let holdAllRetry = false;
  let idleSucceeds = false;
  let allRetryStarted = false;
  let allRetryCompleted = false;
  let release!: () => void;
  const pendingAll = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/workers?*", async route => {
    const filter = new URL(route.request().url()).searchParams.get("filter");
    if (!filter && holdAllRetry) {
      allRetryStarted = true;
      await pendingAll;
    }
    if (filter === 'status == "idle"' && idleSucceeds) {
      return route.fulfill({json: {items: [], next_cursor: null}});
    }
    await route.fulfill({status: 501, json: {error: {message: "Unsupported", code: "unsupported"}}});
    if (!filter && holdAllRetry) allRetryCompleted = true;
  });
  await page.goto("/");
  await page.getByLabel("Server URL").fill("http://127.0.0.1:18765");
  await page.getByRole("button", {name: "Connect", exact: true}).click();
  await page.getByRole("heading", {name: "robotwin", exact: true}).click();
  await page.getByRole("button", {name: "Workers", exact: true}).click();
  const notice = page.locator(".observation-notice");
  await expect(notice).toContainText("Not supported by this Server.");
  await expect(notice).toContainText("Worker list");
  holdAllRetry = true;
  try {
    await notice.getByRole("button", {name: "Retry", exact: true}).click();
    await expect.poll(() => allRetryStarted).toBe(true);
    await expect(notice.getByRole("button", {name: "Retrying…", exact: true})).toBeDisabled();
    await page.getByRole("combobox", {name: "Worker status"}).click();
    await page.getByRole("option", {name: "Idle", exact: true}).click();
    await expect(page).toHaveURL(/worker_status=idle/);
    await expect(page.locator(".workers-panel")).toContainText("Worker observations unavailable");
    await expect(notice.getByRole("button", {name: "Retry", exact: true})).toBeEnabled();
    idleSucceeds = true;
    await notice.getByRole("button", {name: "Retry", exact: true}).click();
    await expect(page.locator(".workers-panel")).toContainText("No active Worker observations");
    await expect(notice).toHaveCount(0);
  } finally {
    release();
  }
  await expect.poll(() => allRetryCompleted).toBe(true);
  await expect(page.locator(".workers-panel")).toContainText("No active Worker observations");
  await expect(notice).toHaveCount(0);
});

test('completed grouped retries do not wait for an inactive sibling request', async ({page}) => {
  await page.request.post('http://127.0.0.1:18765/__test__/reset');
  let recovering = false;
  let release!: () => void;
  const oldTaskRequest = new Promise<void>(resolve => { release = resolve; });
  const unsupported = {status:501,json:{error:{message:'Unsupported',code:'unsupported'}}};
  await page.route('**/worker-groups', route => route.fulfill(recovering
    ? {json:{items:[],next_cursor:null}} : unsupported));
  await page.route('**/task-groups?*', async route => {
    if (!recovering) return route.fulfill(unsupported);
    if (new URL(route.request().url()).searchParams.get('include_inactive') === 'false') await oldTaskRequest;
    await route.fulfill({json:{items:[],next_cursor:null}});
  });
  await page.goto('/');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:18765');
  await page.getByRole('button',{name:'Connect',exact:true}).click();
  await page.getByRole('heading',{name:'robotwin',exact:true}).click();
  const notice = page.locator('.observation-notice');
  await expect(notice).toContainText('Task route counts · Worker counts');
  recovering = true;
  try {
    await notice.getByRole('button',{name:'Retry',exact:true}).click();
    await page.getByLabel('Include inactive routes').check();
    await expect(page.getByText('Route counts unavailable',{exact:true})).toHaveCount(0);
    await expect(notice).toHaveCount(0);
  } finally { release(); }
});
