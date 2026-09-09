import {expect, test, type Page, type Locator} from '@playwright/test';

async function connect(page: Page) {
  await page.request.post('http://127.0.0.1:18765/__test__/reset');
  await page.goto('/');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:18765');
  await page.getByRole('button', {name:'Connect', exact:true}).click();
  await page.getByRole('heading', {name:'robotwin', exact:true}).click();
}
async function inside(page: Page, panel: Locator) {
  await expect(panel).toBeVisible();
  await expect.poll(async () => {
    const b = await panel.boundingBox(); const v = page.viewportSize()!;
    return !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= v.width + 1 && b.y + b.height <= v.height + 1;
  }).toBe(true);
}
test('audit: filter help fits a short viewport and keeps all controls accessible', async ({page}) => {
  await page.setViewportSize({width:900,height:600});
  await connect(page);
  await page.getByRole('button', {name:'Filter syntax and examples',exact:true}).click();
  await inside(page, page.locator('.filter-help'));
  await expect(page.locator('.filter-help .filter-examples').first().getByRole('button')).toHaveCount(10);
  await page.getByRole('button', {name:'Save current',exact:true}).scrollIntoViewIfNeeded();
  await inside(page, page.getByRole('button', {name:'Save current',exact:true}));
});
test('audit: long saved-view lists fit the viewport and keyboard selection stays visible', async ({page}) => {
  await page.setViewportSize({width:900,height:600});
  await page.addInitScript(() => {
    const state = {filters:{status:'',name:'',filter:'',order_by:'created_at',descending:true},visible:['status','task'],custom:[],order:['status','task'],widths:{}};
    localStorage.setItem('labtasker:views:v1', JSON.stringify({'http://127.0.0.1:18765/robotwin': {active:'',views:Array.from({length:30}, (_,i) => ({id:String(i),name:`View ${i} ${'long-name-'.repeat(8)}`,state}))}}));
  });
  await connect(page);
  const select = page.getByRole('combobox', {name:'Data view'});
  await select.click();
  await inside(page, page.locator('.view-selector .ui-select-menu'));
  await select.press('End');
  await inside(page, page.getByRole('option').last());
  await select.press('Enter');
  await expect(select).toContainText('View 29');
});
test('audit: narrow layout and view dialog remain usable', async ({page}) => {
  await page.setViewportSize({width:390,height:700});
  await connect(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('combobox', {name:'Data view'}).click();
  await page.getByRole('button', {name:'+ Create view',exact:true}).click();
  await inside(page, page.getByRole('dialog'));
  await page.getByLabel('View name').fill('Preview');
  await page.getByRole('button', {name:'Create view',exact:true}).click();
  await page.getByRole('button', {name:'View actions',exact:true}).click();
  await inside(page, page.getByRole('menu', {name:'View actions'}));
  await page.getByRole('menuitem', {name:'Rename',exact:true}).click();
  await page.getByLabel('View name').fill('Renamed');
  await page.getByRole('button', {name:'Rename',exact:true}).click();
  await expect(page.getByRole('combobox', {name:'Data view'})).toContainText('Renamed');
});

test('audit: invalid filters show an error promptly and recover after correction', async ({page}) => {
  await connect(page);
  let invalidRequests = 0;
  await page.route('**/api/webui/queues/robotwin/tasks?*', async route => {
    if (new URL(route.request().url()).searchParams.get('filter') === 'priority >') {
      invalidRequests++;
      await route.fulfill({status:422,json:{error:{message:'Invalid filter: expected a value',code:'invalid_filter'}}});
    } else await route.continue();
  });
  const filter = page.getByLabel('Advanced filter expression');
  await filter.fill('priority >');
  await filter.press('Enter');
  await expect(page.getByRole('alert').filter({hasText:'Invalid filter: expected a value'})).toBeVisible({timeout:1500});
  expect(invalidRequests).toBe(1);
  await filter.fill('priority > 0');
  await filter.press('Enter');
  await expect(page.getByRole('alert').filter({hasText:'Invalid filter:'})).toHaveCount(0);
  await expect(page.locator('tbody tr[data-task-id]').first()).toBeVisible();
});

test('audit: sorting preserves selection while filtering clears it', async ({page}) => {
  await connect(page);
  const row = page.locator('tbody input[type="checkbox"]').first();
  const label = await row.getAttribute('aria-label');
  await row.check();
  await page.getByRole('combobox', {name:'Sort direction'}).click();
  await page.getByRole('option', {name:'Ascending', exact:true}).click();
  await expect(page.getByLabel(label!, {exact:true})).toBeChecked();
  await expect(page.locator('.selection')).toContainText('1 Task selected');
  await page.getByRole('combobox', {name:'All statuses'}).click();
  await page.getByRole('option', {name:'pending', exact:true}).click();
  await expect(page.locator('.selection')).toHaveCount(0);
});

test('profile recovery keeps failed writes across a full page reload', async ({page}) => {
  let fail = true;
  let disk: Record<string,string> = {};
  await page.route('**/api/webui/profile', async route => {
    if (route.request().method() === 'PATCH') {
      if (fail) await route.fulfill({status:500,json:{detail:'Simulated disk failure'}});
      else {
        disk = {...disk, ...route.request().postDataJSON()};
        await route.fulfill({json:{ok:true}});
      }
    } else await route.fulfill({json:{enabled:true,ui:disk}});
  });
  await connect(page);
  await page.locator('.column-menu summary').click();
  await page.locator('.column-menu').getByLabel('Priority',{exact:true}).uncheck();
  await page.locator('.column-menu summary').click();
  await expect(page.locator('.profile-save-error')).toBeVisible();
  await page.reload();
  await expect(page.locator('th[data-column-id="task"]')).toBeVisible();
  await expect(page.locator('th[data-column-id="priority"]')).toHaveCount(0);
  await expect(page.locator('.profile-save-error')).toBeVisible();
  fail = false;
  await page.locator('.profile-save-error').getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.locator('.profile-save-error')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('th[data-column-id="task"]')).toBeVisible();
  await expect(page.locator('th[data-column-id="priority"]')).toHaveCount(0);
});

test('audit: reconnecting after authorization loss never reveals the previous connection cache', async ({page}) => {
  await connect(page);
  await expect(page.locator('tbody tr[data-task-id]').first()).toBeVisible();
  let reconnected = false;
  let releaseStatus!: () => void;
  const statusGate = new Promise<void>(resolve => {releaseStatus = resolve;});
  await page.route('**/api/webui/status', async route => {
    if (!reconnected) return route.continue();
    await statusGate;
    await route.fulfill({json:{connected:true,locked:false,server_url:'http://127.0.0.1:19999',connection_error:null}});
  });
  await page.route('**/api/webui/connect', async route => {
    reconnected = true;
    await route.fulfill({json:{connected:true,server_url:'http://127.0.0.1:19999'}});
  });
  await page.route('**/api/webui/queues/robotwin/tasks**', async route => {
    if (!reconnected) return route.continue();
    await statusGate;
    await route.fulfill({json:route.request().url().includes('/count') ? {count:0} : {items:[],next_cursor:null}});
  });
  await page.evaluate(() => dispatchEvent(new CustomEvent('labtasker:unauthorized')));
  await page.getByLabel('Server URL').fill('http://127.0.0.1:19999');
  await page.getByRole('button',{name:'Connect',exact:true}).click();
  try {
    await expect(page.getByRole('heading',{name:'Connect to Labtasker'})).toHaveCount(0);
    await expect(page.locator('tbody tr[data-task-id]')).toHaveCount(0);
  } finally { releaseStatus(); }
  await expect(page.locator('.server')).toContainText('127.0.0.1:19999');
});

test('audit: large profiles save successfully in the browser', async ({page}) => {
  const archived = JSON.stringify({archived:{active:'',views:[],note:'é'.repeat(40000)}});
  await page.addInitScript(value => localStorage.setItem('labtasker:views:v1', value), archived);
  let saved: Record<string,string> = {};
  await page.route('**/api/webui/profile', async route => {
    if (route.request().method() === 'PATCH') {
      saved = {...saved,...route.request().postDataJSON()};
      await route.fulfill({json:{ok:true}});
    } else await route.fulfill({json:{enabled:true,ui:{}}});
  });
  await connect(page);
  await expect.poll(() => saved['labtasker:views:v1']).toBe(archived);
  await expect(page.locator('.profile-save-error')).toHaveCount(0);
});
