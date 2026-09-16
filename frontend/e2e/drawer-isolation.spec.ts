import {expect,test,type Page} from '@playwright/test';
async function open(page:Page){
  await page.request.post('http://127.0.0.1:18765/__test__/reset');
  await page.goto('/');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:18765');
  await page.getByRole('button',{name:'Connect',exact:true}).click();
  await page.getByRole('heading',{name:'robotwin',exact:true}).click();
  await page.getByText('generate-rollouts',{exact:true}).click();
}
test('drawer close control is a quiet aligned icon until interaction',async({page})=>{
  await page.setViewportSize({width:2400,height:900});
  await open(page);
  const drawer = page.locator('aside.drawer[aria-label="Task details"]');
  const close = drawer.getByRole('button',{name:'Close',exact:true});
  const title = drawer.locator('.drawer-head h2');
  await expect(close).toBeVisible();
  await expect(close).toHaveText('');
  expect(await close.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  const closeBox = (await close.boundingBox())!;
  const titleBox = (await title.boundingBox())!;
  expect(closeBox.width).toBe(32);
  expect(closeBox.height).toBe(32);
  expect(Math.abs(closeBox.y + closeBox.height / 2 - (titleBox.y + titleBox.height / 2))).toBeLessThanOrEqual(3);
  await close.hover();
  expect(await close.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
});
test('switching Tasks does not carry the previous action error into the new drawer',async({page})=>{
  await open(page);
  await page.route('**/tasks/*/requeue',route=>route.fulfill({status:503,json:{error:{message:'Requeue failed for generate-rollouts'}}}));
  await page.locator('.drawer').getByRole('button',{name:'Requeue',exact:true}).click();
  await expect(page.locator('.drawer')).toContainText('Requeue failed for generate-rollouts');
  await page.locator('tbody').getByText('evaluate-checkpoint',{exact:true}).click();
  await expect(page.locator('.drawer h2')).toHaveText('evaluate-checkpoint');
  await expect(page.locator('.drawer')).not.toContainText('Requeue failed for generate-rollouts');
});
test('a slow action on one Task does not disable or report errors on another Task',async({page})=>{
  await open(page);
  let release!:()=>void;const gate=new Promise<void>(r=>release=r);
  await page.route('**/tasks/*/requeue',async route=>{await gate;await route.fulfill({status:503,json:{error:{message:'Delayed failure on previous Task'}}});});
  const response = page.waitForResponse(r => r.url().endsWith('/requeue'));
  await page.locator('.drawer').getByRole('button',{name:'Requeue',exact:true}).click();
  await page.locator('tbody').getByText('evaluate-checkpoint',{exact:true}).click();
  try {
    await expect(page.locator('.drawer h2')).toHaveText('evaluate-checkpoint');
    await expect(page.locator('.drawer').getByRole('button',{name:'Cancel',exact:true})).toBeEnabled();
  }finally{release();}
  await (await response).finished();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.locator('.drawer')).not.toContainText('Delayed failure on previous Task');
});

test('returning to a Task with an unfinished action still prevents duplicate submission',async({page})=>{
  await open(page);
  let release!:()=>void;const gate=new Promise<void>(r=>release=r);
  await page.route('**/tasks/*/requeue',async route=>{await gate;await route.fulfill({status:503,json:{error:{message:'Simulated failure'}}});});
  await page.locator('.drawer').getByRole('button',{name:'Requeue',exact:true}).click();
  await page.locator('tbody').getByText('evaluate-checkpoint',{exact:true}).click();
  await expect(page.locator('.drawer h2')).toHaveText('evaluate-checkpoint');
  await expect(page.locator('.drawer').getByRole('button',{name:'Requeue',exact:true})).toBeEnabled();
  await page.locator('tbody').getByText('generate-rollouts',{exact:true}).click();
  try {
    await expect(page.locator('.drawer h2')).toHaveText('generate-rollouts');
    await expect(page.locator('.drawer').getByRole('button',{name:'Requeue',exact:true})).toBeDisabled();
  }finally{release();}
  await expect(page.locator('.drawer').getByRole('button',{name:'Requeue',exact:true})).toBeEnabled();
});

test('Worker Task links switch the drawer without losing browser history', async ({page}) => {
  await page.setViewportSize({width:2400,height:900});
  await page.route('**/workers?*', route => route.fulfill({json:{items:[
    {id:'worker-a',queue:'robotwin',route:'gpu-a100',status:'busy',task_id:'t_ABCDEFGHIJKL',last_seen_at:new Date().toISOString(),expires_at:new Date(Date.now()+300000).toISOString()},
    {id:'worker-b',queue:'robotwin',route:'gpu-a100',status:'busy',task_id:'t_MNOPQRSTUVWX',last_seen_at:new Date().toISOString(),expires_at:new Date(Date.now()+300000).toISOString()},
  ],next_cursor:null}}));
  await open(page);
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await expect(page.locator('.drawer')).toHaveCount(0);
  await page.getByRole('button',{name:'Workers',exact:true}).click();
  await page.locator('.worker-table').getByRole('button',{name:'t_ABCDEFGHIJKL',exact:true}).click();
  await expect(page.locator('.drawer h2')).toHaveText('evaluate-checkpoint');
  await page.locator('.worker-table').getByRole('button',{name:'t_MNOPQRSTUVWX',exact:true}).click();
  await expect(page.locator('.drawer h2')).toHaveText('generate-rollouts');
  await expect(page).toHaveURL(/task=t_MNOPQRSTUVWX/);
  await page.goBack();
  await expect(page.locator('.drawer')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Workers',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.worker-table').getByRole('button',{name:'t_MNOPQRSTUVWX',exact:true})).toBeFocused();
});

test('workspace navigation from an open drawer keeps the requested tab', async ({page}) => {
  await open(page);
  await page.getByRole('button',{name:'Workers',exact:true}).click();
  await expect(page.locator('.drawer')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Workers',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page).toHaveURL(/tab=workers/);
  await page.reload();
  await expect(page.getByRole('button',{name:'Workers',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('filtering from an open drawer preserves the requested filter', async ({page}) => {
  await open(page);
  await page.locator('.stats .pending').click();
  await expect(page.locator('.drawer')).toHaveCount(0);
  await expect(page.locator('.stats .pending')).toHaveAttribute('aria-pressed','true');
  await expect(page).toHaveURL(/status=pending/);
  await expect(page).not.toHaveURL(/task=/);
  await page.reload();
  await expect(page.locator('.stats .pending')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.drawer')).toHaveCount(0);
  await page.goBack();
  await expect(page.locator('.stats .all')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.drawer h2')).toHaveText('generate-rollouts');
  await expect(page).toHaveURL(/task=t_MNOPQRSTUVWX/);
  await page.goForward();
  await expect(page.locator('.stats .pending')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.drawer')).toHaveCount(0);
});

test('outside drawer dismissal keeps focus in the clicked text filter', async ({page}) => {
  await open(page);
  const input = page.getByLabel('Task name',{exact:true});
  await input.click();
  await expect(page.locator('.drawer')).toHaveCount(0);
  await expect(input).toBeFocused();
  await input.fill('evaluate');
  await input.press('Enter');
  await expect(page).toHaveURL(/name=evaluate/);
  await expect(page).not.toHaveURL(/task=/);
});

test('dismissing an observation notification preserves the open Task drawer', async ({page}) => {
  for (const path of ['**/task-groups?*','**/worker-groups']) {
    await page.route(path, route => route.fulfill({status:501,json:{error:{message:'Unsupported',code:'unsupported'}}}));
  }
  await open(page);
  await page.locator('.observation-notice').getByRole('button',{name:'Dismiss notification'}).click();
  await expect(page.locator('.drawer')).toBeVisible();
  await expect(page).toHaveURL(/task=t_MNOPQRSTUVWX/);
});

test('Escape on an observation notification dismisses only the notification', async ({page}) => {
  for (const path of ['**/task-groups?*','**/worker-groups']) {
    await page.route(path, route => route.fulfill({status:501,json:{error:{message:'Unsupported',code:'unsupported'}}}));
  }
  await open(page);
  const notice = page.locator('.observation-notice');
  await notice.getByRole('button',{name:'Dismiss notification'}).focus();
  await page.keyboard.press('Escape');
  await expect(notice).toHaveCount(0);
  await expect(page.locator('.drawer')).toBeVisible();
  await expect(page).toHaveURL(/task=t_MNOPQRSTUVWX/);
  await page.locator('.drawer').getByRole('button',{name:'Close',exact:true}).focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.drawer')).toHaveCount(0);
});
