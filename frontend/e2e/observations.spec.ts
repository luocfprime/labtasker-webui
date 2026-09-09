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
  const delayed = page.locator('tr', {hasText:'delayed-worker'}).locator('.observation-delayed');
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({width,height:700});
    await expect(delayed).toBeVisible();
    expect(await delayed.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize({width:1280,height:720});
  await page.screenshot({path: test.info().outputPath("workers.png")});
});

test('failed route refresh does not label stale Task observations inactive', async ({page}) => {
  await page.clock.install();
  await page.request.post('http://127.0.0.1:18765/__test__/reset');
  let fail = false;
  await page.route('**/task-groups?*', route => fail
    ? route.fulfill({status:501,json:{error:{message:'Grouped counts unavailable',code:'unsupported'}}})
    : route.fulfill({json:{items:[{key:{routes:'completed-route',status:'succeeded'},count:1}],next_cursor:null}}));
  await page.route('**/worker-groups', route => route.fulfill({json:{items:[],next_cursor:null}}));
  await page.goto('/');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:18765');
  await page.getByRole('button',{name:'Connect',exact:true}).click();
  await page.getByRole('heading',{name:'robotwin',exact:true}).click();
  const route = page.getByRole('button',{name:/completed-route/});
  await expect(route).toContainText('Inactive');
  fail = true;
  await page.clock.fastForward(15000);
  await expect(route).toContainText('Task counts unavailable');
  await expect(route).not.toContainText('Inactive');
  await expect(route).toContainText('No active Workers');
  await expect(route.getByRole('img')).toHaveAttribute('aria-label','Route observations unavailable');
});

test('observation failures share a dismissible corner notification and retry together', async ({page}) => {
  await page.request.post('http://127.0.0.1:18765/__test__/reset');
  let fail = true;
  for (const path of ['**/task-groups?*', '**/worker-groups', '**/workers?*']) {
    await page.route(path, route => route.fulfill(fail
      ? {status:501,json:{error:{message:'Unsupported',code:'unsupported'}}}
      : {json:{items:[],next_cursor:null}}));
  }
  await page.goto('/');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:18765');
  await page.getByRole('button',{name:'Connect',exact:true}).click();
  await page.getByRole('heading',{name:'robotwin',exact:true}).click();
  const notice = page.locator('.observation-notice');
  await expect(notice).toHaveCount(1);
  await expect(notice).toContainText('Not supported by this Server.');
  await expect(page.locator('.route-sidebar .observation-error')).toHaveCount(0);
  await page.getByRole('button',{name:'Workers',exact:true}).click();
  await expect(notice).toHaveCount(1);
  await expect(notice).toContainText('Worker list');
  for (const width of [1440,900,390]) {
    await page.setViewportSize({width,height:700});
    const box = (await notice.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeCloseTo(688, 0);
    await page.screenshot({path:test.info().outputPath(`notification-${width}.png`)});
  }
  fail = false;
  await notice.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(notice).toHaveCount(0);
  await expect(page.locator('.workers-panel')).toContainText('No active Worker observations');
  fail = true;
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(notice).toHaveCount(1);
  await notice.getByRole('button',{name:'Dismiss notification'}).click();
  await expect(notice).toHaveCount(0);
  await page.getByRole('button',{name:'Tasks',exact:true}).click();
  await page.getByRole('button',{name:'Workers',exact:true}).click();
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.locator('.workers-panel')).toContainText('Worker observations unavailable');
  await expect(notice).toHaveCount(0);
  await page.route('**/worker-groups', route => route.fulfill({
    status:400,json:{error:{message:'Worker counts request failed.',code:'invalid_request'}},
  }));
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(notice).toHaveCount(1);
  await expect(notice).toContainText('Worker counts request failed.');
  await expect(notice).not.toContainText('Not supported by this Server.');
  await notice.getByRole('button',{name:'Dismiss notification'}).focus();
  await page.keyboard.press('Escape');
  await expect(notice).toHaveCount(0);
});

test('corner notifications do not overlap settings recovery or close the Task drawer', async ({page}) => {
  await page.request.post('http://127.0.0.1:18765/__test__/reset');
  let saveFails = false;
  await page.route('**/api/webui/profile', route => route.fulfill(
    route.request().method() === 'PATCH'
      ? saveFails ? {status:500,json:{detail:'Simulated disk failure'}} : {json:{ok:true}}
      : {json:{enabled:true,ui:{}}}));
  for (const path of ['**/task-groups?*','**/worker-groups']) {
    await page.route(path, route => route.fulfill({status:501,json:{error:{message:'Unsupported',code:'unsupported'}}}));
  }
  await page.goto('/');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:18765');
  await page.getByRole('button',{name:'Connect',exact:true}).click();
  await page.getByRole('heading',{name:'robotwin',exact:true}).click();
  await expect(page.locator('.observation-notice')).toBeVisible();
  saveFails = true;
  await page.getByRole('button',{name:'Collapse Routes'}).click();
  await expect(page.locator('.profile-save-error')).toBeVisible();
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:700});
    const notices = (await page.locator('.observation-notice').boundingBox())!;
    const profile = (await page.locator('.profile-save-error').boundingBox())!;
    expect(notices.y + notices.height <= profile.y || profile.y + profile.height <= notices.y).toBe(true);
    await page.screenshot({path:test.info().outputPath(`stacked-notifications-${width}.png`)});
  }
  await page.setViewportSize({width:1440,height:700});
  await page.getByText('generate-rollouts',{exact:true}).click();
  const drawer = page.locator('.drawer');
  await expect(drawer).toBeVisible();
  await page.locator('.observation-notice').getByRole('button',{name:'Dismiss notification'}).click();
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(/task=t_MNOPQRSTUVWX/);
  saveFails = false;
  await page.locator('.profile-save-error').getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.locator('.profile-save-error')).toHaveCount(0);
  await expect(drawer).toBeVisible();
});

test('observation notification stays visible while its Retry is pending', async ({page}) => {
  await page.request.post('http://127.0.0.1:18765/__test__/reset');
  let retrying = false;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  for (const path of ['**/task-groups?*','**/worker-groups']) {
    await page.route(path, async route => {
      if (!retrying) return route.fulfill({status:501,json:{error:{message:'Unsupported',code:'unsupported'}}});
      await pending;
      return route.fulfill({json:{items:[],next_cursor:null}});
    });
  }
  await page.goto('/');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:18765');
  await page.getByRole('button',{name:'Connect',exact:true}).click();
  await page.getByRole('heading',{name:'robotwin',exact:true}).click();
  const notice = page.locator('.observation-notice');
  await expect(notice).toContainText('Task route counts · Worker counts');
  retrying = true;
  try {
    await notice.getByRole('button',{name:'Retry',exact:true}).click();
    await expect(notice.getByRole('button',{name:'Retrying…',exact:true})).toBeDisabled();
    await expect(notice).toHaveCount(1);
    await expect(notice.getByRole('button',{name:'Dismiss notification'})).toBeEnabled();
  } finally { release(); }
  await expect(notice).toHaveCount(0);
});
