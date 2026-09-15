import {expect, test} from '@playwright/test';

test('Worker columns resize, fit content and persist per Queue', async ({page}) => {
  await page.request.post('http://127.0.0.1:18765/__test__/reset');
  await page.route('**/worker-groups', route => route.fulfill({json:{items:[
    {key:{route:'gpu-route-with-a-distinctively-long-name',status:'idle'},count:1},
  ],next_cursor:null}}));
  await page.route('**/workers?*', route => route.fulfill({json:{items:[{
    id:'worker-with-a-distinctively-long-identifier', queue:'robotwin',
    route:'gpu-route-with-a-distinctively-long-name', status:'idle', task_id:null,
    last_seen_at:new Date(Date.now()-30_000).toISOString(),
    expires_at:new Date(Date.now()+270_000).toISOString(),
  }],next_cursor:null}}));
  await page.goto('/');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:18765');
  await page.getByRole('button',{name:'Connect',exact:true}).click();
  await page.getByRole('heading',{name:'robotwin',exact:true}).click();
  await page.getByRole('button',{name:'Workers',exact:true}).click();

  const defaults = {Worker:240, Status:100, Route:200, Task:240, 'Last seen':210};
  for (const [name, width] of Object.entries(defaults)) {
    await expect(page.getByRole('separator',{name:`Resize ${name}`,exact:true}))
      .toHaveAttribute('aria-valuenow',String(width));
  }

  const worker = page.getByRole('separator',{name:'Resize Worker',exact:true});
  const box = (await worker.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 48, box.y + box.height / 2);
  await page.mouse.up();
  await expect(worker).toHaveAttribute('aria-valuenow','288');

  const routeHeader = page.locator('th[data-column-id="route"]');
  await routeHeader.dblclick();
  await expect(page.locator('#toast')).toContainText('Route fitted to content');
  const fittedRoute = Number(await routeHeader.getByRole('separator').getAttribute('aria-valuenow'));
  expect(fittedRoute).toBeGreaterThan(200);
  expect(await page.locator('.worker-route').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath('worker-columns.png')});

  await page.reload();
  await expect(page.getByRole('button',{name:'Workers',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('separator',{name:'Resize Worker',exact:true})).toHaveAttribute('aria-valuenow','288');
  await expect(page.getByRole('separator',{name:'Resize Route',exact:true})).toHaveAttribute('aria-valuenow',String(fittedRoute));
});
