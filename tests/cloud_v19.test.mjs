import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tenantFixture} from './tenant-fixture.mjs';
const opening=(extra={})=>({key:randomUUID(),name:'임시 가맹점',source_store_id:1,owner_email:'franchise@example.test',...extra});
const create=async(f,body=opening())=>{const r=await f.callTenant(f.hq,1,'/api/account/stores',body);assert.equal(r.status,200,JSON.stringify(r.data));return r.data.store;};

test('v1.9 copies complete catalog and advertising with new IDs, preserves source and resets operations',async t=>{
 const f=await tenantFixture(t),{sqlite}=f,c=f.callTenant;
 const source=(await c(f.hq,1,'/api/admin/menu')).data.menu,ids=source.map(m=>m.id).reverse(),photo='a'.repeat(64);
 sqlite.prepare('UPDATE menu SET photo_key=?,is_sold_out=1 WHERE id=?').run(photo,source[0].id);
 sqlite.prepare('INSERT INTO menu_option(menu_id,name,extra_price,active) VALUES(?,?,?,0)').run(source[0].id,'폐기 옵션',700);
 sqlite.prepare('INSERT INTO menu_display_order(id,menu_ids,revision) VALUES(1,?,9)').run(JSON.stringify(ids));
 const ads=JSON.stringify([{id:'intro',title:'신메뉴',description:'광고',enabled:true,placement:'INTRO',photo_key:photo}]);sqlite.prepare('INSERT INTO ad_catalog(id,items,revision) VALUES(1,?,5)').run(ads);
 await c(f.hq,1,'/api/admin/inventory/'+source[0].id,{enabled:true,quantity:12,low_threshold:3,revision:0,reason:'원본 입고'});
 const before=JSON.stringify(sqlite.prepare('SELECT * FROM menu WHERE store_id=1 ORDER BY id').all());
 const branch=await create(f),catalog=(await c(f.hq,branch.id,'/api/admin/menu')).data;
 assert.deepEqual(catalog.menu.map(m=>m.name),ids.map(id=>source.find(m=>m.id===id).name));
 for(const m of catalog.menu){const original=source.find(o=>o.name===m.name);assert.notEqual(m.id,original.id);for(const key of ['name','description','base_price','kind','category','choice_groups'])assert.deepEqual(m[key],original[key]);assert.equal(m.is_sold_out,0);assert.equal(m.version,0);assert.equal(m.options.length,original.options.length);m.options.forEach((o,i)=>{assert.notEqual(o.id,original.options[i].id);assert.equal(o.name,original.options[i].name);assert.equal(o.extra_price,original.options[i].extra_price);});}
 assert.equal(catalog.menu.find(m=>m.name===source[0].name).photo_key,photo);
 assert.deepEqual((await c(f.hq,branch.id,'/api/admin/categories')).data.items,(await c(f.hq,1,'/api/admin/categories')).data.items);
 assert.equal(sqlite.prepare('SELECT items FROM ad_catalog WHERE id=?').get(branch.id).items,ads);
 assert.ok((await c(f.hq,branch.id,'/api/admin/inventory')).data.items.every(i=>!i.enabled&&i.quantity===0));
 assert.equal((await c(f.hq,branch.id,'/api/admin/orders')).data.orders.length,0);
 assert.equal((await c(f.hq,branch.id,'/api/admin/promotions')).data.items.length,0);
 assert.equal(sqlite.prepare('SELECT role FROM store_invitation WHERE store_id=?').get(branch.id).role,'OWNER');
 assert.equal(JSON.stringify(sqlite.prepare('SELECT * FROM menu WHERE store_id=1 ORDER BY id').all()),before);
 assert.equal((await c(f.hq,1,'/api/admin/inventory')).data.items.find(i=>i.id===source[0].id).quantity,12);
});

test('v1.9 invited franchise owner gets all own-store operations without HQ or cross-store access',async t=>{
 const f=await tenantFixture(t),c=f.callTenant,branch=await create(f),token=f.identity('franchise-owner','franchise@example.test');
 const info=await c(token,branch.id,'/api/account');assert.equal(info.status,200);assert.deepEqual(info.data.stores.map(s=>[s.id,s.role]),[[branch.id,'OWNER']]);
 const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 for(const path of ['menu','orders','inventory','categories','ads','promotions','accounts',`sales?from=${today}&to=${today}`])assert.equal((await c(token,branch.id,'/api/admin/'+path)).status,200,path);
 assert.equal((await c(token,1,'/api/admin/menu')).status,403);assert.equal((await c(token,branch.id,'/api/account/stores')).status,403);
 assert.equal((await c(token,branch.id,'/api/account/stores',opening())).status,403);
 const source=(await c(f.hq,1,'/api/admin/menu')).data.menu,menu=(await c(token,branch.id,'/api/admin/menu')).data.menu;
 const burger=menu[0],option=burger.options[0];
 const order=await c(token,branch.id,'/api/orders',{key:randomUUID(),items:[{menu_id:burger.id,quantity:1,options:[option.id],expected_unit:burger.base_price+option.extra_price}]});assert.equal(order.status,200,JSON.stringify(order.data));
 const paid=await c(token,branch.id,`/api/orders/${order.data.id}/attempts`,{key:randomUUID(),demo_result:'success'});assert.equal(paid.status,200);assert.equal(paid.data.number,1);
 await c(token,branch.id,'/api/admin/menu/'+burger.id,{base_price:9999,is_sold_out:false,version:burger.version});
 assert.equal((await c(f.hq,1,'/api/admin/menu')).data.menu[0].base_price,source[0].base_price);
 assert.equal((await c(f.hq,1,'/api/admin/orders')).data.orders.length,0);
 const stats=(await c(f.hq,1,'/api/account/stores')).data.stores.find(s=>s.id===branch.id);assert.equal(stats.owner_count,1);assert.equal(stats.pending_owners,0);
});

test('v1.9 racing retries create one store, catalog, owner invitation and audit record',async t=>{
 const f=await tenantFixture(t),body=opening();
 const [a,b]=await Promise.all([create(f,body),create(f,body)]);assert.equal(a.id,b.id);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM menu WHERE store_id=?').get(a.id).n,f.menu.length);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM store_invitation WHERE store_id=?').get(a.id).n,1);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM account_audit WHERE store_id=? AND action='FRANCHISE_OPEN'").get(a.id).n,1);
 assert.equal((await f.callTenant(f.hq,1,'/api/account/stores',{...body,name:'다른 요청'})).status,409);
 const next=await create(f,opening({name:'다른 가맹점',owner_email:'other@example.test'}));assert.notEqual(next.id,a.id);
 assert.ok(f.sqlite.prepare('SELECT id FROM menu WHERE store_id=?').all(a.id).every(x=>!f.sqlite.prepare('SELECT 1 FROM menu WHERE id=? AND store_id=?').get(x.id,next.id)));
});

test('v1.9 failed invitation rolls back the entire opening transaction',async t=>{
 const f=await tenantFixture(t),body=opening({owner_email:'fail@example.test'}),before=f.sqlite.prepare('SELECT count(*) n FROM store').get().n,menus=f.sqlite.prepare('SELECT count(*) n FROM menu').get().n;
 f.sqlite.exec("CREATE TRIGGER fail_invite BEFORE INSERT ON store_invitation WHEN NEW.email='fail@example.test' BEGIN SELECT RAISE(ABORT,'test rollback');END");
 assert.equal((await f.callTenant(f.hq,1,'/api/account/stores',body)).status,503);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM store').get().n,before);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM menu').get().n,menus);
 assert.equal(f.sqlite.prepare('SELECT id FROM store WHERE opening_key=?').get(body.key),undefined);
 f.sqlite.exec('DROP TRIGGER fail_invite');await create(f,body);
});

test('v1.9 rejects invalid openings and non-HQ listing before writes',async t=>{
 const f=await tenantFixture(t),before=f.sqlite.prepare('SELECT count(*) n FROM store').get().n;
 for(const body of [{name:'이전 화면 요청'},opening({owner_email:'invalid'}),opening({key:'short'}),opening({source_store_id:0})])assert.equal((await f.callTenant(f.hq,1,'/api/account/stores',body)).status,400);
 assert.equal((await f.callTenant(f.hq,1,'/api/account/stores',opening({source_store_id:999}))).status,409);
 for(const token of [f.a,f.b,f.staff])assert.equal((await f.callTenant(token,1,'/api/account/stores')).status,403);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM store').get().n,before);
});
