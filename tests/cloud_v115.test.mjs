import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {tenantFixture} from './tenant-fixture.mjs';import {tossFixture} from './toss-fixture.mjs';import {pushFixture} from './push-fixture.mjs';import {paymentConfig} from '../cloud/toss-payments.mjs';
test('T15-01 only paired individual TEST keys enable Toss; no live or demo fallback',()=>{
 const env={PAYMENT_MODE:'toss',TOSS_CLIENT_KEY:'test_ck_isolated_1234567',TOSS_SECRET_KEY:'test_sk_isolated_1234567'};assert.equal(paymentConfig(env).mode,'toss');for(const bad of [{TOSS_SECRET_KEY:''},{TOSS_CLIENT_KEY:'live_ck_123456789012'},{TOSS_SECRET_KEY:'live_sk_123456789012'},{TOSS_CLIENT_KEY:'test_gck_123456789012'}])assert.equal(paymentConfig({...env,...bad}).mode,'unavailable');assert.equal(paymentConfig({}).mode,'demo');
});
test('T15-02 approved payment records one order, stock movement and only its store push',async t=>{
 const f=await tenantFixture(t),push=pushFixture(f);await push.register(f.a,1);await push.register(f.b,2);const pg=tossFixture(f);
 f.sqlite.exec('INSERT INTO inventory(menu_id,enabled,quantity) VALUES(1,1,5)');
 const o=await pg.start();assert.equal(o.payment.status,'PENDING');assert.equal(push.sent.length,0);
 const [a,b]=await Promise.all([pg.resolve(o),pg.resolve(o)]);assert.equal(a.status,200);assert.equal(b.status,200);
 const r=await pg.resolve(o);assert.equal(r.data.status,'PAID');assert.equal(r.data.number,1);assert.equal(pg.calls.filter(x=>x.route==='confirm').length,1);
 assert.equal(f.sqlite.prepare('SELECT quantity FROM inventory WHERE menu_id=1').get().quantity,4);assert.equal(f.sqlite.prepare("SELECT count(*) n FROM inventory_movement WHERE kind='SALE'").get().n,1);assert.equal(push.sent.length,1);assert.equal(push.sent[0].message.store_id,1);
 assert.equal((await f.callTenant(f.b,2,'/api/admin/notifications?after=0')).data.events.length,0);
 const date=new Date(Date.now()+9*3600000).toISOString().slice(0,10),report=await f.callTenant(f.hq,1,'/api/account/sales?from='+date+'&to='+date);assert.equal(report.data.summary.net,o.total);assert.equal(report.data.summary.orders,1);
});
test('T15-03 amount/order/session/store tampering never reaches provider',async t=>{
 const f=await tenantFixture(t),pg=tossFixture(f),o=await pg.start(),cb=pg.callback(o);
 for(const body of [{...cb,amount:1},{...cb,orderId:'wrong'}])assert.equal((await pg.resolve(o,body)).status,400);
 assert.equal((await pg.resolve(o,cb,2)).status,404);assert.equal((await pg.resolve(o,cb,1,'another-customer-session-0001')).status,404);assert.equal(pg.calls.length,0);
});
test('T15-04 cancel before authentication permits retry; old cached checkout rejected',async t=>{
 const f=await tenantFixture(t),pg=tossFixture(f),o=await pg.start();assert.equal((await pg.resolve(o,{cancel:true})).data.payment.status,'FAILED');assert.equal(pg.calls.length,0);
 const old=await f.callTenant(null,1,'/api/orders/'+o.id+'/attempts',{key:randomUUID()});assert.equal(old.data.code,'CLIENT_UPDATE_REQUIRED');
 const retry=await f.callTenant(null,1,'/api/orders/'+o.id+'/attempts',{key:randomUUID(),checkout_version:'v115'});assert.equal(retry.data.payment.status,'PENDING');assert.notEqual(retry.data.payment.id,o.payment.id);
});
test('T15-05 lost confirm response reconciles without another approval',async t=>{
 const f=await tenantFixture(t),pg=tossFixture(f),o=await pg.start();let lost=true;
 pg.setHook((route,body)=>{if(route==='confirm'){pg.records.set(body.paymentKey,{paymentKey:body.paymentKey,orderId:body.orderId,totalAmount:body.amount,balanceAmount:body.amount,currency:'KRW',status:'DONE'});throw Error('lost response');}if(lost&&route!=='confirm')return Response.json({}, {status:404});});
 assert.equal((await pg.resolve(o)).data.payment.status,'PENDING');lost=false;
 assert.equal((await pg.resolve(o,{})).data.status,'PAID');assert.equal(pg.calls.filter(x=>x.route==='confirm').length,1);
});
test('T15-06 price/stock changes during approval cause compensating test cancellation',async t=>{
 for(const change of ["UPDATE menu SET is_sold_out=1 WHERE id=1","INSERT INTO inventory(menu_id,enabled,quantity) VALUES(1,1,0)"]){
 const f=await tenantFixture(t),pg=tossFixture(f),o=await pg.start();pg.setHook(route=>{if(route==='confirm')f.sqlite.exec(change);});
 const r=await pg.resolve(o);assert.equal(r.data.payment.status,'FAILED');assert.equal(r.data.number,null);assert.equal(pg.records.get(pg.callback(o).paymentKey).status,'CANCELED');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM order_notification').get().n,0);
 }
});
test('T15-07 transient DB failure after approval retains pending and safely recovers',async t=>{
 const f=await tenantFixture(t),pg=tossFixture(f),o=await pg.start();f.sqlite.exec("CREATE TRIGGER temp_failure BEFORE UPDATE OF status ON orders WHEN NEW.status='PAID' BEGIN SELECT RAISE(ABORT,'temporary storage failure'); END;");
 assert.equal((await pg.resolve(o)).data.payment.status,'PENDING');f.sqlite.exec('DROP TRIGGER temp_failure');assert.equal((await pg.resolve(o,{})).data.status,'PAID');assert.equal(pg.calls.filter(x=>x.route==='confirm').length,1);
});
test('T15-08 explicit decline can retry but uncertain approval cannot create another payment',async t=>{
 const f=await tenantFixture(t),pg=tossFixture(f),o=await pg.start();pg.setHook(route=>route==='confirm'?Response.json({code:'REJECT_CARD_COMPANY'},{status:400}):undefined);assert.equal((await pg.resolve(o)).data.payment.status,'FAILED');
 const next=await pg.start();pg.setHook(route=>route==='confirm'?Response.json({},{status:503}):undefined);assert.equal((await pg.resolve(next)).data.payment.status,'PENDING');
 const again=await f.callTenant(null,1,'/api/orders/'+next.id+'/attempts',{key:randomUUID(),checkout_version:'v115'});assert.equal(again.data.payment.id,next.payment.id);assert.equal((await pg.resolve(next,{cancel:true})).data.payment.status,'PENDING');
});
