import {expect, test} from '@playwright/test';

test('Worker rows open a restorable details drawer with metadata and telemetry', async ({page}) => {
  await page.setViewportSize({width:1440,height:800});
  await page.request.post('http://127.0.0.1:18765/__test__/reset');
  const worker = {
    id:'worker-with-an-extremely-long-identifier-that-must-never-push-the-close-button-offscreen',
    queue:'robotwin',route:'gpu-a100',status:'busy',task_id:'t_ABCDEFGHIJKL',
    metadata:{hostname:'node-7',device:{index:0},model:'robotwin-v2'},
    telemetry:{gpu:{utilization:0.75,memory_used_bytes:123456},phase:'inference'},
    telemetry_updated_at:'2026-09-16T08:00:00Z',
    last_seen_at:new Date().toISOString(),expires_at:new Date(Date.now()+300000).toISOString(),
  };
  await page.route('**/worker-groups', route => route.fulfill({json:{items:[
    {key:{route:'gpu-a100',status:'busy'},count:1},
  ],next_cursor:null}}));
  await page.route('**/workers?*', route => route.fulfill({json:{items:[worker],next_cursor:null}}));
  await page.goto('/');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:18765');
  await page.getByRole('button',{name:'Connect',exact:true}).click();
  await page.getByRole('heading',{name:'robotwin',exact:true}).click();
  await page.getByRole('button',{name:'Workers',exact:true}).click();
  await page.locator(`[data-worker-link="${worker.id}"]`).click();

  const drawer = page.locator('aside.drawer[aria-label="Worker details"]');
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`worker=${encodeURIComponent(worker.id)}`));
  await expect(drawer.getByRole('heading',{name:'Metadata'})).toBeVisible();
  await expect(drawer.getByRole('heading',{name:'Telemetry'})).toBeVisible();
  await expect(drawer).toContainText('node-7');
  await expect(drawer).toContainText('utilization');
  const drawerBox = (await drawer.boundingBox())!;
  const closeBox = (await drawer.getByRole('button',{name:'Close',exact:true}).boundingBox())!;
  expect(closeBox.x).toBeGreaterThanOrEqual(drawerBox.x);
  expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(drawerBox.x + drawerBox.width);

  await drawer.getByRole('button',{name:'t_ABCDEFGHIJKL',exact:true}).click();
  await expect(page.locator('aside.drawer[aria-label="Task details"]')).toBeVisible();
  await expect(page).toHaveURL(/task=t_ABCDEFGHIJKL/);
  await page.goBack();
  await expect(page.locator('aside.drawer[aria-label="Worker details"]')).toBeVisible();
  await expect(page).toHaveURL(/worker=/);
});
