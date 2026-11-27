import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tenantFixture} from './tenant-fixture.mjs';
import {pushFixture} from './push-fixture.mjs';
import {drainNotifications} from '../cloud/notifications.mjs';
test('v1.13 paid order event and encrypted push go only to its store; failed and replayed attempts do not notify',async t=>{
 const f=await tenantFixture(t),p=pushFixture(f),a=await p.register(f.a,1),b=await p.register(f.b,2);
 const before=(await f.callTenant(f.a,1,'/api/admin/menu')).data;
 const unpaid=await p.order(f.a,1,false);assert.equal(p.sent.length,0);
 await f.callTenant(f.a,1,'/api/orders/'+unpaid.id+'/attempts',{key:randomUUID(),demo_result:'failure'});assert.equal(p.sent.length,0);
 const key=randomUUID(),path='/api/orders/'+unpaid.id+'/attempts';await f.callTenant(f.a,1,path,{key,demo_result:'success'});await f.callTenant(f.a,1,path,{key,demo_result:'success'});
 assert.equal(p.sent.length,1);assert.equal(p.sent[0].endpoint,a.subscription.endpoint);assert.equal(p.sent[0].message.store_id,1);assert.equal(p.sent[0].message.generation,a.binding.generation);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM order_notification').get().n,1);assert.equal(f.sqlite.prepare('SELECT status FROM notification_delivery').get().status,'SENT');
 await p.order(f.b,2);assert.equal(p.sent[1].endpoint,b.subscription.endpoint);assert.equal(p.sent[1].message.store_id,2);
 assert.deepEqual((await f.callTenant(f.a,1,'/api/admin/menu')).data,before);
});
test('v1.13 subscription and event endpoints enforce store, role, device ownership and endpoint restrictions',async t=>{
 const f=await tenantFixture(t),p=pushFixture(f),a=await p.register(f.a,1);await p.register(f.staff,2);
 for(const path of ['/api/admin/notifications','/api/admin/notifications/config'])assert.equal((await f.callTenant(f.a,2,path)).status,403);
 assert.equal((await f.callTenant(f.a,2,'/api/admin/notifications/subscribe',{subscription:p.device()})).status,403);
 for(const endpoint of ['http://fcm.googleapis.com/fcm/send/abc','https://localhost/x','https://169.254.169.254/latest','https://fcm.googleapis.com.evil.test/fcm/send/a','https://user@fcm.googleapis.com/fcm/send/a','https://fcm.googleapis.com:444/fcm/send/a'])assert.equal((await f.callTenant(f.a,1,'/api/admin/notifications/subscribe',{subscription:{...p.device(),endpoint}})).status,400,endpoint);
 assert.equal((await f.callTenant(f.b,2,'/api/admin/notifications/status',{id:a.binding.id})).data.binding,null);
 await f.callTenant(f.b,2,'/api/account/notifications/unsubscribe',a.binding);assert.equal(f.sqlite.prepare('SELECT enabled FROM push_subscription WHERE id=?').get(a.binding.id).enabled,1);
 assert.equal((await f.callTenant(f.b,2,'/api/admin/notifications/test',a.binding)).status,404);
 assert.equal((await f.callTenant(f.a,1,'/api/admin/notifications/test',a.binding)).status,200);assert.equal(p.sent[0].message.type,'PUSH_TEST');assert.equal((await f.callTenant(f.a,1,'/api/admin/notifications/test',a.binding)).status,429);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM orders').get().n,0);
});
test('v1.13 revoked, disabled and rebound subscriptions skip queued events instead of leaking to another store',async t=>{
 const f=await tenantFixture(t),p=pushFixture(f),a=await p.register(f.a,1);p.responses.push(503);await p.order();assert.equal(p.sent.length,1);
 const b=await p.register(f.b,2,a.subscription);f.sqlite.prepare('UPDATE notification_delivery SET next_attempt=0').run();await drainNotifications(f.env.DB,f.env,1);assert.equal(p.sent.length,1);assert.equal(f.sqlite.prepare('SELECT status FROM notification_delivery').get().status,'SKIPPED');
 await p.order(f.b,2);assert.equal(p.sent.at(-1).message.generation,b.binding.generation);assert.equal(p.sent.at(-1).message.store_id,2);
 p.responses.push(503);await p.order(f.b,2);const count=p.sent.length;
 f.sqlite.prepare("UPDATE store_member SET enabled=0 WHERE uid='owner-b'").run();f.sqlite.prepare('UPDATE notification_delivery SET next_attempt=0').run();await drainNotifications(f.env.DB,f.env,2);assert.equal(p.sent.length,count);
});
test('v1.13 concurrent retry claims once; temporary failures recover; expired endpoints are disabled',async t=>{
 const f=await tenantFixture(t),p=pushFixture(f),a=await p.register(f.a,1);p.responses.push(503);const o=await p.order();assert.equal((await f.callTenant(f.a,1,'/api/orders/'+o.id)).data.status,'PAID');
 f.sqlite.prepare('UPDATE notification_delivery SET next_attempt=0').run();await Promise.all([drainNotifications(f.env.DB,f.env,1),drainNotifications(f.env.DB,f.env,1)]);assert.equal(p.sent.length,2);assert.equal(f.sqlite.prepare('SELECT status FROM notification_delivery').get().status,'SENT');
 p.responses.push(410);await p.order();assert.equal(f.sqlite.prepare('SELECT enabled FROM push_subscription WHERE id=?').get(a.binding.id).enabled,0);await p.order();assert.equal(p.sent.length,3);
});
test('v1.13 feed initial cursor suppresses old alerts, scopes IDs and paginates without missing events',async t=>{
 const f=await tenantFixture(t),p=pushFixture(f);await p.order();await p.order(f.b,2);
 const initial=(await f.callTenant(f.a,1,'/api/admin/notifications')).data;assert.equal(initial.events.length,0);assert.equal(initial.cursor,1);
 await p.order();const feed=(await f.callTenant(f.a,1,'/api/admin/notifications?after='+initial.cursor)).data;assert.equal(feed.events.length,1);assert.equal(feed.events[0].store_id,1);
 const old=(await f.callTenant(f.b,2,'/api/admin/notifications?after=0')).data;assert.equal(old.events.length,1);assert.equal(old.events[0].store_id,2);
 for(let i=0;i<51;i++)await p.order();const first=(await f.callTenant(f.a,1,'/api/admin/notifications?after='+feed.cursor)).data;assert.equal(first.events.length,50);assert.equal(first.more,true);const second=(await f.callTenant(f.a,1,'/api/admin/notifications?after='+first.cursor)).data;assert.equal(second.events.length,1);assert.equal(second.more,false);
});
test('v1.13 payment and notification enqueue roll back together on an injected event failure',async t=>{
 const f=await tenantFixture(t),p=pushFixture(f);await p.register(f.a,1);const order=await p.order(f.a,1,false);
 f.sqlite.exec("CREATE TRIGGER force_notification_failure BEFORE INSERT ON order_notification BEGIN SELECT RAISE(ABORT,'FORCED_TEST_FAILURE'); END");
 const result=await f.callTenant(f.a,1,'/api/orders/'+order.id+'/attempts',{key:randomUUID(),demo_result:'success'});assert.equal(result.status,503);
 assert.equal(f.sqlite.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status,'PENDING_PAYMENT');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM payment').get().n,0);assert.equal(p.sent.length,0);
 f.sqlite.exec('DROP TRIGGER force_notification_failure');assert.equal((await f.callTenant(f.a,1,'/api/orders/'+order.id+'/attempts',{key:randomUUID(),demo_result:'success'})).status,200);assert.equal(p.sent.length,1);
});
test('v1.13 unsubscribed and cancelled orders never receive a delayed notification',async t=>{
 const f=await tenantFixture(t),p=pushFixture(f),a=await p.register(f.a,1);p.responses.push(503);const o=await p.order();
 await f.callTenant(f.a,1,'/api/admin/orders/'+o.id+'/cancel',{expected:'PAID',reason:'임시 취소 검사'});f.sqlite.prepare('UPDATE notification_delivery SET next_attempt=0').run();await drainNotifications(f.env.DB,f.env,1);assert.equal(p.sent.length,1);
 await f.callTenant(f.a,1,'/api/account/notifications/unsubscribe',a.binding);await p.order();assert.equal(p.sent.length,1);
});
