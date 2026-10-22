import {expect, test, type Page} from '@playwright/test';

async function open(page: Page) {
  await page.request.post('http://127.0.0.1:18765/__test__/reset');
  await page.goto('/');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:18765');
  await page.getByRole('button', {name:'Connect', exact:true}).click();
  await page.getByRole('heading', {name:'robotwin', exact:true}).click();
}

async function archiveSelected(page: Page) {
  await page.getByRole('button', {name:'Archive selected',exact:true}).click();
  await page.getByRole('dialog').getByRole('button', {name:/^Archive \d+ Tasks?$/}).click();
}

test('batch archive waits for confirmation and cancellation keeps the selection', async ({page}) => {
  let requests = 0;
  await page.route('**/tasks/*/archived', async route => {
    requests++;
    await route.continue();
  });
  await open(page);
  await page.getByRole('checkbox', {name:'Select t_MNOPQRSTUVWX',exact:true}).check();
  await page.getByRole('checkbox', {name:'Select t_SUCCEEDED123',exact:true}).check();
  const archive = page.getByRole('button', {name:'Archive selected',exact:true});
  await archive.click();
  const dialog = page.getByRole('dialog', {name:'Archive 2 Tasks?'});
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('You can restore them later');
  expect(requests).toBe(0);
  await expect(dialog.getByRole('button', {name:'Cancel',exact:true})).toBeFocused();
  await dialog.getByRole('button', {name:'Cancel',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(archive).toBeFocused();
  await expect(page.locator('.selection')).toContainText('2 Tasks selected');
  expect(requests).toBe(0);
  await archive.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(requests).toBe(0);
  await archive.click();
  await dialog.getByRole('button', {name:'Archive 2 Tasks',exact:true}).evaluate(button => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(page.locator('.selection')).toHaveCount(0);
  await expect(page.locator('.stats .all strong')).toHaveText('2');
  expect(requests).toBe(2);
});

test('archive selection, persisted scope, direct drawer and restore', async ({page}) => {
  await open(page);
  const row = page.locator('tr[data-task-id="t_MNOPQRSTUVWX"]');
  await row.getByRole('checkbox').check();
  await archiveSelected(page);
  await expect(row).toHaveCount(0);
  await expect(page.locator('.stats .all strong')).toHaveText('3');
  await page.getByRole('checkbox', {name:'Include archived', exact:true}).check();
  await expect(row).toBeVisible();
  await expect(row).toContainText('Archived');
  await expect(page.locator('.stats .all strong')).toHaveText('4');
  await expect(page).toHaveURL(/include_archived=true/);
  await page.reload();
  await expect(page.getByRole('checkbox', {name:'Include archived', exact:true})).toBeChecked();
  await row.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('Archived', {exact:true})).toBeVisible();
  await drawer.getByRole('button', {name:'Restore', exact:true}).click();
  await expect(drawer.getByRole('button', {name:'Archive', exact:true})).toBeVisible();
  await drawer.getByRole('button', {name:'Archive', exact:true}).click();
  await expect(drawer.getByRole('button', {name:'Restore', exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog').getByRole('button', {name:'Restore', exact:true})).toBeVisible();
  await page.getByRole('dialog').getByRole('button', {name:'Requeue', exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('button', {name:'Restore', exact:true})).toHaveCount(0);
});

test('changing archive range clears selection and follows browser history', async ({page}) => {
  await open(page);
  await page.getByRole('checkbox', {name:'Select t_ABCDEFGHIJKL', exact:true}).check();
  await expect(page.getByRole('button', {name:'Archive selected', exact:true})).toBeDisabled();
  await page.getByRole('checkbox', {name:'Include archived', exact:true}).check();
  await expect(page.locator('.selection')).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole('checkbox', {name:'Include archived', exact:true})).not.toBeChecked();
  await page.goForward();
  await expect(page.getByRole('checkbox', {name:'Include archived', exact:true})).toBeChecked();
  await expect(page.locator('tr[data-task-id="t_ABCDEFGHIJKL"]')).toBeVisible();
  await page.screenshot({path:test.info().outputPath('archive-scope.png')});
});

test('batch archive and restore apply to every selected terminal Task', async ({page}) => {
  await open(page);
  for (const id of ['t_MNOPQRSTUVWX', 't_SUCCEEDED123']) {
    await page.getByRole('checkbox', {name:`Select ${id}`,exact:true}).check();
  }
  await archiveSelected(page);
  await expect(page.locator('.selection')).toHaveCount(0);
  await expect(page.locator('.stats .all strong')).toHaveText('2');
  await page.getByRole('checkbox', {name:'Include archived',exact:true}).check();
  for (const id of ['t_MNOPQRSTUVWX', 't_SUCCEEDED123']) {
    const row = page.locator(`tr[data-task-id="${id}"]`);
    await expect(row).toContainText('Archived');
    await row.getByRole('checkbox').check();
  }
  await page.getByRole('button', {name:'Restore selected',exact:true}).click();
  await expect(page.locator('.selection')).toHaveCount(0);
  await page.getByRole('checkbox', {name:'Include archived',exact:true}).uncheck();
  await expect(page.locator('.stats .all strong')).toHaveText('4');
});

test('a partial batch archive retains only failed Task IDs for retry', async ({page}) => {
  await page.route('**/tasks/t_MNOPQRSTUVWX/archived', route => route.fulfill({status:503,json:{error:{message:'Archive request failed'}}}));
  await open(page);
  for (const id of ['t_MNOPQRSTUVWX', 't_SUCCEEDED123']) {
    await page.getByRole('checkbox', {name:`Select ${id}`,exact:true}).check();
  }
  await archiveSelected(page);
  await expect(page.locator('.selection')).toContainText('1 Task selected');
  await expect(page.locator('.selection')).toContainText('1 Task archived; 1 Task failed');
  await expect(page.getByRole('checkbox', {name:'Select t_MNOPQRSTUVWX',exact:true})).toBeChecked();
  await expect(page.locator('tr[data-task-id="t_SUCCEEDED123"]')).toHaveCount(0);
});

test('archive visibility shares the status row and stays usable on narrow screens', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});
  await open(page);
  const checkbox = page.getByRole('checkbox', {name:'Include archived',exact:true});
  await expect(checkbox).toBeVisible();
  const count = (await page.locator('.stats .all').boundingBox())!;
  const toggle = (await checkbox.locator('..').boundingBox())!;
  expect(Math.abs(toggle.y + toggle.height / 2 - count.y - count.height / 2)).toBeLessThanOrEqual(2);
  await page.screenshot({path:test.info().outputPath('compact-archive-toggle.png')});
  await checkbox.focus();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  await expect(page).toHaveURL(/include_archived=true/);
  await page.setViewportSize({width:390,height:700});
  await expect(checkbox).toBeVisible();
  const narrowToggle = (await checkbox.locator('..').boundingBox())!;
  expect(narrowToggle.x).toBeGreaterThanOrEqual(0);
  expect(narrowToggle.x + narrowToggle.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('archive badge precedes a long name without increasing row height', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});
  await page.route('**/api/webui/queues/robotwin/tasks?*', async route => {
    const response = await route.fetch();
    const body = await response.json();
    for (const task of body.items) {
      if (task.id === 't_MNOPQRSTUVWX') task.name = 'A long archived experiment name '.repeat(5);
    }
    await route.fulfill({response,json:body});
  });
  await open(page);
  const row = page.locator('tr[data-task-id="t_MNOPQRSTUVWX"]');
  const height = (await row.boundingBox())!.height;
  await row.getByRole('checkbox').check();
  await archiveSelected(page);
  await expect(row).toHaveCount(0);
  await page.getByRole('checkbox', {name:'Include archived',exact:true}).check();
  const badge = row.locator('.task-archive-badge');
  await expect(badge).toHaveText('Archived');
  const badgeBounds = (await badge.boundingBox())!;
  const name = row.locator('.task-name');
  const nameBounds = (await name.boundingBox())!;
  expect(badgeBounds.x + badgeBounds.width).toBeLessThan(nameBounds.x);
  expect(await name.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  expect((await row.boundingBox())!.height).toBe(height);
  await page.screenshot({path:test.info().outputPath('leading-archive-badge.png')});
  await page.locator('th[data-column-id="task"]').dblclick();
  expect(await name.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});
