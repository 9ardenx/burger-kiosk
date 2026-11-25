// Runs only against its own temporary Python demo store. Requires Playwright and Chrome.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {spawn}=require('node:child_process'), {randomUUID}=require('node:crypto');
const net=require('node:net');
const root=path.resolve(__dirname,'..');
const checks=[];
const check=name=>{checks.push({name,result:'PASS'});console.log('PASS '+name);};
async function main(){
  const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'burger-v12-browser-'));
  const password=randomUUID(), base=`http://127.0.0.1:${port}`;
  const server=spawn(process.env.PYTHON||'python',['app.py','--port',String(port),'--data-dir',directory],{
    cwd:root,env:{...process.env,PAYMENT_MODE:'demo',KIOSK_ADMIN_PASSWORD:password},windowsHide:true,stdio:'ignore'});
  let browser;
  try{
    for(let i=0;i<80;i++){try{if((await fetch(base+'/api/menu')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined)});
    const admin=await browser.newPage({viewport:{width:1280,height:1000}});
    const customer=await browser.newPage({viewport:{width:1280,height:1000}});
    const errors=[];for(const page of [admin,customer])page.on('pageerror',e=>errors.push(e.message));
    await admin.goto(base+'/admin');await admin.locator('[name=password]').fill(password);
    await admin.locator('#login button').click();await admin.locator('#order-rows').waitFor();
    const api=async(page,url,data)=>{
      const response=data===undefined?await page.request.get(base+url):await page.request.post(base+url,{data});
      const body=await response.json();assert.equal(response.status(),200,JSON.stringify(body));return body;
    };
    const photo=await admin.evaluate(()=>{const c=document.createElement('canvas');c.width=720;c.height=465;
      const x=c.getContext('2d');x.fillStyle='#ecd6b3';x.fillRect(0,0,720,465);x.fillStyle='#bd7f3f';x.fillRect(150,100,420,250);return c.toDataURL('image/jpeg').split(',')[1];});
    const initial=(await api(admin,'/api/admin/menu')).menu, fries=initial.find(m=>m.category==='side');
    await api(admin,'/api/admin/menu/'+fries.id,{...fries,is_sold_out:false,photo});
    await api(admin,'/api/admin/menu',{key:randomUUID(),name:'치킨너겟',description:'한 입에 쏙! 부드러운 닭고기살로 꽉 채운 영양 만점 스낵',category:'side',base_price:3000,is_sold_out:false,options:[],photo});
    await customer.goto(base);await customer.locator('[data-dining=DINE_IN]').click();await customer.locator('[data-category=side]').click();
    for(const width of [1280,540,390,320]){
      await customer.setViewportSize({width,height:1000});
      const boxes=await customer.locator('.menu-card').evaluateAll(cards=>cards.map(c=>{
        const a=c.querySelector('.art'),r=c.getBoundingClientRect(),s=a.getBoundingClientRect();
        return {cardTop:r.top,imageTop:s.top,imageWidth:s.width,imageHeight:s.height};}));
      assert.equal(boxes.length,2);
      for(const box of boxes){assert.ok(Math.abs(box.imageTop-box.cardTop)<.02);assert.ok(Math.abs(box.imageWidth/box.imageHeight-720/465)<.01);}
      assert.equal(await customer.locator('.art.with-photo img').evaluateAll(images=>images.every(i=>getComputedStyle(i).objectFit==='contain')),true);
      assert.equal(await customer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    }
    check('BUG-001: side cards start at the top and retain equal image ratio at 320/390/540/1280px');
    await customer.setViewportSize({width:1280,height:1000});
    await admin.locator('[data-tab=menu]').click();await admin.locator('.catalog-card').first().waitFor();
    const before=await admin.locator('.catalog-card').evaluateAll(cards=>cards.map(c=>Number(c.dataset.menuId)));
    const last=before.at(-1);
    await admin.locator(`[data-move-menu="${last}"][data-direction="-1"]`).click();
    await admin.locator('[data-save-order]').click();await admin.locator('[data-save-order]:disabled').waitFor();
    const desired=before.slice();[desired[desired.length-1],desired[desired.length-2]]=[desired.at(-2),desired.at(-1)];
    await admin.reload();await admin.locator('[data-tab=menu]').click();await admin.locator('.catalog-card').first().waitFor();
    assert.deepEqual(await admin.locator('.catalog-card').evaluateAll(cards=>cards.map(c=>Number(c.dataset.menuId))),desired);
    await customer.reload();await customer.locator('.menu-card').first().waitFor();
    assert.deepEqual(await customer.locator('.menu-card').evaluateAll(cards=>cards.map(c=>Number(c.dataset.id))),desired);
    check('TC-ORDER-01: saved menu order survives reload and is shared with customer screen');
    async function addBurger(){await customer.locator('.menu-card[data-id="1"]').click();await customer.locator('#option-form [type=submit]').click();}
    await addBurger();await customer.locator('[data-action=review]').click();await customer.locator('[data-action=menu]').click();
    assert.equal(await customer.locator('.counter').textContent(),'1');
    customer.once('dialog',dialog=>dialog.dismiss());await customer.locator('[data-action=clear-cart]').click();
    assert.equal(await customer.locator('.counter').textContent(),'1');
    customer.once('dialog',dialog=>dialog.accept());await customer.locator('[data-action=clear-cart]').click();
    await customer.waitForFunction(()=>document.querySelector('.counter')?.textContent==='0');
    await customer.reload();await customer.locator('.counter').waitFor();assert.equal(await customer.locator('.counter').textContent(),'0');
    check('TC-CANCEL-01: back keeps cart; clearing requires confirmation and survives reload');
    await addBurger();await customer.locator('[data-action=review]').click();await customer.locator('#demo-result').selectOption('failure');
    await customer.locator('[data-action=pay]').click();await customer.locator('[data-action=retry]').waitFor();
    const cancelledId=await customer.evaluate(()=>JSON.parse(sessionStorage.getItem('burger-kiosk-session-v1')).orderId);
    customer.once('dialog',dialog=>dialog.accept());await customer.locator('[data-action=cancel-order]').click();
    await customer.locator('[data-dining=DINE_IN]').click();
    await customer.locator('.menu-card').first().waitFor();
    assert.equal((await api(customer,'/api/orders/'+cancelledId)).status,'CANCELLED');
    assert.equal((await api(admin,'/api/admin/orders')).orders.length,0);
    check('TC-CANCEL-02: decline then whole-order cancel clears cart and never appears in kitchen');
    async function paidOrder(){const order=await api(customer,'/api/orders',{key:randomUUID(),items:[{menu_id:1,quantity:1,options:[],expected_unit:5500}]});
      return api(customer,`/api/orders/${order.id}/attempts`,{key:randomUUID(),demo_result:'success'});}
    const a=await paidOrder(), b=await paidOrder();
    await admin.locator('[data-tab=orders]').click();await admin.locator(`[data-next="${a.id}"]`).waitFor();
    let release;const gate=new Promise(resolve=>release=resolve);
    await admin.route('**/api/admin/orders/'+a.id,async route=>{await gate;await route.continue();});
    await admin.locator(`[data-next="${a.id}"]`).click();
    assert.equal(await admin.locator(`[data-next="${a.id}"]`).isDisabled(),true);
    assert.equal(await admin.locator(`[data-next="${b.id}"]`).isDisabled(),false);
    await admin.locator(`[data-next="${b.id}"]`).click();
    await admin.locator(`[data-next="${b.id}"][data-status=PREPARING]:enabled`).waitFor();
    assert.equal((await api(customer,'/api/orders/'+a.id)).status,'PAID');
    release();await admin.locator(`[data-next="${a.id}"][data-status=PREPARING]:enabled`).waitFor();
    await admin.unroute('**/api/admin/orders/'+a.id);
    check('BUG-002: only the clicked order is pending; another order works during a delayed request');
    // Deliver an old list after a newer mutation to catch UI state regression.
    let deliver, fetched;const held=new Promise(resolve=>deliver=resolve), seen=new Promise(resolve=>fetched=resolve);
    await admin.route('**/api/admin/orders',async route=>{const response=await route.fetch();fetched();await held;await route.fulfill({response});},{times:1});
    await admin.locator('[data-act=refresh]').click();await seen;
    await admin.locator(`[data-next="${a.id}"]`).click();await admin.locator(`[data-next="${a.id}"][data-status=READY]:enabled`).waitFor();
    deliver();await admin.locator('[data-act=refresh]:enabled').waitFor();
    assert.equal((await admin.locator(`[data-next="${a.id}"]`).getAttribute('data-status')),'READY');
    await admin.evaluate(id=>{window.testStableButton=document.querySelector(`[data-next="${id}"]`);window.testStableButton.focus();},b.id);
    await admin.evaluate(()=>document.querySelector('[data-act=refresh]').click());
    await admin.locator('[data-act=refresh]:enabled').waitFor();
    assert.equal(await admin.evaluate(id=>window.testStableButton===document.querySelector(`[data-next="${id}"]`)&&document.activeElement===window.testStableButton,b.id),true);
    check('TC-KITCHEN-02: stale response cannot revert state; unchanged refresh preserves button and focus');
    assert.deepEqual(errors,[]);
    check('TC-BROWSER-01: customer and admin flows have no uncaught browser errors');
    fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({date:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'medium'}).format(new Date()),checks},null,2));
    console.log('RESULT_DIRECTORY '+directory);
  }finally{if(browser)await browser.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
