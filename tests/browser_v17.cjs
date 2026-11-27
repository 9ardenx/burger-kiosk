// Isolated shop only; optionally prepare authorized publication copies with --prepare-photos.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{randomUUID,createHash}=require('node:crypto');
async function main(){
 const root=path.resolve(__dirname,'..'),out=path.join(root,'data/qa/v1.7');fs.mkdirSync(out,{recursive:true});
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'kiosk-v17-')),password=randomUUID(),base=`http://127.0.0.1:${port}`;
 const server=spawn('python',['app.py','--port',String(port),'--data-dir',folder],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,PAYMENT_MODE:'demo',KIOSK_ADMIN_PASSWORD:password}});
 let browser;const checks=[],pass=name=>{checks.push(name);console.log('PASS '+name);};
 try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/menu')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const admin=await browser.newPage({viewport:{width:1280,height:1000}}),customer=await browser.newPage({viewport:{width:390,height:1000}}),errors=[];
  for(const p of [admin,customer]){p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));}
  const api=async(p,url,data)=>{const r=data===undefined?await p.request.get(base+url):await p.request.post(base+url,{data});const b=await r.json();assert.equal(r.status(),200,JSON.stringify(b));return b;};
  await admin.goto(base+'/admin#promotions');await admin.locator('[name=password]').fill(password);await admin.locator('#login button').click();await admin.getByRole('heading',{name:'할인 관리',exact:true}).waitFor();
  await admin.locator('[data-new-promotion]').click();await admin.locator('[name=title]').fill('매일 시간 할인');await admin.locator('[name=start_time]').fill('00:00');await admin.locator('[name=end_time]').fill('24:00');await admin.locator('[name=value]').fill('20');await admin.locator('[name=menu_ids][value="1"]').check();assert.match(await admin.locator('.promotion-preview').textContent(),/4,400원/);
  await admin.locator('#promotion-editor [type=submit]').click();await admin.locator('.promotion-row').waitFor();assert.match(await admin.locator('.promotion-row').textContent(),/할인 중/);pass('V17-UI-01 percentage schedule created, preview and status');
  await customer.goto(base);await customer.locator('[data-dining=DINE_IN]').click();const card=customer.locator('.menu-card[data-id="1"]');await card.locator('del').waitFor();assert.equal(await card.locator('.sale-price b').textContent(),'4,400원');await card.locator('[data-discount-end]').getByText(/남음/).waitFor();
  await card.click();assert.equal(await customer.locator('#options .sale-price del').textContent(),'5,500원');await customer.locator('#option-form [type=checkbox][value="1"]').check();assert.equal(await customer.locator('#option-price').textContent(),'4,900원');await customer.locator('#option-form [type=submit]').click();await customer.locator('[data-action=review]').click();await customer.locator('[data-action=pay]').click();await customer.getByRole('heading',{name:'주문이 접수되었습니다'}).waitFor();assert.match(await customer.locator('.receipt-line').first().textContent(),/시간 할인 적용/);pass('V17-UI-02 customer original/sale prices, countdown, full-price option and receipt');
  await admin.locator('[data-edit-promotion]').click();await admin.locator('[name=mode]').selectOption('FIXED');await admin.locator('[name=value]').fill('3900');await admin.locator('#promotion-editor [type=submit]').click();await admin.locator('.promotion-row').waitFor();assert.equal((await api(customer,'/api/menu')).menu[0].base_price,3900);
  await customer.locator('[data-action=reset]').click();await customer.locator('[data-dining=TAKEOUT]').click();await card.click();await customer.locator('#option-form [type=submit]').click();await customer.locator('[data-action=review]').click();await admin.locator('[data-toggle-promotion]').click();await admin.getByText('사용 안 함',{exact:true}).waitFor();await customer.locator('[data-action=pay]').click();await customer.locator('#notice').getByText(/가격이 변경/).waitFor();assert.equal((await api(customer,'/api/menu')).menu[0].base_price,5500);pass('V17-UI-03 fixed sale price and stale checkout require customer review');
  await admin.locator('[data-edit-promotion]').click();await admin.locator('[name=title]').fill('충돌 검증');let p=await api(admin,'/api/admin/promotions');await api(admin,'/api/admin/promotions',{items:p.items,revision:p.revision});await admin.locator('#promotion-editor [type=submit]').click();await admin.locator('#notice').getByText(/할인이 변경/).waitFor();assert.equal(await admin.locator('#promotion-editor').count(),0);pass('V17-UI-04 concurrent edit preserves newer campaign');
  for(const width of [320,390,768,1280]){await admin.setViewportSize({width,height:1000});assert.ok(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await admin.screenshot({path:path.join(out,`promotions-${width}.png`),fullPage:true});}
  await admin.locator('[data-edit-promotion]').click();for(const width of [320,390,768,1280]){await admin.setViewportSize({width,height:1000});assert.ok(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`editor ${width}`);await admin.screenshot({path:path.join(out,`promotion-editor-${width}.png`),fullPage:true});}
  admin.on('dialog',d=>d.accept());await admin.locator('[data-back-promotions]').click();await admin.locator('[data-delete-promotion]').click();await admin.getByText('등록된 할인이 없습니다.',{exact:false}).waitFor();pass('V17-UI-05 mobile/desktop list/editor and delete');
  if(process.argv.includes('--prepare-photos')){
   const names={'모닝버거세트':'morning-burger-set','새우또띠아':'shrimp-tortilla','치킨또띠아':'chicken-tortilla','치즈스틱':'cheese-sticks','아이스크림':'ice-cream','머스타드소스':'mustard-sauce','살사소스':'salsa-sauce','케첩소스':'ketchup-sauce','신메뉴사진':'new-products'};const records=[];
   for(const [name,slug] of Object.entries(names)){
    const input=fs.readFileSync(path.join(root,'data/backups/사진백업',name+'.png')),ad=name==='신메뉴사진',width=ad?1440:720,height=ad?810:465;
    const b64=await admin.evaluate(async({b64,width,height})=>{const {jpegForUpload}=await import('/assets/menu-photo.js?v=20261127-v17');return jpegForUpload(new File([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))],'source.png',{type:'image/png'}),{width,height});},{b64:input.toString('base64'),width,height});
    const bytes=Buffer.from(b64,'base64'),dest=path.join(root,'assets',ad?'ads':'menu','published',slug+'.jpg');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);
    records.push({name,file:path.relative(root,dest).replaceAll('\\','/'),width,height,bytes:bytes.length,source_sha256:createHash('sha256').update(input).digest('hex'),sha256:createHash('sha256').update(bytes).digest('hex')});
   }
   fs.writeFileSync(path.join(root,'assets/menu/published/v1.7-photos.json'),JSON.stringify({method:'Existing app uploader: aspect-preserving center crop and JPEG encoding; untouched originals retained in the local photo backup.',photos:records},null,2));pass('V17-PHOTO-01 eight 720x465 menu JPEGs and one 1440x810 ad prepared');
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({date:new Date().toISOString(),checks,errors},null,2));
 }finally{if(browser)await browser.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
