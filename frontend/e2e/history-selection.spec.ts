import {expect, test} from '@playwright/test';

test.beforeEach(async ({page}) => {
  await page.request.post('http://127.0.0.1:18765/__test__/reset');
  await page.route('**/api/webui/queues', async route => {
    const response = await route.fetch();
    const queues = await response.json();
    await route.fulfill({json: [...queues, {...queues[0], name:'other'}]});
  });
  await page.goto('/');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:18765');
  await page.getByRole('button', {name:'Connect', exact:true}).click();
  await page.getByRole('heading', {name:'robotwin', exact:true}).click();
});

test('history restores queues, filters and drawers together', async ({page}) => {
  const filter = page.getByLabel('Advanced filter expression');
  await filter.fill('priority > 0');
  await filter.press('Enter');
  await expect(page).toHaveURL(/filter=priority/);
  await filter.fill('priority < 0');
  await filter.press('Enter');
  await expect(filter).toHaveValue('priority < 0');
  await page.goBack();
  await expect(filter).toHaveValue('priority > 0');
  await expect(page.getByRole('button', {name:'Apply', exact:true})).toBeVisible();
  await page.goForward();
  await expect(filter).toHaveValue('priority < 0');
  await page.getByRole('button', {name:'All Queues', exact:true}).click();
  await expect(page.getByRole('heading', {name:'Queues', exact:true})).toBeVisible();
  await page.goBack();
  await expect(filter).toHaveValue('priority < 0');
  await page.goForward();
  await expect(page.getByRole('heading', {name:'Queues', exact:true})).toBeVisible();
  await page.getByRole('heading', {name:'other', exact:true}).click();
  await expect(filter).toHaveValue('');
  await page.goBack();
  await expect(page.getByRole('heading', {name:'Queues', exact:true})).toBeVisible();
  await page.goBack();
  await expect(filter).toHaveValue('priority < 0');
  await page.locator('tbody tr[data-task-id]').first().click();
  await expect(page).toHaveURL(/task=/);
  await page.goBack();
  await expect(page).not.toHaveURL(/task=/);
  await expect(filter).toHaveValue('priority < 0');
});

test('header checkbox distinguishes none, some and all loaded tasks', async ({page}) => {
  const header = page.getByRole('checkbox', {name:'Select loaded tasks', exact:true});
  const rows = page.locator('tbody input[type="checkbox"]');
  await expect(rows.first()).toBeVisible();
  await expect(header).not.toBeChecked();
  await rows.first().check();
  await expect(header).toHaveAttribute('aria-checked', 'mixed');
  await expect(header).toHaveJSProperty('indeterminate', true);
  await header.click();
  await expect(header).toBeChecked();
  await expect(header).toHaveJSProperty('indeterminate', false);
  await header.click();
  await expect(header).not.toBeChecked();
  await expect(header).toHaveJSProperty('indeterminate', false);
  await expect(rows.first()).not.toBeChecked();
});
