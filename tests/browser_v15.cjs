// End-to-end checks against a disposable shop; no production changes.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),output=path.join(root,'data/qa/v1.5');fs.mkdirSync(output,{recursive:true});
const checks=[];const pass=name=>{checks.push({name,result:'PASS'});console.log('PASS '+name);};
async function main(){
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'burger-v15-')),password=randomUUID(),base=`http://127.0.0.1:${port}`;
 const server=spawn(process.env.PYTHON||'python',['app.py','--port',String(port),'--data-dir',directory],{cwd:root,env:{...process.env,PAYMENT_MODE:'demo',KIOSK_ADMIN_PASSWORD:password},windowsHide:true,stdio:'ignore'});
 let browser;
 try{
  for(let i=0;i<80;i++){try{if((await fetch(base+'/api/menu')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const admin=await browser.newPage({viewport:{width:1280,height:1000}}),customer=await browser.newPage({viewport:{width:390,height:1000}}),errors=[];
  for(const page of [admin,customer]){page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));}
  const api=async(page,url,data)=>{const r=data===undefined?await page.request.get(base+url):await page.request.post(base+url,{data});const body=await r.json();assert.equal(r.status(),200,JSON.stringify(body));return body;};
  await admin.goto(base+'/admin');await admin.locator('[name=password]').fill(password);await admin.locator('#login button').click();await admin.locator('#order-rows').waitFor();
  const menu=(await api(admin,'/api/admin/menu')).menu;
  for(const m of menu){const file=m.id===1?'classic-burger.jpg':m.id===2?'chicken-burger.jpg':m.category==='side'?'fries.jpg':'soda.jpg';await api(admin,'/api/admin/menu/'+m.id,{...m,is_sold_out:Boolean(m.is_sold_out),photo:fs.readFileSync(path.join(root,'assets/menu/published',file)).toString('base64')});}
  const before=(await api(admin,'/api/admin/menu')).menu;
  await customer.goto(base);await customer.locator('[data-dining=TAKEOUT]').waitFor();assert.equal(await customer.locator('.menu-card').count(),0);assert.equal(await customer.locator('#steps').isHidden(),true);
  await customer.screenshot({path:path.join(output,'welcome-default-mobile.png'),fullPage:true});
  await customer.locator('[data-dining=TAKEOUT]').click();await customer.locator('.menu-card').first().waitFor();assert.match(await customer.locator('.dining-toolbar').textContent(),/포장/);await customer.reload();await customer.locator('.menu-card').first().waitFor();assert.match(await customer.locator('.dining-toolbar').textContent(),/포장/);
  const add=async()=>{await customer.locator('.menu-card[data-id="1"]').click();await customer.locator('#option-form [type=submit]').click();};
  await add();await customer.locator('[data-action=change-dining]').click();await customer.locator('[data-dining=DINE_IN]').click();assert.equal(await customer.locator('.counter').textContent(),'1');
  await customer.locator('[data-action=cart]').click();await customer.locator('[data-action=review]').click();assert.match(await customer.locator('.dining-summary').textContent(),/매장/);await customer.locator('[data-action=pay]').click();await customer.getByRole('heading',{name:'주문이 접수되었습니다'}).waitFor();assert.match(await customer.locator('.pickup').textContent(),/매장/);
  const first=await customer.evaluate(()=>JSON.parse(sessionStorage.getItem('burger-kiosk-session-v1')).orderId);
  await admin.locator('[data-act=refresh]').click();await admin.locator(`[data-order-id="${first}"]`).waitFor();assert.equal(await admin.locator(`[data-order-id="${first}"] .dining-tag`).textContent(),'매장');
  await customer.locator('[data-action=reset]').click();await customer.locator('[data-dining=TAKEOUT]').waitFor();assert.equal(await customer.evaluate(()=>JSON.parse(sessionStorage.getItem('burger-kiosk-session-v1')).diningType),null);
  pass('V15-DINE-01: first-screen choice required, survives reload, changes without losing cart, reaches receipt and kitchen, resets for next customer');
  await customer.locator('[data-dining=TAKEOUT]').click();await add();await customer.locator('[data-action=review]').click();await customer.locator('[data-action=pay]').click();await customer.getByRole('heading',{name:'주문이 접수되었습니다'}).waitFor();const second=await customer.evaluate(()=>JSON.parse(sessionStorage.getItem('burger-kiosk-session-v1')).orderId);
  await admin.locator('[data-act=refresh]').click();await admin.locator(`[data-order-id="${second}"]`).waitFor();assert.equal(await admin.locator(`[data-order-id="${second}"] .dining-tag`).textContent(),'포장');
  await admin.locator(`[data-detail="${second}"]`).click();assert.match(await admin.locator('#order-detail .dining-summary').textContent(),/포장/);await admin.screenshot({path:path.join(output,'dining-orders-desktop.png'),fullPage:true});
  await customer.locator('[data-action=reset]').click();await customer.locator('[data-dining=TAKEOUT]').waitFor();
  pass('V15-DINE-02: independent eat-in and takeout orders retain their own choice in list and details');
  const register=async(title,file)=>{await admin.locator('[data-new-ad]').click();await admin.locator('[name=ad-title]').fill(title);await admin.locator('[name=ad-description]').fill('통통한 새우와 바삭한 식감, 오늘의 새로운 한 끼');await admin.locator('[name=ad-photo]').setInputFiles(path.join(root,'assets/menu/published',file));await admin.getByText('1440 × 810px · 미리보기와 같은 사진이 저장됩니다.',{exact:true}).waitFor();
    const preview=await admin.locator('#ad-preview').getAttribute('src');assert.deepEqual(await admin.locator('#ad-preview').evaluate(async i=>{await i.decode();return [i.naturalWidth,i.naturalHeight];}),[1440,810]);
    await admin.locator('#ad-editor [type=submit]').click();await admin.locator('.ad-card').first().waitFor();return preview.split(',')[1];};
  await admin.locator('[data-tab=ads]').click();const preview=await register('바삭함이 남다른 새우버거','shrimp-burger.jpg');
  const one=(await api(admin,'/api/admin/ads')).items[0];const image=await admin.request.get(base+'/api/ad-photos/'+one.photo_key);assert.equal((await image.body()).toString('base64'),preview);
  await customer.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await customer.getByRole('heading',{name:one.title}).waitFor();await customer.locator('#welcome-ad img').evaluate(i=>i.decode());
  for(const width of [320,390,768,1280]){await customer.setViewportSize({width,height:1000});assert.equal(await customer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await customer.screenshot({path:path.join(output,`welcome-ad-${width}.png`),fullPage:true});}
  await admin.screenshot({path:path.join(output,'ads-admin-desktop.png'),fullPage:true});await admin.setViewportSize({width:390,height:1000});assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await admin.screenshot({path:path.join(output,'ads-admin-mobile.png'),fullPage:true});await admin.setViewportSize({width:1280,height:1000});
  pass('V15-ADS-01: image upload converts to 1440x810, saved bytes match preview, ad reaches customer, layouts fit four widths');
  await admin.locator(`[data-edit-ad="${one.id}"]`).click();await admin.locator('[name=ad-title]').fill('새우버거 <신제품>');await admin.locator('[name=ad-description]').fill('직접 수정한 소개');await admin.locator('#ad-editor [type=submit]').click();await admin.locator('.ad-card').first().waitFor();assert.equal((await api(admin,'/api/admin/ads')).items[0].photo_key,one.photo_key);
  await register('함께 즐기는 클래식버거','classic-burger.jpg');await customer.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await customer.locator('[data-action=ad-next]').waitFor();await customer.locator('[data-action=ad-next]').click();await customer.getByRole('heading',{name:'함께 즐기는 클래식버거'}).waitFor();await customer.locator('[data-action=ad-prev]').click();await customer.getByRole('heading',{name:'새우버거 <신제품>',exact:true}).waitFor();
  await customer.locator('[data-action=ad-pause]').click();assert.equal(await customer.locator('[data-action=ad-pause]').getAttribute('aria-pressed'),'true');
  await admin.locator('[data-move-ad="1"][data-direction="-1"]').click();await admin.locator('.ad-card').first().getByRole('heading',{name:'함께 즐기는 클래식버거'}).waitFor();await customer.reload();await customer.getByRole('heading',{name:'함께 즐기는 클래식버거'}).waitFor();
  pass('V15-ADS-02: text-only edit preserves image, special characters escaped, next/previous/pause and saved order work');
  const two=(await api(admin,'/api/admin/ads')).items;
  for(const a of two){await admin.locator(`[data-toggle-ad="${a.id}"]`).click();await admin.locator(`[data-toggle-ad="${a.id}"]`).getByText('노출하기',{exact:true}).waitFor();}
  await customer.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await customer.getByRole('heading',{name:'오늘도, 맛있는 한 끼'}).waitFor();assert.equal(await customer.locator('[data-dining]').count(),2);
  admin.once('dialog',d=>d.dismiss());await admin.locator(`[data-delete-ad="${one.id}"]`).click();assert.equal((await api(admin,'/api/admin/ads')).items.length,2);
  for(const a of two){admin.once('dialog',d=>d.accept());await admin.locator(`[data-delete-ad="${a.id}"]`).click();await admin.locator(`[data-delete-ad="${a.id}"]`).waitFor({state:'detached'});}
  assert.deepEqual((await api(admin,'/api/admin/menu')).menu,before);assert.equal((await api(admin,'/api/admin/orders')).orders.length,2);
  pass('V15-ADS-03: hiding all falls back gracefully; delete confirmation works; deleting ads preserves menus/photos/orders');
  await customer.route('**/api/ads',r=>r.abort());await customer.reload();await customer.locator('[data-dining=DINE_IN]').click();await customer.locator('.menu-card').first().waitFor();await customer.unroute('**/api/ads');
  await customer.evaluate(()=>sessionStorage.setItem('burger-kiosk-session-v1',JSON.stringify({page:'cart',cart:[{id:1,name:'클래식버거',options:[],selections:[],label:'',quantity:1,unit:5500,version:0}]})));await customer.reload();await customer.locator('[data-dining=TAKEOUT]').click();assert.equal(await customer.locator('.counter').textContent(),'1');
  pass('V15-COMPAT-01: failed ad service cannot block ordering; pre-v1.5 basket survives the new choice screen');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({date:'2026-11-25',checks,errors},null,2));
 }finally{if(browser)await browser.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
