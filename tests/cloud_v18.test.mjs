import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {setup} from './cloud-fixture.mjs';

import {tenantFixture} from './tenant-fixture.mjs';
const paidOrder=async(f,token,store,menu,price,key=randomUUID())=>{
 const order=await f.callTenant(token,store,'/api/orders',{key,items:[{menu_id:menu,quantity:1,options:[],expected_unit:price}]});assert.equal(order.status,200,JSON.stringify(order.data));
 const paid=await f.callTenant(token,store,`/api/orders/${order.data.id}/attempts`,{key:randomUUID(),demo_result:'success'});assert.equal(paid.status,200);return paid.data;
};
test('v1.8 two stores isolate menus, settings, prices, stock and paid orders under concurrent requests',async t=>{
 const f=await tenantFixture(t),call=f.callTenant;
 const menus=await Promise.all([call(f.a,1,'/api/admin/menu'),call(f.b,2,'/api/admin/menu')]);
 assert.equal(menus[0].data.menu.some(m=>m.id===f.bMenu),false);assert.deepEqual(menus[1].data.menu.map(m=>m.id),[f.bMenu]);
 await call(f.b,2,'/api/admin/categories',{items:[{id:'burger',name:'B버거'}],revision:0});assert.equal((await call(f.a,1,'/api/admin/categories')).data.items[0].name,'버거');
 await call(f.b,2,'/api/admin/menu-order',{ids:[f.bMenu],revision:0});assert.equal((await call(f.a,1,'/api/admin/menu')).data.order_revision,0);
 await call(f.b,2,'/api/admin/inventory/'+f.bMenu,{enabled:true,quantity:5,low_threshold:1,revision:0,reason:'임시 입고'});
 const photo=readFileSync(new URL('../assets/menu/published/classic-burger.jpg',import.meta.url)).toString('base64');
 await call(f.b,2,'/api/admin/ads',{items:[{id:randomUUID(),title:'B광고',description:'',enabled:true,photo}],revision:0});assert.equal((await call(f.a,1,'/api/ads')).data.items.length,0);
 const promotion={id:randomUUID(),title:'B할인',enabled:true,menu_ids:[f.bMenu],weekdays:[0,1,2,3,4,5,6],start_time:'00:00',end_time:'24:00',mode:'FIXED',value:6000};
 assert.equal((await call(f.b,2,'/api/admin/promotions',{items:[promotion],revision:0})).status,200);
 assert.equal((await call(f.a,1,'/api/menu')).data.menu[0].base_price,5500);assert.equal((await call(f.b,2,'/api/menu')).data.menu[0].base_price,6000);
 const key=randomUUID(),[a,b]=await Promise.all([paidOrder(f,f.a,1,1,5500,key),paidOrder(f,f.b,2,f.bMenu,6000,key)]);assert.notEqual(a.id,b.id);assert.equal(a.number,1);assert.equal(b.number,1);
 assert.deepEqual((await call(f.a,1,'/api/admin/orders')).data.orders.map(o=>o.id),[a.id]);assert.deepEqual((await call(f.b,2,'/api/admin/orders')).data.orders.map(o=>o.id),[b.id]);
 const inventory=(await call(f.b,2,'/api/admin/inventory')).data;assert.equal(inventory.items.length,1);assert.equal(inventory.items[0].quantity,4);
 assert.equal((await call(f.a,1,'/api/admin/inventory')).data.history.length,0);
 const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10),query='/api/admin/sales?from='+day+'&to='+day;
 assert.equal((await call(f.a,1,query)).data.summary.net,5500);assert.equal((await call(f.b,2,query)).data.summary.net,6000);
});
test('v1.8 cross-store headers, menu IDs and order IDs cannot read or mutate another store',async t=>{
 const f=await tenantFixture(t),call=f.callTenant,aOrder=await paidOrder(f,f.a,1,1,5500);
 for(const path of ['/api/admin/orders','/api/admin/menu','/api/admin/categories','/api/admin/ads','/api/admin/promotions','/api/admin/inventory','/api/admin/accounts','/api/admin/sales?from=2026-11-01&to=2026-11-27'])assert.equal((await call(f.a,2,path)).status,403,path);
 assert.equal((await call(f.b,1,'/api/admin/menu')).status,403);
 const before=JSON.stringify((await call(f.a,1,'/api/admin/menu')).data);
 assert.equal((await call(f.b,2,'/api/admin/menu/1',{base_price:1,is_sold_out:true,version:0})).status,409);
 assert.equal((await call(f.b,2,'/api/admin/inventory/1',{enabled:true,quantity:9,low_threshold:0,revision:0,reason:'거절 검사'})).status,404);
 assert.equal((await call(f.b,2,'/api/admin/menu-order',{ids:[1],revision:0})).status,409);
 for(const suffix of ['', '/cancel','/attempts'])assert.equal((await call(f.b,2,'/api/orders/'+aOrder.id+suffix,suffix?{key:randomUUID(),demo_result:'success'}:undefined)).status,404);
 assert.equal((await call(f.b,2,'/api/admin/orders/'+aOrder.id,{expected:'PAID'})).status,409);
 assert.equal((await call(f.b,2,'/api/admin/orders/'+aOrder.id+'/cancel',{expected:'PAID',reason:'거절 검사'})).status,404);
 assert.equal(JSON.stringify((await call(f.a,1,'/api/admin/menu')).data),before);assert.equal((await call(f.a,1,'/api/admin/orders')).data.orders[0].status,'PAID');
 assert.equal((await call(f.a,999,'/api/menu')).status,404);assert.equal((await call(f.a,'1 OR 1=1','/api/menu')).status,400);
});
test('v1.8 staff handles its kitchen only; disabling membership takes effect with the same token',async t=>{
 const f=await tenantFixture(t),call=f.callTenant,order=await paidOrder(f,f.b,2,f.bMenu,7000);
 assert.equal((await call(f.staff,2,'/api/admin/orders')).status,200);assert.equal((await call(f.staff,2,'/api/admin/orders/'+order.id,{expected:'PAID'})).status,200);
 for(const path of ['/api/admin/menu','/api/admin/accounts','/api/admin/inventory'])assert.equal((await call(f.staff,2,path)).status,403);
 assert.equal((await call(f.staff,2,'/api/admin/orders/'+order.id+'/cancel',{expected:'PREPARING',reason:'거절 검사'})).status,403);
 assert.equal((await call(f.b,2,'/api/admin/accounts/member',{uid:'staff-b',role:'STAFF',enabled:false,revision:0})).status,200);
 assert.equal((await call(f.staff,2,'/api/admin/orders')).status,403);
 assert.equal((await call(f.b,2,'/api/admin/accounts/member',{uid:'owner-b',role:'STAFF',enabled:false,revision:0})).status,409);
});
test('v1.8 provider rejection, tampering, expiry, revocation, wrong project and unverified email fail closed',async t=>{
 const f=await tenantFixture(t),call=f.callTenant;
 assert.equal((await call(f.a+'tampered',1,'/api/admin/orders')).status,401);
 for(const [claims,provider,status] of [[{exp:1},{},401],[{aud:'other'},{},401],[{iss:'https://evil.test'},{},401],[{auth_time:1},{validSince:'2'},401],[{},{disabled:true},401],[{},{emailVerified:false},403]]){
  const token=f.identity('owner-a','a@example.test',claims,provider);assert.equal((await call(token,1,'/api/admin/orders')).status,status);
 }
 f.env.AUTH_FETCH=async()=>{throw Error('offline');};assert.equal((await call(f.a,1,'/api/admin/orders')).status,503);
});
test('v1.8 explicit invitation binds a verified identity; expired/revoked invitations never grant a store',async t=>{
 const f=await tenantFixture(t),call=f.callTenant,newToken=f.identity('new-person','new@example.test');
 assert.equal((await call(newToken,2,'/api/account')).status,403);
 await call(f.b,2,'/api/admin/accounts/invite',{email:'new@example.test',role:'STAFF'});
 assert.deepEqual((await call(newToken,1,'/api/account')).data.stores.map(s=>s.id),[2]);assert.equal((await call(newToken,1,'/api/admin/orders')).status,403);
 for(const [address,expire] of [['revoked@example.test',false],['expired@example.test',true]]){
  await call(f.b,2,'/api/admin/accounts/invite',{email:address,role:'STAFF'});
  const inv=f.sqlite.prepare('SELECT * FROM store_invitation WHERE email=?').get(address);
  if(expire)f.sqlite.prepare('UPDATE store_invitation SET expires=0 WHERE id=?').run(inv.id);else await call(f.b,2,'/api/admin/accounts/revoke',{id:inv.id});
  assert.equal((await call(f.identity(address,address),2,'/api/admin/orders')).status,403);
 }
});
test('v1.8 first owner claim needs both legacy authority and designated verified email; old sessions then stop',async t=>{
 const f=await tenantFixture(t),old=f.getBearer(),claim='/api/admin/claim-account';
 assert.equal((await f.call(claim,{id_token:f.a},undefined,true,1,old)).status,403);
 const token=f.identity('primary','primary@example.test');
 assert.equal((await f.call(claim,{id_token:token},undefined,false)).status,401);
 assert.equal((await f.call(claim,{id_token:token},undefined,true,1,old)).status,200);
 assert.equal((await f.call('/api/admin/orders',undefined,undefined,true,1,old)).status,401);
 assert.equal((await f.call('/api/admin/login',{password:f.password})).status,401);
 assert.equal((await f.callTenant(token,1,'/api/account')).data.platform_role,'HQ');
 assert.equal((await f.callTenant(token,1,'/api/admin/orders')).status,200);
 assert.equal((await f.call(claim,{id_token:token},undefined,true,1,old)).status,409);
});
test('HQ creates stores from a template in v1.9; DB rejects cross-store order items',async t=>{
 const f=await tenantFixture(t),call=f.callTenant;
 assert.equal((await call(f.a,1,'/api/account/stores',{name:'금지'})).status,403);
 const store=(await call(f.hq,1,'/api/account/stores',{name:'임시 새 매장',key:randomUUID(),source_store_id:1,owner_email:'new-owner@example.test'})).data.store;
 assert.equal((await call(f.hq,store.id,'/api/menu')).data.menu.length,f.menu.length);
 const order=await paidOrder(f,f.a,1,1,5500);
 assert.throws(()=>f.sqlite.prepare('INSERT INTO order_item(id,order_id,menu_id,name,quantity,price) VALUES(?,?,?,?,1,1)').run(randomUUID(),order.id,f.bMenu,'혼합 거절'),/STORE_MISMATCH/);
 assert.throws(()=>f.sqlite.prepare('UPDATE menu SET store_id=2 WHERE id=1').run(),/STORE_MISMATCH/);
});
