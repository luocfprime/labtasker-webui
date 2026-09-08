import {expect,test,type Page} from '@playwright/test';
const operation={id:'test-operation',queue:'robotwin',total:1,completed:0,done:false,stopped:false,counts:{deleted:0,absent:0,failed:0,stopped:0},outcomes:[]};
async function open(page:Page){
  await page.request.post('http://127.0.0.1:18765/__test__/reset');
  await page.goto('/');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:18765');
  await page.getByRole('button',{name:'Connect',exact:true}).click();
  await page.getByRole('heading',{name:'robotwin',exact:true}).click();
  await page.locator('tbody input[type=checkbox]').first().check();
  await page.getByRole('button',{name:'Delete selected',exact:true}).click();
}
test('batch submission prevents duplicate requests while awaiting the operation',async({page})=>{
  await open(page);
  let starts=0;let release!:()=>void;
  const gate=new Promise<void>(r=>release=r);
  await page.route('**/queues/robotwin/delete-operations',async route=>{starts++;await gate;await route.fulfill({status:202,json:{...operation,done:true}});});
  await page.route('**/delete-operations/test-operation',route=>route.fulfill({json:{...operation,done:true}}));
  const button=page.getByRole('button',{name:'Delete permanently',exact:true});
  await button.click();
  try {await expect(button).toBeDisabled();await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeDisabled();expect(starts).toBe(1);}finally{release();}
  await expect(page.getByRole('button',{name:'Done',exact:true})).toBeEnabled();
});
test('batch monitoring and stop failures expose recovery without resubmitting deletion',async({page})=>{
  await open(page);
  let starts=0;let fail=true;
  await page.route('**/queues/robotwin/delete-operations',route=>{starts++;return route.fulfill({status:202,json:operation});});
  await page.route('**/delete-operations/test-operation',route=>route.fulfill(fail?{status:503,json:{error:{message:'Status temporarily unavailable'}}}:{json:operation}));
  await page.route('**/delete-operations/test-operation/stop',route=>route.fulfill({status:503,json:{error:{message:'Stop temporarily unavailable'}}}));
  await page.getByRole('button',{name:'Delete permanently',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Status temporarily unavailable');
  await expect(page.getByRole('button',{name:'Close',exact:true})).toBeEnabled();
  fail=false;
  await page.getByRole('button',{name:'Retry status',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toContainText('Status temporarily unavailable');
  await page.getByRole('button',{name:'Stop remaining',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Stop temporarily unavailable');
  expect(starts).toBe(1);
  fail=true;
  await expect(page.getByRole('button',{name:'Close',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
