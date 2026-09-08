import {expect,test,type Page} from '@playwright/test';
async function open(page:Page){
  await page.request.post('http://127.0.0.1:18765/__test__/reset');
  await page.goto('/');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:18765');
  await page.getByRole('button',{name:'Connect',exact:true}).click();
  await page.getByRole('heading',{name:'robotwin',exact:true}).click();
  await page.getByText('generate-rollouts',{exact:true}).click();
}
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
