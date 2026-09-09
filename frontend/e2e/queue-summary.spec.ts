import {expect, test} from '@playwright/test';

test('Queue summary wraps within narrow cards and keeps status navigation', async ({page}) => {
  await page.request.post('http://127.0.0.1:18765/__test__/reset');
  await page.route('**/worker-groups', route => route.fulfill({json: {items: [
    {key: {route: 'gpu', status: 'idle'}, count: 2},
    {key: {route: 'gpu', status: 'busy'}, count: 4},
  ], next_cursor: null}}));
  await page.route('**/task-groups?*', route => route.fulfill({json: {items: [
    {key: {routes: 'waiting', status: 'pending'}, count: 5},
    {key: {routes: 'gpu', status: 'running'}, count: 4},
  ], next_cursor: null}}));
  await page.goto('/');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:18765');
  await page.getByRole('button', {name:'Connect', exact:true}).click();
  const card = page.locator('.queue-card').filter({has:page.getByRole('heading', {name:'robotwin',exact:true})});
  await expect(card.locator('.queue-worker-summary .queue-worker-idle')).toHaveText('2 Idle');
  await expect(card.locator('.queue-worker-summary .queue-worker-busy')).toHaveText('4 Busy');
  await expect(card.locator('.queue-route-waiting')).toHaveText('1 Waiting');
  await expect(card.locator('.queue-route-summary .queue-worker-busy')).toHaveText('1 Busy');
  await expect(card.locator('.queue-progress-label')).toContainText('Tasks completed');
  for (const width of [1440, 390]) {
    await page.setViewportSize({width,height:900});
    await expect(card).toBeVisible();
    const bounds = (await card.boundingBox())!;
    for (const button of await card.locator('.status-row button').all()) {
      const item = (await button.boundingBox())!;
      expect(item.x).toBeGreaterThanOrEqual(bounds.x);
      expect(item.x + item.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    }
  }
  await card.locator('.status-row .succeeded').click();
  await expect(page).toHaveURL(/status=succeeded/);
  await expect(page.locator('.stats .succeeded')).toHaveAttribute('aria-pressed','true');
});
