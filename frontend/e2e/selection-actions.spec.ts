import {expect, test, type Page} from '@playwright/test';

async function open(page: Page) {
  await page.request.post('http://127.0.0.1:18765/__test__/reset');
  await page.goto('/');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:18765');
  await page.getByRole('button', {name:'Connect', exact:true}).click();
  await page.getByRole('heading', {name:'robotwin', exact:true}).click();
}

test('selected Task actions follow the status requirements', async ({page}) => {
  await open(page);
  await page.getByRole('checkbox', {name:'Select t_ABCDEFGHIJKL', exact:true}).check();
  await page.getByRole('checkbox', {name:'Select t_MNOPQRSTUVWX', exact:true}).check();

  const cancel = page.getByRole('button', {name:'Cancel Tasks', exact:true});
  const requeue = page.getByRole('button', {name:'Requeue Tasks', exact:true});
  const remove = page.getByRole('button', {name:'Delete Tasks', exact:true});
  await expect(cancel).toBeDisabled();
  await expect(requeue).toBeEnabled();
  await expect(remove).toBeEnabled();
  await expect(page.getByRole('button', {name:'Clear selection', exact:true})).toBeVisible();
  await cancel.hover();
  await expect(page.getByRole('tooltip')).toContainText('pending or running');
  await expect(page.getByRole('tooltip')).toContainText('1 failed');
  await cancel.locator('xpath=..').focus();
  await expect(page.getByRole('tooltip')).toContainText('1 failed');

  const priority = page.getByLabel('Priority for selected Tasks', {exact:true});
  const setPriority = page.getByRole('button', {name:'Set priority', exact:true});
  await expect(setPriority).toBeDisabled();
  await priority.fill('1.5');
  await expect(page.getByRole('alert')).toHaveText('Priority must be a whole number in the supported range.');
  await expect(setPriority).toBeDisabled();
  await priority.fill('-7');
  await expect(page.getByText('Priority must be a whole number in the supported range.')).toHaveCount(0);
  await expect(setPriority).toBeEnabled();
  await page.screenshot({path:test.info().outputPath('selection-actions.png')});
  await setPriority.click();
  await expect(page.locator('.selection')).toHaveCount(0);
  await expect(page.locator('tr[data-task-id="t_ABCDEFGHIJKL"] .priority-value')).toHaveText('-7↓');
  await expect(page.locator('tr[data-task-id="t_MNOPQRSTUVWX"] .priority-value')).toHaveText('-7↓');

  await page.getByRole('checkbox', {name:'Select t_RUNNING12345', exact:true}).check();
  await expect(cancel).toBeEnabled();
  await expect(requeue).toBeDisabled();
  await expect(remove).toBeDisabled();
  await expect(page.getByRole('button', {name:'Set priority', exact:true})).toBeDisabled();
  await requeue.hover();
  await expect(page.getByRole('tooltip')).toContainText('pending, failed, or cancelled');
  await expect(page.getByRole('tooltip')).toContainText('1 running');
});

test('Cancel and Requeue apply to every selected Task', async ({page}) => {
  await open(page);
  const pending = page.locator('tr[data-task-id="t_ABCDEFGHIJKL"]');
  const running = page.locator('tr[data-task-id="t_RUNNING12345"]');
  const failed = page.locator('tr[data-task-id="t_MNOPQRSTUVWX"]');

  await pending.getByRole('checkbox').check();
  await running.getByRole('checkbox').check();
  await page.getByRole('button', {name:'Cancel Tasks', exact:true}).click();
  await expect(page.locator('.selection')).toHaveCount(0);
  await expect(pending.locator('.badge')).toHaveText(/cancelled/i);
  await expect(running.locator('.badge')).toHaveText(/cancelled/i);

  await pending.getByRole('checkbox').check();
  await failed.getByRole('checkbox').check();
  await page.getByRole('button', {name:'Requeue Tasks', exact:true}).click();
  await expect(page.locator('.selection')).toHaveCount(0);
  await expect(pending.locator('.badge')).toHaveText(/pending/i);
  await expect(failed.locator('.badge')).toHaveText(/pending/i);
});

test('a partial selected-Task action keeps only failures selected', async ({page}) => {
  await page.route('**/tasks/t_RUNNING12345/cancel', route =>
    route.fulfill({status:503, json:{error:{message:'Worker did not accept cancellation'}}}),
  );
  await open(page);
  await page.getByRole('checkbox', {name:'Select t_ABCDEFGHIJKL', exact:true}).check();
  await page.getByRole('checkbox', {name:'Select t_RUNNING12345', exact:true}).check();

  await page.getByRole('button', {name:'Cancel Tasks', exact:true}).click();

  await expect(page.locator('.selection')).toContainText('1 Task selected');
  await expect(page.getByRole('checkbox', {name:'Select t_ABCDEFGHIJKL', exact:true})).not.toBeChecked();
  await expect(page.getByRole('checkbox', {name:'Select t_RUNNING12345', exact:true})).toBeChecked();
  await expect(page.getByRole('alert')).toContainText('1 Task cancelled; 1 Task failed and remains selected');
  await expect(page.getByRole('alert')).toContainText('Worker did not accept cancellation');
});

test('a rapid repeated batch action submits each selected Task once', async ({page}) => {
  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/tasks/t_ABCDEFGHIJKL/cancel', async route => {
    requests++;
    await gate;
    await route.continue();
  });
  await open(page);
  await page.getByRole('checkbox', {name:'Select t_ABCDEFGHIJKL', exact:true}).check();
  const cancel = page.getByRole('button', {name:'Cancel Tasks', exact:true});

  await cancel.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  try {
    await expect.poll(() => requests).toBe(1);
  } finally {
    release();
  }
  await expect(page.locator('.selection')).toHaveCount(0);
});

test('a partial priority update keeps only failures selected', async ({page}) => {
  await page.route('**/tasks/t_MNOPQRSTUVWX/priority', route =>
    route.fulfill({status:503, json:{error:{message:'Priority update was rejected'}}}),
  );
  await open(page);
  await page.getByRole('checkbox', {name:'Select t_ABCDEFGHIJKL', exact:true}).check();
  await page.getByRole('checkbox', {name:'Select t_MNOPQRSTUVWX', exact:true}).check();
  await page.getByLabel('Priority for selected Tasks', {exact:true}).fill('0');
  await page.getByRole('button', {name:'Set priority', exact:true}).click();

  await expect(page.locator('.selection')).toContainText('1 Task selected');
  await expect(page.getByRole('checkbox', {name:'Select t_ABCDEFGHIJKL', exact:true})).not.toBeChecked();
  await expect(page.getByRole('checkbox', {name:'Select t_MNOPQRSTUVWX', exact:true})).toBeChecked();
  await expect(page.getByRole('alert')).toContainText('Priority 0 set for 1 Task; 1 Task failed and remains selected');
  await expect(page.getByRole('alert')).toContainText('Priority update was rejected');
});
