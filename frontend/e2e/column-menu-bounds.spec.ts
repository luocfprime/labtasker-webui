import {expect, test} from '@playwright/test';

test('Columns menu stays inside the viewport when opened and resized', async ({page}) => {
  await page.request.post('http://127.0.0.1:18765/__test__/reset');
  await page.goto('/');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:18765');
  await page.getByRole('button', {name:'Connect', exact:true}).click();
  await page.getByRole('heading', {name:'robotwin', exact:true}).click();
  const trigger = page.locator('.column-menu summary');
  const panel = page.locator('.column-menu > div');
  for (const size of [{width:1440,height:900}, {width:900,height:600}, {width:390,height:700}]) {
    await page.setViewportSize(size);
    await trigger.scrollIntoViewIfNeeded();
    if (!(await page.locator('.column-menu').getAttribute('open') !== null)) await trigger.click();
    await expect(panel).toBeVisible();
    await expect.poll(async () => {
      const bounds = await panel.boundingBox();
      return !!bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= size.width && bounds.y + bounds.height <= size.height;
    }).toBe(true);
    await panel.getByRole('button', {name:'Add', exact:true}).scrollIntoViewIfNeeded();
    const button = await panel.getByRole('button', {name:'Add', exact:true}).boundingBox();
    expect(button!.x + button!.width).toBeLessThanOrEqual(size.width);
  }
  await trigger.press('Escape');
  await expect(panel).toBeHidden();
});
