// Full browser flows use a disposable store; never change the public shop password.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),output=path.join(root,'data/qa/v1.4');fs.mkdirSync(output,{recursive:true});
const checks=[];const pass=name=>{checks.push({name,result:'PASS'});console.log('PASS '+name);};
async function main(){
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'burger-v14-')),password=randomUUID(),newPassword=randomUUID(),resetPassword=randomUUID(),base=`http://127.0.0.1:${port}`;
 const server=spawn(process.env.PYTHON||'python',['app.py','--port',String(port),'--data-dir',directory],{cwd:root,env:{...process.env,PAYMENT_MODE:'demo',KIOSK_ADMIN_PASSWORD:password},windowsHide:true,stdio:'ignore'});
 let browser;
 try{
  for(let i=0;i<80;i++){try{if((await fetch(base+'/api/menu')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const admin=await browser.newPage({viewport:{width:1280,height:1000}}),other=await browser.newPage(),customer=await browser.newPage({viewport:{width:390,height:1000}}),errors=[];
  for(const page of [admin,other,customer]){page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));}
  const api=async(page,url,data)=>{const r=data===undefined?await page.request.get(base+url):await page.request.post(base+url,{data});const body=await r.json();assert.equal(r.status(),200,JSON.stringify(body));return body;};
  const login=async(page,value)=>{await page.goto(base+'/admin');await page.locator('[name=password]').fill(value);await page.locator('#login button').click();await page.locator('#order-rows').waitFor();};
  const saveCategories=async()=>{await admin.locator('#category-settings [type=submit]').click();await admin.getByText('분류 이름과 순서를 저장했습니다.',{exact:true}).waitFor();};
  const initial=(await api(customer,'/api/menu')).menu;
  await login(admin,password);await login(other,password);await customer.goto(base);await customer.locator('[data-dining=DINE_IN]').click();await customer.locator('[data-category=side]').waitFor();
  await admin.locator('[data-tab=categories]').click();await admin.locator('[data-category-name=side]').fill('곁들임');
  await admin.locator('[data-category-move="1"][data-direction="-1"]').click();await saveCategories();
  await customer.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await customer.getByRole('button',{name:'곁들임',exact:true}).waitFor();
  assert.deepEqual(await customer.locator('[data-category]').evaluateAll(nodes=>nodes.map(n=>n.dataset.category)),['all','side','burger','drink']);
  assert.deepEqual((await api(customer,'/api/menu')).menu,initial);
  assert.equal(await admin.locator('[data-category-id=side] [data-category-remove]').isDisabled(),true);
  pass('V14-CAT-01: rename/order reaches customer filters without changing menu/photo/price/options');
  await admin.locator('[data-category-add]').click();await admin.locator('.category-row:last-child input').fill('세트 <추천>');await saveCategories();
  const added=(await api(admin,'/api/admin/categories')).items.find(i=>i.name==='세트 <추천>');assert.ok(added);
  await admin.locator('[data-tab=menu]').click();await admin.locator('[data-edit-menu="1"]').click();await admin.locator('[name=category]').selectOption(added.id);await admin.locator('#menu-editor [type=submit]').click();await admin.locator('[data-edit-menu="1"]').waitFor();
  await customer.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await customer.getByRole('button',{name:'세트 <추천>',exact:true}).click();await customer.locator('.menu-card[data-id="1"]').waitFor();
  assert.equal(await customer.locator('.menu-card').count(),1);
  await admin.locator('[data-tab=categories]').click();assert.equal(await admin.locator(`[data-category-id="${added.id}"] [data-category-remove]`).isDisabled(),true);
  await admin.screenshot({path:path.join(output,'categories-desktop.png'),fullPage:true});
  await admin.setViewportSize({width:390,height:1000});assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await admin.screenshot({path:path.join(output,'categories-mobile.png'),fullPage:true});await admin.setViewportSize({width:1280,height:1000});
  pass('V14-CAT-02: added category appears in editor and customer; occupied deletion disabled; labels escaped; mobile fits');
  await admin.locator('[data-tab=menu]').click();await admin.locator('[data-edit-menu="1"]').click();await admin.locator('[name=category]').selectOption('burger');await admin.locator('#menu-editor [type=submit]').click();await admin.locator('[data-edit-menu="1"]').waitFor();
  await admin.locator('[data-tab=categories]').click();await admin.locator(`[data-category-id="${added.id}"] [data-category-remove]`).click();await saveCategories();
  await customer.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await customer.locator(`[data-category="${added.id}"]`).waitFor({state:'detached'});assert.equal(await customer.locator('[data-category=all]').getAttribute('aria-pressed'),'true');
  await admin.locator('[data-category-name=side]').fill('미저장 변경');admin.once('dialog',d=>d.dismiss());await admin.locator('[data-tab=menu]').click();assert.equal(await admin.locator('#category-settings').count(),1);
  await admin.locator('[data-category-discard]').click();assert.equal(await admin.locator('[data-category-name=side]').inputValue(),'곁들임');
  await other.locator('[data-tab=categories]').click();await other.locator('[data-category-name=side]').fill('오래된 변경');
  await admin.locator('[data-category-name=side]').fill('사이드');await saveCategories();await other.locator('#category-settings [type=submit]').click();await other.getByText(/분류가 변경되었거나/).waitFor();assert.equal(await other.locator('[data-category-name=side]').inputValue(),'사이드');
  pass('V14-CAT-03: empty deletion, removed-filter fallback, discard and stale-write conflict work');
  await admin.locator('[data-category-name=side]').fill('곁들임 변경');await saveCategories();
  let release,arrive;const gate=new Promise(r=>release=r),seen=new Promise(r=>arrive=r);
  await customer.route('**/api/menu',async route=>{const response=await route.fetch();arrive();await gate;await route.fulfill({response});});
  await customer.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await seen;await customer.locator('.menu-card[data-id="1"]').click();
  const delivered=customer.waitForResponse(r=>r.url().endsWith('/api/menu'));release();await delivered;await customer.waitForTimeout(200);
  await customer.locator('#options [data-action=close]').click();await customer.unroute('**/api/menu');await customer.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await customer.getByRole('button',{name:'곁들임 변경',exact:true}).waitFor();
  pass('V14-CAT-04: refresh arriving during an open popup does not lose pending category changes');
  await admin.locator('[data-tab=security]').click();await admin.locator('#password-settings').waitFor();await admin.screenshot({path:path.join(output,'security-desktop.png'),fullPage:true});
  await admin.setViewportSize({width:390,height:1000});assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await admin.screenshot({path:path.join(output,'security-mobile.png'),fullPage:true});
  const form=admin.locator('#password-settings');await form.locator('[name=current_password]').fill('incorrect');await form.locator('[name=new_password]').fill(newPassword);await form.locator('[name=confirm_password]').fill(newPassword);await form.locator('[type=submit]').click();await admin.getByText('현재 암호를 확인해 주세요.',{exact:true}).waitFor();assert.equal((await other.request.get(base+'/api/admin/menu')).status(),200);
  await form.locator('[name=current_password]').fill(password);await form.locator('[name=confirm_password]').fill('different-long-password');await form.locator('[type=submit]').click();await admin.getByText('새 암호와 확인 값이 일치하지 않습니다.',{exact:true}).waitFor();
  await form.locator('[name=confirm_password]').fill(newPassword);await form.locator('[type=submit]').click();await admin.locator('#login').waitFor();assert.equal((await other.request.get(base+'/api/admin/menu')).status(),401);
  await admin.locator('[name=password]').fill(password);await admin.locator('#login button').click();await admin.getByText('관리자 암호를 확인해 주세요.',{exact:true}).waitFor();await login(admin,newPassword);
  pass('V14-AUTH-01: wrong current/mismatch rejected; change expires other login and rejects previous password');
  await admin.locator('[data-tab=security]').click();const recovery=admin.locator('#recovery-settings');await recovery.locator('[name=current_password]').fill(newPassword);await recovery.locator('[type=submit]').click();await admin.locator('[data-recovery-value]').waitFor();
  const code=await admin.locator('[data-recovery-value]').inputValue();assert.match(code,/^[a-f0-9]{8}(?:-[a-f0-9]{8}){7}$/);
  const downloadPromise=admin.waitForEvent('download');await admin.locator('[data-save-recovery]').click();const download=await downloadPromise;assert.equal(fs.readFileSync(await download.path(),'utf8').includes(code),true);
  await admin.locator('[data-tab=orders]').click();await admin.locator('[data-tab=security]').click();assert.equal(await admin.locator('[data-recovery-value]').count(),0);assert.match(await admin.locator('#recovery-settings .info-note').textContent(),/발급되어/);
  pass('V14-AUTH-02: recovery code shown once, downloadable and not redisplayed on revisit');
  await login(other,newPassword);await admin.locator('[data-act=logout]').click();await admin.locator('[data-show-recovery]').click();const reset=admin.locator('#password-reset');
  await reset.locator('[name=recovery_code]').fill('invalid-code');await reset.locator('[name=new_password]').fill(resetPassword);await reset.locator('[name=confirm_password]').fill(resetPassword);await reset.locator('[type=submit]').click();await admin.getByText('복구 코드를 확인해 주세요.',{exact:true}).waitFor();
  await reset.locator('[name=recovery_code]').fill(code);await reset.locator('[type=submit]').click();await admin.locator('#login').waitFor();assert.equal((await other.request.get(base+'/api/admin/menu')).status(),401);
  await admin.locator('[data-show-recovery]').click();await admin.locator('[name=recovery_code]').fill(code);await admin.locator('[name=new_password]').fill(randomUUID());const repeated=await admin.locator('[name=new_password]').inputValue();await admin.locator('[name=confirm_password]').fill(repeated);await admin.locator('#password-reset [type=submit]').click();await admin.getByText('복구 코드를 확인해 주세요.',{exact:true}).waitFor();
  await login(admin,resetPassword);assert.equal((await api(admin,'/api/admin/security')).recovery_ready,false);
  pass('V14-AUTH-03: reset requires valid one-use code, revokes sessions and requires fresh login');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({date:'2026-11-25',checks,errors},null,2));
 }finally{if(browser)await browser.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
