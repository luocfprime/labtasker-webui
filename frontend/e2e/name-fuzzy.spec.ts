import {expect, test} from '@playwright/test';

test('name fuzzy applies on commit and shares selection with counts and deletion', async ({page}) => {
  await page.request.post('http://127.0.0.1:18765/__test__/reset');
  await page.goto('/');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:18765');
  await page.getByRole('button', {name: 'Connect', exact: true}).click();
  await page.getByRole('heading', {name: 'robotwin', exact: true}).click();
  await expect(page.locator('tbody tr[data-task-id]')).toHaveCount(4);
  const name = page.getByLabel('Task name', {exact: true});
  await name.fill('  CP EV  ');
  await expect(page.locator('tbody tr[data-task-id]')).toHaveCount(4);
  const listing = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname.endsWith('/tasks') && url.searchParams.get('name_fuzzy') === '  CP EV  ';
  });
  await name.press('Enter');
  await listing;
  await expect(page.locator('tbody tr[data-task-id]')).toHaveCount(1);
  await expect(page.locator('tbody tr[data-task-id]')).toHaveAttribute('data-task-id', 't_ABCDEFGHIJKL');
  await expect(page.getByText('Loaded 1 / 1 tasks', {exact: true})).toBeVisible();
  await expect(page.locator('.stats .pending strong')).toHaveText('1');
  await expect(page.locator('.stats .running strong')).toHaveText('0');
  const snapshot = await page.request.post('/api/webui/queues/robotwin/delete-snapshot', {
    data: {name_fuzzy: '  CP EV  '},
  });
  expect(snapshot.ok()).toBeTruthy();
  expect((await snapshot.json()).task_ids).toEqual(['t_ABCDEFGHIJKL']);
  await page.getByRole('checkbox', {name: 'Select loaded tasks', exact: true}).check();
  await page.getByRole('button', {name: 'Delete Tasks', exact: true}).click();
  await expect(page.getByRole('dialog')).toContainText('1');
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  await page.reload();
  await expect(name).toHaveValue('  CP EV  ');
  await expect(page.locator('tbody tr[data-task-id]')).toHaveCount(1);
  await name.fill('   ');
  await name.press('Tab');
  await expect(page.locator('tbody tr[data-task-id]')).toHaveCount(4);
  await expect(page.getByRole('button', {name: 'Delete all matching', exact: true})).toHaveCount(0);
});
