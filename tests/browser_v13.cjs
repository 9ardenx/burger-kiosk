// Real customer/admin browser flows against a disposable local demo store only.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),output=path.join(root,'data/qa/v1.3');fs.mkdirSync(output,{recursive:true});
const checks=[];const pass=name=>{checks.push({name,result:'PASS'});console.log('PASS '+name);};
async function main(){
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'burger-v13-')),password=randomUUID(),base=`http://127.0.0.1:${port}`;
 const server=spawn(process.env.PYTHON||'python',['app.py','--port',String(port),'--data-dir',directory],{cwd:root,env:{...process.env,PAYMENT_MODE:'demo',KIOSK_ADMIN_PASSWORD:password},windowsHide:true,stdio:'ignore'});
 let browser;
 try {
  for(let i=0;i<80;i++){try{if((await fetch(base+'/api/menu')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const admin=await browser.newPage({viewport:{width:1280,height:1000}}),customer=await browser.newPage({viewport:{width:390,height:1000}}),errors=[];
  for(const page of [admin,customer])page.on('pageerror',e=>errors.push(e.message));
  const api=async(page,url,data)=>{const r=data===undefined?await page.request.get(base+url):await page.request.post(base+url,{data});const body=await r.json();assert.equal(r.status(),200,JSON.stringify(body));return body;};
  await admin.goto(base+'/admin');await admin.locator('[name=password]').fill(password);await admin.locator('#login button').click();await admin.locator('#order-rows').waitFor();
  const initial=(await api(admin,'/api/admin/menu')).menu,fries=initial.find(m=>m.category==='side');
  await api(admin,'/api/admin/menu/'+fries.id,{...fries,is_sold_out:false,photo:fs.readFileSync(path.join(root,'assets/menu/published/fries.jpg')).toString('base64')});
  await admin.locator('[data-tab=menu]').click();await admin.locator(`[data-toggle-stock="${fries.id}"]`).waitFor();
  const before=(await api(admin,'/api/admin/menu')).menu;
  await customer.goto(base);await customer.locator('[data-dining=DINE_IN]').click();await customer.locator(`.menu-card[data-id="${fries.id}"]`).click();await customer.locator('#option-form [type=submit]').click();
  await admin.locator(`[data-toggle-stock="${fries.id}"]`).click();await admin.getByRole('button',{name:'감자튀김 판매 재개',exact:true}).waitFor();
  const sold=(await api(admin,'/api/admin/menu')).menu;
  assert.deepEqual(sold.map(m=>m.id),before.map(m=>m.id));
  for(let i=0;i<before.length;i++){const {is_sold_out,version,...a}=before[i],{is_sold_out:s,version:v,...b}=sold[i];assert.deepEqual(b,a);}
  await customer.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await customer.locator('[data-action=review]:disabled').waitFor();assert.match(await customer.locator('.cart-row').textContent(),/품절/);
  await customer.locator('[data-action=menu]').click();const card=customer.locator(`.menu-card[data-id="${fries.id}"]`);await card.locator('.stock-badge').waitFor();
  assert.equal(await card.isDisabled(),true);await card.evaluate(c=>c.click());assert.equal(await customer.locator('#options').evaluate(d=>d.open),false);
  await customer.locator('[data-category=side]').click();await customer.waitForTimeout(350);
  assert.equal(await card.locator('img').evaluate(i=>getComputedStyle(i).opacity),'0.32');
  await customer.screenshot({path:path.join(output,'sold-out-mobile.png'),fullPage:true});await admin.screenshot({path:path.join(output,'menu-stock-desktop.png'),fullPage:true});
  await admin.setViewportSize({width:390,height:1000});assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await admin.screenshot({path:path.join(output,'menu-stock-mobile.png'),fullPage:true});await admin.setViewportSize({width:1280,height:1000});
  pass('V13-STOCK-01: direct list button preserves photo/price/options/order; faded sold-out card remains visible and cannot be selected or checked out');
  await admin.locator(`[data-toggle-stock="${fries.id}"]`).click();await admin.getByRole('button',{name:'감자튀김 품절 처리',exact:true}).waitFor();
  await customer.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await card.locator('.stock-badge').waitFor({state:'detached'});assert.equal(await card.isEnabled(),true);
  pass('V13-STOCK-02: sale resumes in the same category and position');
  const paid=async()=>{const m=(await api(customer,'/api/menu')).menu.find(m=>m.id===1),o=await api(customer,'/api/orders',{key:randomUUID(),items:[{menu_id:1,quantity:1,options:[],expected_unit:m.base_price,expected_version:m.version}]});return api(customer,'/api/orders/'+o.id+'/attempts',{key:randomUUID(),demo_result:'success'});};
  const a=await paid(),b=await paid();
  await customer.evaluate(o=>{const state=JSON.parse(sessionStorage.getItem('burger-kiosk-session-v1'));Object.assign(state,{orderId:o.id,page:'done'});sessionStorage.setItem('burger-kiosk-session-v1',JSON.stringify(state));},a);await customer.reload();await customer.getByRole('heading',{name:'주문이 접수되었습니다'}).waitFor();
  await admin.locator('[data-tab=orders]').click();await admin.locator(`[data-cancel-order="${a.id}"]`).click();
  await admin.locator('#admin-cancel-form [type=submit]').click();assert.equal(await admin.locator('#admin-cancel-dialog').evaluate(d=>d.open),true);assert.equal((await api(customer,'/api/orders/'+a.id)).status,'PAID');
  const reason='재료 소진 <안내> & 고객 요청';await admin.locator('[name=reason]').fill(reason);
  let release,arrived;const gate=new Promise(r=>release=r),seen=new Promise(r=>arrived=r);
  await admin.route('**/api/admin/orders/'+a.id+'/cancel',async route=>{arrived();await gate;await route.continue();});
  await admin.locator('#admin-cancel-form [type=submit]').click();await seen;
  assert.equal(await admin.locator(`[data-next="${a.id}"]`).isDisabled(),true);assert.equal(await admin.locator(`[data-next="${b.id}"]`).isDisabled(),false);
  await admin.keyboard.press('Escape');assert.equal(await admin.locator('#admin-cancel-dialog').evaluate(d=>d.open),true);
  release();await admin.locator('#admin-cancel-dialog').waitFor({state:'hidden'});await admin.locator(`.order-grid[data-order-id="${a.id}"]`).waitFor({state:'detached'});
  assert.equal((await api(customer,'/api/orders/'+b.id)).status,'PAID');
  await admin.locator('[data-filter=cancelled]').click();await admin.locator(`[data-detail="${a.id}"]`).click();
  assert.match(await admin.locator('#order-detail').textContent(),/재료 소진 <안내> & 고객 요청/);assert.equal(await admin.locator(`[data-cancel-order="${a.id}"]`).count(),0);
  await admin.screenshot({path:path.join(output,'cancel-history.png'),fullPage:true});
  await customer.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await customer.getByRole('heading',{name:'주문이 취소되었습니다'}).waitFor();
  assert.match(await customer.locator('#app').textContent(),/재료 소진 <안내> & 고객 요청/);
  await customer.screenshot({path:path.join(output,'customer-cancelled.png'),fullPage:true});
  pass('V13-CANCEL-01: reason required; only selected order locks; cancellation history and customer result retain escaped reason');
  await admin.reload();await admin.locator('[data-filter=cancelled]').click();await admin.locator(`[data-detail="${a.id}"]`).click();assert.match(await admin.locator('#order-detail').textContent(),/재료 소진/);
  await admin.locator('[data-filter=open]').click();await admin.locator(`[data-cancel-order="${b.id}"]`).waitFor();
  await admin.setViewportSize({width:390,height:1000});assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await admin.screenshot({path:path.join(output,'order-buttons-mobile.png'),fullPage:true});
  pass('V13-CANCEL-02: history survives reload; progress and cancel buttons fit mobile width');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({date:'2026-11-25',checks,errors},null,2));
 }finally{if(browser)await browser.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
