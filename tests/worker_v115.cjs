// Loopback-only Worker + migrated D1. The temporary entry mocks Firebase transport;
// it imports the production handler and is never included in published source.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{randomUUID,createHash}=require('node:crypto');
async function main(){
 const cwd=path.resolve('sites/kiosk-api'),password=randomUUID(),project='isolated-v115';
 const mockEnv={PAYMENT_MODE:'toss',TOSS_CLIENT_KEY:'test_ck_isolated_workerd_12345',TOSS_SECRET_KEY:'test_sk_isolated_workerd_12345'},push=(await import('./push-fixture.mjs')).pushFixture({env:mockEnv}),subscription=push.device();
 const token=uid=>Buffer.from('{"alg":"RS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:uid,aud:project,iss:'https://securetoken.google.com/'+project,auth_time:Math.floor(Date.now()/1000)-10,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.'+randomUUID();
 const head=token('head'),owner=token('branch-owner');
 const users={[head]:{localId:'head',email:'head@example.test',emailVerified:true,validSince:'0'},[owner]:{localId:'branch-owner',email:'owner@example.test',emailVerified:true,validSince:'0'}};
 fs.writeFileSync(path.join(cwd,'.wrangler/v115-entry.mjs'),`import {handleKiosk} from '../worker/kiosk.mjs';\nconst users=${JSON.stringify(users)},sent=[],payments=new Map();\nexport default {fetch(request,env,ctx){if(new URL(request.url).pathname==='/qa/pushes')return Response.json(sent);env.TOSS_FETCH=async(url,request)=>{const route=url.split('/v1/payments/')[1];if(route==='confirm'){const b=JSON.parse(request.body),v={paymentKey:b.paymentKey,orderId:b.orderId,totalAmount:b.amount,balanceAmount:b.amount,currency:'KRW',status:'DONE'};payments.set(b.paymentKey,v);return Response.json(v);}return payments.has(route)?Response.json(payments.get(route)):Response.json({},{status:404});};env.PUSH_FETCH=async(endpoint,payload)=>{sent.push({endpoint,body:Array.from(new Uint8Array(payload.body)),headers:payload.headers});return new Response(null,{status:201});};env.AUTH_FETCH=async(url,options)=>{const user=users[JSON.parse(options.body).idToken];return Response.json(user?{users:[user]}:{error:{}},{status:user?200:400});};return handleKiosk(request,env,ctx);}};`);
 fs.writeFileSync(path.join(cwd,'.wrangler/v115-runtime.json'),JSON.stringify({name:'isolated-v115-franchise',main:'v115-entry.mjs',compatibility_date:'2026-05-15',vars:{...mockEnv,PUSH_FETCH:undefined,KIOSK_ADMIN_HASH:createHash('sha256').update(password).digest('hex'),FIREBASE_PROJECT_ID:project,FIREBASE_WEB_API_KEY:'test-only',KIOSK_OWNER_EMAIL:'head@example.test'},d1_databases:[{binding:'DB',database_name:'site-creator-d1',database_id:'00000000-0000-4000-8000-000000000000'}]}));
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const child=spawn(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','dev','--config','.wrangler/v115-runtime.json','--local','--ip','127.0.0.1','--port',String(port),'--persist-to',process.env.KIOSK_WORKER_STATE??'.wrangler/v115-test'],{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
 const base=`http://127.0.0.1:${port}`;let auth,store=1;
 const api=async(p,data,expected=200)=>{const r=await fetch(base+p,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Kiosk-Session':'v115-workerd-customer-session','X-Kiosk-Store':String(store),...(auth?{Authorization:'Bearer '+auth}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});const b=await r.json();assert.equal(r.status,expected,JSON.stringify(b));return b;};
 try{
  let ready=false;for(let i=0;i<150;i++){try{if((await fetch(base+'/api/menu')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(ready,logs.slice(-1200));
  auth=(await api('/api/admin/login',{password})).token;const original=await api('/api/admin/menu');
  await api('/api/admin/claim-account',{id_token:head});auth=head;
  const hqIdentity=await api('/api/account');assert.equal(hqIdentity.platform_role,'HQ');assert.equal(hqIdentity.stores[0].membership_role,'OWNER');
  const body={key:randomUUID(),address:'경기도 용인시 처인구 모현읍 외대로 81',source_store_id:1,owner_email:'owner@example.test'};
  const [first,again,other]=await Promise.all([api('/api/account/stores',body),api('/api/account/stores',body),api('/api/account/stores',{...body,key:randomUUID()})]);assert.equal(first.store.id,again.store.id);assert.deepEqual([first.store.name,other.store.name].sort(),['용인모현점','용인모현2점'].sort());store=first.store.id;
  const hqStores=(await api('/api/account')).stores;assert.equal(hqStores.find(s=>s.id===first.store.id).membership_role,null);
  auth=owner;const info=await api('/api/account');assert.deepEqual(info.stores.map(s=>s.id),[first.store.id,other.store.id].sort((a,b)=>a-b));
  const copied=await api('/api/admin/menu');assert.equal(copied.menu.length,original.menu.length);assert.notEqual(copied.menu[0].id,original.menu[0].id);assert.notEqual(copied.menu[0].options[0].id,original.menu[0].options[0].id);
  const notificationBinding=await api('/api/admin/notifications/subscribe',{subscription});
  const m=copied.menu[0],o=m.options[0],order=await api('/api/orders',{key:randomUUID(),items:[{menu_id:m.id,options:[o.id],quantity:1,expected_unit:m.base_price+o.extra_price}]});
  const pending=await api('/api/orders/'+order.id+'/attempts',{key:randomUUID(),checkout_version:'v115'});assert.equal(pending.number,null);const confirm={paymentKey:'isolated-workerd-payment',orderId:pending.payment.id,amount:pending.total};const paid=await api('/api/payments/'+pending.payment.id,confirm);assert.equal(paid.number,1);assert.equal((await api('/api/payments/'+pending.payment.id,confirm)).number,1);
  let notifications=[];for(let i=0;i<40;i++){notifications=await (await fetch(base+'/qa/pushes')).json();if(notifications.length)break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(notifications.length,1);const notification=notifications[0];await mockEnv.PUSH_FETCH(notification.endpoint,{headers:notification.headers,body:Uint8Array.from(notification.body),redirect:'error',signal:new AbortController().signal});assert.equal(push.sent[0].message.store_id,first.store.id);assert.equal(push.sent[0].message.generation,notificationBinding.generation);
  assert.equal((await api('/api/admin/notifications?after=0')).events.length,1);await api('/api/admin/notifications/test',notificationBinding);await api('/api/account/notifications/unsubscribe',notificationBinding);assert.equal((await api('/api/admin/notifications/status',{id:notificationBinding.id})).binding,null);
  await api('/api/admin/orders/'+order.id,{expected:'PAID'});store=1;await api('/api/admin/orders',undefined,403);auth=head;assert.equal((await api('/api/admin/orders')).orders.length,0);assert.deepEqual((await api('/api/admin/menu')).menu,original.menu);
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10),period='?from='+today+'&to='+today;
  const report=await api('/api/account/sales'+period);assert.equal(report.summary.orders,1);assert.equal(report.summary.net,m.base_price+o.extra_price);assert.equal(report.menus[0].code,'MENU-'+original.menu[0].id);assert.equal(report.stores.reduce((n,s)=>n+s.net,0),report.summary.net);
  auth=owner;await api('/api/account/sales'+period,undefined,403);store=first.store.id;
  const profile=await api('/api/admin/store-profile',{address:'경기도 성남시 분당구 서현로 170',locality:'서현동',address_detail:'1층',auto_name:true,revision:0});assert.equal(profile.store.name,'분당서현점');
  await api('/api/admin/store-profile',{address:'경기도 성남시 분당구 서현로 170',locality:'서현동',revision:0},409);assert.equal((await api('/api/admin/orders')).orders.length,1);
  auth=head;
  const ingredient=await api('/api/account/supply/ingredients',{key:randomUUID(),name:'격리 패티',unit:'장',pack_label:'박스',pack_size:100,active:true});
  auth=owner;store=first.store.id;const request={key:randomUUID(),lines:[{ingredient_id:ingredient.id,packs:2,revision:0}]};
  const [requested,retried]=await Promise.all([api('/api/admin/supply',request),api('/api/admin/supply',request)]);assert.equal(requested.order.id,retried.order.id);
  let supply=requested.order;auth=head;const summary=await api('/api/account/supply');assert.equal(summary.summary[0].requested_packs,2);
  supply=(await api('/api/account/supply/orders/'+supply.id,{action:'approve',revision:supply.revision})).order;
  supply=(await api('/api/account/supply/orders/'+supply.id,{action:'ship',revision:supply.revision})).order;
  auth=owner;assert.equal((await api('/api/admin/ingredients')).items[0].quantity,0);
  const receipt={key:randomUUID(),revision:supply.revision,lines:[{line_id:supply.lines[0].id,quantity:180}]};
  const [received,duplicate]=await Promise.all([api('/api/admin/supply/'+supply.id+'/receive',receipt),api('/api/admin/supply/'+supply.id+'/receive',receipt)]);assert.equal(received.receipt_id,duplicate.receipt_id);assert.equal(received.order.status,'PARTIAL');
  supply=received.order;await api('/api/admin/supply/'+supply.id+'/receive',{...receipt,key:randomUUID(),revision:supply.revision,lines:[{line_id:supply.lines[0].id,quantity:21}]},409);
  const final=(await api('/api/admin/supply/'+supply.id+'/receive',{...receipt,key:randomUUID(),revision:supply.revision,lines:[{line_id:supply.lines[0].id,quantity:20}]})).order;assert.equal(final.status,'RECEIVED');assert.equal((await api('/api/admin/ingredients')).items[0].quantity,200);
  store=other.store.id;await api('/api/admin/supply/'+supply.id,undefined,404);assert.equal((await api('/api/admin/ingredients')).items[0].quantity,0);
  await api('/api/account/supply',undefined,403);
  const result={date:new Date().toISOString(),tossProvider:'mock',tossApproveAndReplay:true,notificationTriggerAndEncryptedPush:true,notificationStoreScope:true,deviceTestAndUnsubscribe:true,hqMembershipJoin:true,runtime:'workerd + D1',firebase:'mock transport',atomicOpening:true,procurementAtomic:true,partialFinalReceipt:true,receiptRetryExactlyOnce:true,hqAggregation:true,storeStockIsolated:true,concurrentNameSuffix:true,hqSalesReconcile:true,profileRevisionAndOrderPreservation:true,retryIdempotent:true,newMenuAndOptionIDs:true,ownerAllOperations:true,copiedMenuCheckout:true,crossStoreBlocked:true,sourcePreserved:true};fs.writeFileSync('data/qa/v1.15/worker-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await new Promise(resolve=>{spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).on('close',resolve);});}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});

