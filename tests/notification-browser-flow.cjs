const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({p,f,login,push,out,context,base})=>{
 const subscription=push.device();
 await context.grantPermissions(['notifications'],{origin:base});
 await context.addInitScript(dto=>{
  const make=()=>({endpoint:dto.endpoint,toJSON:()=>dto,unsubscribe:async()=>{localStorage.removeItem('qa-push-subscribed');return true;}});
  PushManager.prototype.getSubscription=async()=>localStorage.getItem('qa-push-subscribed')?make():null;
  PushManager.prototype.subscribe=async()=>{localStorage.setItem('qa-push-subscribed','1');return make();};
 },subscription);
 await p.reload();await p.locator('#account-store').waitFor();await p.getByText('화면 알림 연결됨 · 약 3초 간격',{exact:true}).waitFor();
 await p.locator('[data-push-enable]:not([disabled])').waitFor();await p.locator('[data-push-enable]').click();await p.getByText('이 기기 알림 켜짐 · 기존 매장',{exact:true}).waitFor();
 const stored=f.sqlite.prepare('SELECT * FROM push_subscription WHERE endpoint=?').get(subscription.endpoint);assert.equal(stored.store_id,1);assert.equal(stored.uid,'owner-a');
 const registration=await p.evaluate(async()=>{const r=await navigator.serviceWorker.ready;return {scope:r.scope,active:r.active?.state};});assert.equal(registration.active,'activated');assert.equal(registration.scope,base+'/');
 await p.locator('#tabs [data-tab=menu]').click();await p.locator('[data-edit-menu="1"]').click();const name=p.locator('#menu-editor [name=name]');await name.fill('저장하지 않은 임시 이름');
 const b=await push.order(f.b,2);await p.waitForTimeout(3300);assert.ok(await p.locator('#order-alert').isHidden());
 const a=await push.order(f.a,1);await p.locator('#order-alert:not([hidden])').waitFor();assert.ok((await p.locator('#order-alert').textContent()).includes(String(a.number).padStart(3,'0')+'번'));assert.equal(await name.inputValue(),'저장하지 않은 임시 이름');
 assert.equal(push.sent.at(-1).message.store_id,1);assert.equal(push.sent.at(-1).endpoint,subscription.endpoint);
 const cdp=await context.newCDPSession(p);let registrations=[];cdp.on('ServiceWorker.workerRegistrationUpdated',e=>{registrations=e.registrations;});await cdp.send('ServiceWorker.enable');
 for(let i=0;i<30&&!registrations.some(r=>r.scopeURL===base+'/');i++)await p.waitForTimeout(50);
 const id=registrations.find(r=>r.scopeURL===base+'/')?.registrationId;assert.ok(id,'service worker registration');
 const message=push.sent.at(-1).message;
 const deliver=async m=>{await cdp.send('ServiceWorker.deliverPushMessage',{origin:base,registrationId:id,data:JSON.stringify(m)});};
 const notifications=()=>p.evaluate(async()=>{const r=await navigator.serviceWorker.ready;return (await r.getNotifications()).map(n=>({title:n.title,body:n.body,tag:n.tag,data:n.data}));});
 await deliver(message);for(let i=0;i<30&&!(await notifications()).length;i++)await p.waitForTimeout(100);
 let shown=await notifications();assert.equal(shown.length,1);assert.ok(shown[0].title.includes('기존 매장'));assert.equal(shown[0].data.store_id,1);
 await deliver(message);await deliver({...message,store_id:2,event_id:message.event_id+1000});await deliver({...message,generation:'stale',event_id:message.event_id+2000});await p.waitForTimeout(300);assert.equal((await notifications()).length,1);
 for(const width of [320,390,768,1280]){await p.setViewportSize({width,height:1100});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'notification overflow '+width);await p.screenshot({path:path.join(out,'notifications-'+width+'.png'),fullPage:true});}
 await p.locator('[data-back-menu]').click();await p.locator('[data-alert-dismiss]').click();await p.reload();await p.locator('#account-store').waitFor();await p.getByText('화면 알림 연결됨 · 약 3초 간격',{exact:true}).waitFor();await p.waitForTimeout(3300);assert.ok(await p.locator('#order-alert').isHidden(),'reload must not repeat accepted event');
 await p.locator('[data-push-test]:not([hidden])').click();await p.getByText('연결 확인 알림 요청 완료 · 기기 알림함을 확인해 주세요.',{exact:true}).waitFor();assert.equal(push.sent.at(-1).message.type,'PUSH_TEST');await deliver(push.sent.at(-1).message);await p.waitForTimeout(300);assert.equal((await notifications()).length,2);
 await p.locator('[data-act=logout]').click();await p.locator('#email-login').waitFor();assert.equal(await p.evaluate(()=>sessionStorage.getItem('burger-kiosk.account.v18')),null);for(let i=0;i<40&&(f.sqlite.prepare('SELECT enabled FROM push_subscription WHERE id=?').get(stored.id).enabled!==0||(await notifications()).length);i++)await p.waitForTimeout(50);assert.equal(f.sqlite.prepare('SELECT enabled FROM push_subscription WHERE id=?').get(stored.id).enabled,0);assert.equal((await notifications()).length,0);
 await deliver({...message,event_id:message.event_id+3000});await p.waitForTimeout(300);assert.equal((await notifications()).length,0,'late push after logout must not show');
 await login('primary@example.test');await p.getByRole('heading',{name:'본사 관리',exact:true}).waitFor();assert.equal(await p.locator('.notification-controls').count(),0);
 await p.locator('[data-workspace-store]').click();await p.locator('#account-store').waitFor();await p.locator('[data-push-enable]:not([disabled])').waitFor();await p.locator('[data-push-enable]').click();await p.getByText('이 기기 알림 켜짐 · 기존 매장',{exact:true}).waitFor();
 await p.locator('#account-store').selectOption('2');await p.locator('#account-store').waitFor();await p.getByText('이 기기 알림 꺼짐',{exact:true}).waitFor();assert.equal(f.sqlite.prepare('SELECT enabled FROM push_subscription WHERE id=?').get(stored.id).enabled,0);
 assert.equal(f.sqlite.prepare('SELECT name FROM menu WHERE id=1').get().name,'클래식버거');assert.equal(f.sqlite.prepare('SELECT store_id FROM orders WHERE id=?').get(b.id).store_id,2);
 await cdp.detach();fs.writeFileSync(path.join(out,'notification-browser-results.json'),JSON.stringify({date:new Date().toISOString(),screenStoreIsolation:true,editingPreserved:true,serviceWorkerActivated:true,pushDecrypted:true,simulatedNativePushDisplayed:true,duplicateAndWrongStoreSuppressed:true,logoutLatePushBlocked:true,switchUnsubscribes:true,connectionTestWithoutOrder:true,reloadNoRepeat:true,widths:[320,390,768,1280],transport:'mock Web Push endpoint; Chrome CDP delivery; real Android/iPhone not tested'},null,2));
};
