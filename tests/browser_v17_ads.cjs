// Real UI/API on an isolated shop; virtual browser clock exercises 10-second boundaries.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
async function main(){
 const root=path.resolve(__dirname,'..'),out=path.join(root,'data/qa/v1.7.1');fs.mkdirSync(out,{recursive:true});
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'burger-ad-slides-')),password=randomUUID(),base=`http://127.0.0.1:${port}`;
 const server=spawn('python',['app.py','--port',String(port),'--data-dir',directory],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,PAYMENT_MODE:'demo',KIOSK_ADMIN_PASSWORD:password}});
 let browser;const checks=[],pass=name=>{checks.push(name);console.log('PASS '+name);};
 try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/menu')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const admin=await browser.newPage({viewport:{width:1280,height:1000}}),customer=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];
  for(const p of [admin,customer]){p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));}
  const api=async(p,url,data)=>{const r=data===undefined?await p.request.get(base+url):await p.request.post(base+url,{data});const b=await r.json();assert.equal(r.status(),200,JSON.stringify(b));return b;};
  const image=fs.readFileSync(path.join(root,'assets/menu/published/classic-burger.jpg')).toString('base64');
  await admin.goto(base+'/admin');await admin.locator('[name=password]').fill(password);await admin.locator('#login button').click();await admin.locator('#order-rows').waitFor();
  for(const m of (await api(admin,'/api/admin/menu')).menu.filter(m=>m.id<=2))await api(admin,'/api/admin/menu/'+m.id,{...m,is_sold_out:false,photo:image});
  const intro={id:'v17-new-products-banner',title:'신메뉴 소식',description:'첫 소식 설명',photo:image,enabled:true};
  await api(admin,'/api/admin/ads',{revision:0,items:[intro]});
  await customer.clock.install();await customer.clock.pauseAt(new Date(Date.now()+1000));await customer.goto(base);
  const title=()=>customer.locator('.ad-slide:not([aria-hidden="true"]) h1').textContent();
  await customer.getByRole('heading',{name:'신메뉴 소식',exact:true}).waitFor();assert.equal(await customer.locator('#ad-position').textContent(),'1 / 3');
  await customer.clock.runFor(9000);assert.equal(await title(),'신메뉴 소식');await customer.clock.runFor(1000);assert.equal(await title(),'치킨버거');assert.match(await customer.locator('.ad-slide:not([aria-hidden="true"]) .welcome-copy p').textContent(),/크리스피/);
  pass('V17-ADS-01 first news remains for 9 seconds, advances at 10 to latest menu with matching description');
  await customer.locator('[data-action=ad-prev]').click();assert.equal(await title(),'신메뉴 소식');await customer.locator('[data-action=ad-prev]').click();assert.equal(await title(),'클래식버거');await customer.locator('[data-action=ad-next]').click();assert.equal(await title(),'신메뉴 소식');
  await customer.clock.runFor(9000);assert.equal(await title(),'신메뉴 소식');await customer.clock.runFor(1000);assert.equal(await title(),'치킨버거');
  await customer.locator('[data-action=ad-pause]').click();await customer.clock.runFor(120000);assert.equal(await title(),'치킨버거');await customer.locator('[data-action=ad-pause]').click();await customer.clock.runFor(10000);assert.equal(await title(),'클래식버거');
  pass('V17-ADS-02 previous/next wrap, rapid navigation, manual timer reset, pause and resume');
  await admin.locator('[data-tab=ads]').click();await admin.locator('[data-new-ad]').click();await admin.locator('[name=ad-title]').fill('우선 행사');await admin.locator('[name=ad-description]').fill('관리자가 우선 지정한 설명');await admin.locator('[name=ad-placement]').selectOption('PRIORITY');await admin.locator('[name=ad-photo]').setInputFiles(path.join(root,'assets/menu/published/shrimp-burger.jpg'));await admin.getByText('1440 × 810px · 미리보기와 같은 사진이 저장됩니다.',{exact:true}).waitFor();await admin.locator('#ad-editor [type=submit]').click();await admin.locator('.ad-card').getByRole('heading',{name:'우선 행사'}).waitFor();
  await customer.reload();await customer.getByRole('heading',{name:'신메뉴 소식',exact:true}).waitFor();await customer.locator('[data-action=ad-next]').click();assert.equal(await title(),'우선 행사');await customer.locator('[data-action=ad-next]').click();assert.equal(await title(),'치킨버거');
  const saved=await api(admin,'/api/admin/ads'),priority=saved.items.find(a=>a.title==='우선 행사');await admin.locator(`[data-toggle-ad="${priority.id}"]`).click();await customer.reload();await customer.getByRole('heading',{name:'신메뉴 소식',exact:true}).waitFor();await customer.locator('[data-action=ad-next]').click();assert.equal(await title(),'치킨버거');
  pass('V17-ADS-03 explicit priority overrides automatic menus; hiding priority restores default');
  const added=await api(admin,'/api/admin/menu',{key:randomUUID(),name:'막 등록한 메뉴',description:'최근 등록 메뉴 설명',category:'burger',base_price:7000,is_sold_out:false,options:[],choice_groups:[],photo:image});
  await customer.reload();await customer.getByRole('heading',{name:'신메뉴 소식',exact:true}).waitFor();await customer.locator('[data-action=ad-next]').click();assert.equal(await title(),'막 등록한 메뉴');
  let item=(await api(admin,'/api/admin/menu')).menu.find(m=>m.id===added.id);await api(admin,'/api/admin/menu/'+item.id,{base_price:item.base_price,is_sold_out:true,version:item.version});
  await customer.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await customer.getByRole('heading',{name:'신메뉴 소식',exact:true}).waitFor();await customer.locator('[data-action=ad-next]').click();assert.equal(await title(),'치킨버거');
  pass('V17-ADS-04 registering a menu needs no ad upload, sold-out current slide is removed on refresh');
  await customer.clock.resume();await customer.locator('.ad-track').waitFor({state:'detached'});
  for(const width of [320,390,768,1280]){await customer.setViewportSize({width,height:1000});assert.ok(await customer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await customer.screenshot({path:path.join(out,`slides-${width}.png`),fullPage:true});}
  const reduced=await browser.newPage({reducedMotion:'reduce'});await reduced.clock.install();await reduced.clock.pauseAt(new Date(Date.now()+1000));await reduced.goto(base);await reduced.getByRole('heading',{name:'신메뉴 소식',exact:true}).waitFor();assert.equal(await reduced.locator('[data-action=ad-pause]').getAttribute('aria-pressed'),'true');await reduced.clock.runFor(120000);assert.equal(await reduced.locator('#ad-position').textContent(),'1 / 3');await reduced.locator('[data-action=ad-next]').click();assert.equal(await reduced.locator('.ad-track').count(),0);await reduced.close();
  await customer.locator('[data-dining=TAKEOUT]').click();await customer.locator('.menu-card[data-id="1"]').click();await customer.locator('#option-form [type=submit]').click();await customer.locator('[data-action=review]').click();await customer.locator('[data-action=pay]').click();await customer.getByRole('heading',{name:'주문이 접수되었습니다'}).waitFor();
  pass('V17-ADS-05 responsive layouts, reduced motion and normal ordering remain usable');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({date:new Date().toISOString(),checks,errors},null,2));
 }finally{if(browser)await browser.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
