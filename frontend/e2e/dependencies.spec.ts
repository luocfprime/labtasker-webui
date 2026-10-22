import {expect, test, type Page} from '@playwright/test';

const child = 't_ABCDEFGHIJKL';
const parent = 't_SUCCEEDED123';
const failed = 't_MNOPQRSTUVWX';
const missing = 't_MISSING00001';

async function open(page: Page, dependencies: string[]) {
  await page.request.post('http://127.0.0.1:18765/__test__/reset');
  await page.request.patch(`http://127.0.0.1:18765/api/v2/queues/robotwin/tasks/${child}`, {data:{dependencies}});
  await page.request.patch(`http://127.0.0.1:18765/api/v2/queues/robotwin/tasks/${parent}`, {data:{archived:true}});
  await page.goto('/');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:18765');
  await page.getByRole('button', {name:'Connect', exact:true}).click();
  await page.getByRole('heading', {name:'robotwin', exact:true}).click();
  await page.getByText('evaluate-checkpoint', {exact:true}).click();
}

test('dependency links preserve order and duplicates and open archived predecessors', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});
  await open(page, [parent, failed, parent, child]);
  const dependencies = page.getByRole('region', {name:'Dependencies'});
  await expect(dependencies).toBeVisible();
  await expect(dependencies.getByRole('button')).toHaveText([parent, failed, parent, child]);
  await expect(dependencies).toContainText('Experimental');
  await expect(page.locator(`tr[data-task-id="${parent}"]`)).toHaveCount(0);
  await dependencies.screenshot({path:test.info().outputPath('dependencies.png')});
  await dependencies.getByRole('button', {name:parent,exact:true}).first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.drawer h2')).toHaveText('score-checkpoint');
  await expect(page.locator('.task-summary')).toContainText('Archived');
  await expect(page).toHaveURL(new RegExp(`queue=robotwin.*task=${parent}`));
  await expect(page.getByRole('region', {name:'Dependencies'})).toContainText('None');
  await page.reload();
  await expect(page.locator('.drawer h2')).toHaveText('score-checkpoint');
  await page.goBack();
  await expect(page.locator('.drawer')).toHaveCount(0);
});

test('self references do not traverse or repeatedly fetch the dependency graph', async ({page}) => {
  const reads: string[] = [];
  page.on('request', request => {
    if (request.method() === 'GET' && request.url().includes('/api/webui/queues/robotwin/tasks/')) reads.push(request.url());
  });
  await open(page, [child, missing]);
  const dependencies = page.getByRole('region', {name:'Dependencies'});
  await expect(dependencies.getByRole('button')).toHaveText([child, missing]);
  expect(reads.filter(url => url.endsWith(missing))).toHaveLength(0);
  await dependencies.getByRole('button', {name:child,exact:true}).click();
  await expect(page.locator('.drawer h2')).toHaveText('evaluate-checkpoint');
  expect(reads.filter(url => url.endsWith(child))).toHaveLength(1);
  await page.route(`**/api/webui/queues/robotwin/tasks/${missing}`, route => route.fulfill({status:404,json:{error:{code:'task_not_found',message:'Task does not exist.',details:{}}}}));
  await dependencies.getByRole('button', {name:missing,exact:true}).click();
  await expect(page.locator('.drawer')).toHaveCount(0);
  await expect(page.locator('#toast').filter({hasText:'This Task was not found in this Queue.'})).toBeVisible();
  await expect(page.locator(`tr[data-task-id="${child}"]`)).toBeFocused();
});

test('dependency arrays and counts use existing custom columns and persist', async ({page}) => {
  await open(page, [parent, parent]);
  await page.getByRole('button', {name:'Close',exact:true}).click();
  await page.locator('.column-menu summary').click();
  const menu = page.locator('.column-menu');
  for (const path of ['dependencies', 'dependencies.length']) {
    await menu.getByLabel('Custom column · JSON path', {exact:true}).fill(path);
    await menu.getByRole('button', {name:'Add',exact:true}).click();
  }
  const row = page.locator(`tr[data-task-id="${child}"]`);
  await expect(row.locator('td[data-column-id="path:dependencies"]')).toHaveText(JSON.stringify([parent,parent]));
  await expect(row.locator('td[data-column-id="path:dependencies.length"]')).toHaveText('2');
  await page.reload();
  await expect(row.locator('td[data-column-id="path:dependencies.length"]')).toHaveText('2');
});
