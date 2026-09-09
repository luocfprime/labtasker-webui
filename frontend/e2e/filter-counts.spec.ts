import {expect, test} from '@playwright/test';
test('status cards follow applied filters and refresh with the list', async ({page}) => {
  await page.request.post('http://127.0.0.1:18765/__test__/reset');
  let filteredRequests = 0;
  await page.route('**/api/webui/queues/*/tasks/count?*', async route => {
    const params = new URL(route.request().url()).searchParams;
    const filter = params.get('filter');
    const status = params.get('status');
    if (filter) {
      expect(filter).toBe('status in ["pending", "running"]');
      filteredRequests++;
      const count = status === 'pending' ? 2 : status === 'running' ? 1 : status ? 0 : 3;
      await route.fulfill({json: {count}});
    } else await route.continue();
  });
  await page.goto('/');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:18765');
  await page.getByRole('button', {name: 'Connect', exact:true}).click();
  await page.getByRole('heading', {name: 'robotwin', exact:true}).click();
  await page.getByLabel('Advanced filter expression').fill('status in ["pending", "running"]');
  await page.getByLabel('Advanced filter expression').press('Enter');
  await expect(page.locator('.stats .pending strong')).toHaveText('2');
  await expect(page.locator('.stats .running strong')).toHaveText('1');
  for (const status of ['succeeded','failed','cancelled']) await expect(page.locator(`.stats .${status} strong`)).toHaveText('0');
  const before = filteredRequests;
  await page.getByRole('button', {name:'Refresh', exact:true}).click();
  await expect.poll(() => filteredRequests).toBeGreaterThanOrEqual(before + 6);
});

test('draft filters stay explicit and survive status shortcuts', async ({page}) => {
  await page.request.post('http://127.0.0.1:18765/__test__/reset');
  await page.goto('/');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:18765');
  await page.getByRole('button', {name:'Connect', exact:true}).click();
  await page.getByRole('heading', {name:'robotwin', exact:true}).click();
  const filter = page.getByLabel('Advanced filter expression');
  await filter.fill('priority > 0');
  await page.getByLabel('Task name', {exact:true}).fill('demo');
  await expect(page.getByRole('button', {name:'Apply', exact:true})).toBeVisible();
  await expect(page.getByRole('button', {name:'Delete all matching', exact:true})).toHaveCount(0);
  await page.locator('.stats .pending').click();
  await expect(filter).toHaveValue('priority > 0');
  await expect(page.getByLabel('Task name', {exact:true})).toHaveValue('demo');
  await expect(page.getByRole('button', {name:'Delete all matching', exact:true})).toHaveCount(0);
  await filter.press('Enter');
  await expect(page.getByRole('button', {name:'Apply', exact:true})).toBeVisible();
  await expect(page.getByRole('button', {name:'Delete all matching', exact:true})).toHaveCount(0);
});


test('dropdowns and completed text edits apply without the Apply button', async ({page}) => {
  await page.request.post('http://127.0.0.1:18765/__test__/reset');
  await page.goto('/');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:18765');
  await page.getByRole('button', {name:'Connect', exact:true}).click();
  await page.getByRole('heading', {name:'robotwin', exact:true}).click();
  await page.getByRole('combobox', {name:'Sort field'}).click();
  await page.getByRole('option', {name:'Updated', exact:true}).click();
  await expect(page).toHaveURL(/order_by=updated_at/);
  await page.getByRole('combobox', {name:'Sort direction'}).click();
  await page.getByRole('option', {name:'Ascending', exact:true}).click();
  await expect(page).toHaveURL(/descending=false/);
  await page.getByRole('combobox', {name:'All statuses'}).click();
  await page.getByRole('option', {name:'pending', exact:true}).click();
  await expect(page).toHaveURL(/status=pending/);
  const filter = page.getByLabel('Advanced filter expression');
  await filter.fill('priority > 0');
  await filter.press('Tab');
  await page.getByRole('combobox', {name:'Sort field'}).focus();
  await expect.poll(() => new URL(page.url()).searchParams.get('filter')).toBe('priority > 0');
  const name = page.getByLabel('Task name', {exact:true});
  await name.fill('demo');
  await name.press('Tab');
  await expect(page).toHaveURL(/name=demo/);
  await page.getByRole('button', {name:'Filter syntax and examples', exact:true}).click();
  await page.getByRole('button', {name:/Includes route/}).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('filter')).toBe('"gpu-a100" in routes');
  await expect(page.getByRole('button', {name:'Apply', exact:true})).toBeVisible();
  await expect(page.getByRole('button', {name:'Delete all matching'})).toHaveCount(0);
});
