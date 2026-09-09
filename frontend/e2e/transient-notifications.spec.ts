import {expect,test} from '@playwright/test';

test('a new transient notification gets its own full display duration', async ({page}) => {
  await page.clock.install();
  await page.request.post('http://127.0.0.1:18765/__test__/reset');
  await page.goto('/');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:18765');
  await page.getByRole('button',{name:'Connect',exact:true}).click();
  await page.getByRole('heading',{name:'robotwin',exact:true}).click();
  await page.locator('th[data-column-id="task"]').dblclick();
  const toast = page.locator('#toast');
  await expect(toast).toContainText('Task fitted to content');
  await expect(toast).toHaveClass('visible');
  await page.clock.fastForward(4000);
  await page.locator('th[data-column-id="priority"]').dblclick();
  await expect(toast).toContainText('Priority fitted to content');
  await page.clock.fastForward(1500);
  await expect(toast).toHaveClass('visible');
  await page.clock.fastForward(4000);
  await expect(toast).not.toHaveClass('visible');
});

test('long custom-column feedback fits a narrow viewport', async ({page}) => {
  await page.setViewportSize({width:390,height:700});
  await page.request.post('http://127.0.0.1:18765/__test__/reset');
  await page.goto('/');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:18765');
  await page.getByRole('button',{name:'Connect',exact:true}).click();
  await page.getByRole('heading',{name:'robotwin',exact:true}).click();
  const path = 'args.' + 'long_custom_field_'.repeat(10);
  const menu = page.locator('.column-menu');
  await menu.locator('summary').click();
  await menu.getByLabel('Custom column · JSON path',{exact:true}).fill(path);
  await menu.getByRole('button',{name:'Add',exact:true}).click();
  await menu.locator('summary').click();
  await page.locator(`th[data-column-id="path:${path}"]`).dblclick();
  const toast = page.locator('#toast');
  await expect(toast).toHaveClass('visible');
  await expect(toast).toHaveCSS('opacity','1');
  expect(await toast.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const bounds = (await toast.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({path:test.info().outputPath('long-feedback.png')});
});
