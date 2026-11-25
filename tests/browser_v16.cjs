// Disposable local shop: exercise real UI/API without production writes.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),output=path.join(root,'data/qa/v1.6');fs.mkdirSync(output,{recursive:true});
const checks=[],pass=name=>{checks.push({name,result:'PASS'});console.log('PASS '+name);};
async function main(){
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'burger-v16-')),password=randomUUID(),base=`http://127.0.0.1:${port}`;
 const server=spawn(process.env.PYTHON||'python',['app.py','--port',String(port),'--data-dir',directory],{cwd:root,env:{...process.env,PAYMENT_MODE:'demo',KIOSK_ADMIN_PASSWORD:password},windowsHide:true,stdio:'ignore'});
 let browser;
 try{
  for(let i=0;i<80;i++){try{if((await fetch(base+'/api/menu')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const admin=await browser.newPage({viewport:{width:1280,height:1000}}),customer=await browser.newPage({viewport:{width:390,height:1000}}),errors=[];
  for(const page of [admin,customer]){page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));}
  const api=async(page,url,data)=>{const r=data===undefined?await page.request.get(base+url):await page.request.post(base+url,{data});const body=await r.json();assert.equal(r.status(),200,JSON.stringify(body));return body;};
  const stock=async()=> (await api(admin,'/api/admin/inventory')).items.find(i=>i.id===1);
  const seedOrder=async(mid=1,quantity=1)=>{const order=await api(customer,'/api/orders',{key:randomUUID(),dining_type:'TAKEOUT',items:[{menu_id:mid,quantity,options:[],expected_unit:mid===1?5500:6000}]});await api(customer,`/api/orders/${order.id}/attempts`,{key:randomUUID(),demo_result:'success'});return order;};
  await admin.goto(base+'/admin');await admin.locator('[name=password]').fill(password);await admin.locator('#login button').click();await admin.locator('#order-rows').waitFor();
  const menu=(await api(admin,'/api/admin/menu')).menu;
  for(const m of menu){const file=m.id===1?'classic-burger.jpg':m.id===2?'chicken-burger.jpg':m.category==='side'?'fries.jpg':'soda.jpg';await api(admin,'/api/admin/menu/'+m.id,{...m,is_sold_out:Boolean(m.is_sold_out),photo:fs.readFileSync(path.join(root,'assets/menu/published',file)).toString('base64')});}
  const photos=(await api(admin,'/api/admin/menu')).menu.map(m=>m.photo_key);
  await admin.locator('[data-tab=sales]').click();await admin.getByRole('heading',{name:'매출 분석',exact:true}).waitFor();assert.equal(await admin.locator('.metric-main strong').textContent(),'0원');
  await admin.locator('[data-tab=inventory]').click();await admin.locator('.inventory-row').first().waitFor();assert.ok((await api(admin,'/api/admin/inventory')).items.every(i=>i.enabled===0));
  await admin.locator('[data-inventory-edit="1"]').click();await admin.locator('[name=enabled]').check();await admin.locator('[name=quantity]').fill('1');await admin.locator('[name=low_threshold]').fill('2');await admin.locator('#inventory-editor [name=reason]').fill('오전 준비');await admin.locator('#inventory-editor .primary').click();await admin.locator('.inventory-row').first().waitFor();assert.equal((await stock()).quantity,1);
  pass('V16-UI-01: empty sales, untracked defaults, stock enrollment and shortage indicator');
  await customer.goto(base);await customer.locator('[data-dining=DINE_IN]').click();await customer.locator('.menu-card[data-id="1"]').click();await customer.locator('#option-form [type=submit]').click();await customer.locator('[data-action=review]').click();await customer.locator('[data-action=pay]').click();await customer.getByRole('heading',{name:'주문이 접수되었습니다'}).waitFor();
  const first=await customer.evaluate(()=>JSON.parse(sessionStorage.getItem('burger-kiosk-session-v1')).orderId);
  assert.equal((await stock()).quantity,0);await customer.locator('[data-action=reset]').click();await customer.locator('[data-dining=TAKEOUT]').click();await customer.locator('.menu-card[data-id="1"]').waitFor();assert.equal(await customer.locator('.menu-card[data-id="1"]').isDisabled(),true);
  await admin.locator('[data-inventory-refresh]').click();await admin.locator('.stock-label').getByText('자동 품절',{exact:true}).waitFor();
  await admin.locator('[data-tab=sales]').click();await admin.locator('[data-sales-days="1"]').click();await admin.getByText('5,500원',{exact:true}).first().waitFor();assert.equal(await admin.locator('.metric-main strong').textContent(),'5,500원');assert.match(await admin.locator('.ranking tbody').textContent(),/클래식버거/);
  pass('V16-UI-02: customer checkout consumes last unit, fades and disables sold-out card, updates sales');
  await admin.locator('[data-tab=orders]').click();await admin.locator(`[data-cancel-order="${first}"]`).click();assert.equal(await admin.locator('[name=restock]').isChecked(),true);await admin.locator('[name=reason]').fill('고객 요청');await admin.locator('#admin-cancel-form [type=submit]').click();await admin.locator('#admin-cancel-dialog').waitFor({state:'hidden'});assert.equal((await stock()).quantity,1);
  await customer.reload();await customer.locator('.menu-card[data-id="1"]').waitFor();assert.equal(await customer.locator('.menu-card[data-id="1"]').isDisabled(),false);
  await admin.locator('[data-tab=sales]').click();await admin.locator('.metric-main strong').waitFor();assert.equal(await admin.locator('.metric-main strong').textContent(),'0원');
  pass('V16-UI-03: pre-cooking cancel defaults to restock, reopens menu and nets sales to zero');
  const cooked=await seedOrder();await admin.locator('[data-tab=orders]').click();await admin.locator(`[data-next="${cooked.id}"]`).click();await admin.locator(`[data-order-id="${cooked.id}"] .status`).getByText('조리중',{exact:true}).waitFor();await admin.locator(`[data-cancel-order="${cooked.id}"]`).click();assert.equal(await admin.locator('[name=restock]').isChecked(),false);await admin.locator('[name=reason]').fill('조리 후 폐기');await admin.locator('#admin-cancel-form [type=submit]').click();await admin.locator('#admin-cancel-dialog').waitFor({state:'hidden'});assert.equal((await stock()).quantity,0);
  pass('V16-UI-04: cooking cancellation defaults to no stock return');
  let current=await stock();await api(admin,'/api/admin/inventory/1',{...current,enabled:true,quantity:3,reason:'추가 준비'});
  await admin.locator('[data-tab=inventory]').click();await admin.locator('[data-inventory-edit="1"]').click();await admin.locator('[name=quantity]').fill('100');await admin.locator('#inventory-editor [name=reason]').fill('오래된 화면 조정');await seedOrder();await admin.locator('#inventory-editor .primary').click();await admin.locator('#notice').getByText(/재고가 바뀌었습니다/).waitFor();assert.equal((await stock()).quantity,2);assert.equal(await admin.locator('#inventory-editor').count(),0);
  pass('V16-UI-05: intervening sale prevents stale form from overwriting stock');
  await seedOrder(2,2);await admin.locator('[data-tab=sales]').click();await admin.locator('.ranking').waitFor();assert.equal(await admin.locator('.metric-main strong').textContent(),'17,500원');assert.match(await admin.locator('.ranking tbody tr').first().textContent(),/클래식버거/);
  for(const width of [320,390,768,1280]){await admin.setViewportSize({width,height:1000});assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`sales overflow ${width}`);await admin.screenshot({path:path.join(output,`sales-${width}.png`),fullPage:true});}
  await admin.locator('[data-tab=inventory]').click();await admin.locator('.inventory-row').first().waitFor();
  for(const width of [320,390,768,1280]){await admin.setViewportSize({width,height:1000});assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`inventory overflow ${width}`);await admin.screenshot({path:path.join(output,`inventory-${width}.png`),fullPage:true});}
  assert.deepEqual((await api(admin,'/api/admin/menu')).menu.map(m=>m.photo_key),photos);
  assert.deepEqual(errors,[]);pass('V16-UI-06: totals, menu ranking, four responsive widths, preserved photos and no browser errors');
  fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify({date:new Date().toISOString(),checks,errors},null,2));
 }finally{if(browser)await browser.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
