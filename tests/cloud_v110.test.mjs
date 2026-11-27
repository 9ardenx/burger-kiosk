import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {tenantFixture} from './tenant-fixture.mjs';
import {suggestStoreName} from '../docs/assets/store-naming.js';
const address={address:'경기도 용인시 처인구 모현읍 외대로 81',address_detail:'1층',locality:''};
const opening=(extra={})=>({key:randomUUID(),source_store_id:1,owner_email:'shop@example.test',...address,...extra});
async function open(f,body=opening()){const r=await f.callTenant(f.hq,1,'/api/account/stores',body);assert.equal(r.status,200,JSON.stringify(r.data));return r.data.store;}
const report=(f,from='2026-11-01',to='2026-11-30',store='all',token=f.hq)=>f.callTenant(token,1,`/api/account/sales?from=${from}&to=${to}&store=${store}`);
async function paid(f,store,menu,qty=1,options=[],selections=[]){
 const response=await f.callTenant(f.hq,store,'/api/orders',{key:randomUUID(),items:[{menu_id:menu.id,quantity:qty,options:options.map(o=>o.id),selections,expected_unit:menu.base_price+options.reduce((n,o)=>n+o.extra_price,0)}]});assert.equal(response.status,200,JSON.stringify(response.data));
 assert.equal((await f.callTenant(f.hq,store,`/api/orders/${response.data.id}/attempts`,{key:randomUUID(),demo_result:'success'})).status,200);
 f.sqlite.prepare("UPDATE payment SET created_at='2026-11-10 03:00:00' WHERE order_id=? AND status='SUCCESS'").run(response.data.id);return response.data.id;
}
test('v1.10 address naming supports city, district, county and locality fallback',()=>{
 for(const [a,l,want] of [[address.address,'','용인모현점'],['경기도 성남시 분당구 서현로 170 (서현동)','','분당서현점'],['경기도 성남시 분당구 서현로 170','서현동','분당서현점'],['서울특별시 강남구 테헤란로 123 (역삼동)','','강남역삼점'],['경기도 양평군 양평읍 시민로 1','','양평양평점'],['세종특별자치시 한누리대로 1','나성동','세종나성점'],['경기도 성남시 분당구 서현로 170','','']])assert.equal(suggestStoreName(a,l),want);
});
test('v1.10 simultaneous same-area opening reserves suffixes and retries preserve identity',async t=>{
 const f=await tenantFixture(t),body=opening();
 const [a,b,c]=await Promise.all([open(f,body),open(f,opening()),open(f,opening())]);
 assert.deepEqual([a.name,b.name,c.name].sort(),['용인모현점','용인모현2점','용인모현3점'].sort());
 assert.equal((await open(f,body)).id,a.id);
 assert.equal((await f.callTenant(f.hq,1,'/api/account/stores',{...body,address_detail:'2층'})).status,409);
 const row=f.sqlite.prepare('SELECT * FROM store WHERE id=?').get(a.id);assert.equal(row.address,address.address);assert.equal(row.address_detail,'1층');
});
test('v1.10 deferred owner address onboarding, collision, revision, and role isolation',async t=>{
 const f=await tenantFixture(t),first=await open(f),branch=await open(f,opening({address:'',address_pending:true})),token=f.identity('shop','shop@example.test');
 assert.equal(branch.name,'가입대기점');
 const info=(await f.callTenant(token,branch.id,'/api/account')).data;assert.equal(info.stores.find(s=>s.id===branch.id).address_pending,1);
 const before=JSON.stringify(f.sqlite.prepare('SELECT * FROM menu ORDER BY id').all());
 const change={...address,revision:0};
 const r=await f.callTenant(token,branch.id,'/api/admin/store-profile',change);assert.equal(r.status,200);assert.equal(r.data.store.name,'용인모현2점');assert.equal(r.data.store.address_pending,0);
 assert.equal((await f.callTenant(token,branch.id,'/api/admin/store-profile',change)).status,409);
 assert.equal((await f.callTenant(token,1,'/api/admin/store-profile',change)).status,403);
 assert.equal((await f.callTenant(f.staff,2,'/api/admin/store-profile',change)).status,403);
 assert.equal((await f.callTenant(token,branch.id,'/api/admin/store-profile',{...change,revision:1,name:'본사이름'})).status,403);
 const r2=await f.callTenant(token,branch.id,'/api/admin/store-profile',{...change,address:'경기도 성남시 분당구 서현로 170',locality:'서현동',revision:1,auto_name:false});assert.equal(r2.data.store.name,'용인모현2점');
 assert.equal(JSON.stringify(f.sqlite.prepare('SELECT * FROM menu ORDER BY id').all()),before);assert.equal(f.sqlite.prepare('SELECT name FROM store WHERE id=?').get(first.id).name,'용인모현점');
});
test('v1.10 invalid address cannot partially create or change a store',async t=>{
 const f=await tenantFixture(t),n=f.sqlite.prepare('SELECT count(*) n FROM store').get().n;
 for(const extra of [{address:'잘못된 주소'},{address:'경기도 성남시 분당구 서현로 170',locality:''},{address_detail:'\n'},{locality:'<script>동'}])assert.equal((await f.callTenant(f.hq,1,'/api/account/stores',opening(extra))).status,400);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM store').get().n,n);
});
test('v1.10 HQ totals reconcile with stores, combine copied products, separate unrelated same names',async t=>{
 const f=await tenantFixture(t),branch=await open(f),a=(await f.callTenant(f.hq,1,'/api/admin/menu')).data.menu[0],b=(await f.callTenant(f.hq,branch.id,'/api/admin/menu')).data.menu[0];
 await paid(f,1,a,2,[a.options[0]]);await paid(f,branch.id,b,3);
 f.sqlite.prepare('UPDATE menu SET name=? WHERE id=?').run('가맹점에서 바꾼 표시 이름',b.id);
 f.sqlite.prepare('UPDATE menu SET name=? WHERE id=?').run(a.name,f.bMenu);
 const unrelated=(await f.callTenant(f.hq,2,'/api/admin/menu')).data.menu[0];await paid(f,2,unrelated);
 const r=await report(f);assert.equal(r.status,200,JSON.stringify(r.data));const d=r.data;
 assert.equal(d.summary.orders,3);assert.equal(d.summary.net,2*(a.base_price+a.options[0].extra_price)+3*b.base_price+unrelated.base_price);
 assert.equal(d.stores.reduce((n,s)=>n+s.net,0),d.summary.net);assert.equal(d.daily.reduce((n,s)=>n+s.net,0),d.summary.net);assert.equal(d.menus.reduce((n,s)=>n+s.net,0),d.summary.net);
 assert.equal(d.menus.length,2);assert.equal(d.menus.find(m=>m.code==='MENU-'+a.id).net_quantity,5);
 assert.equal((await report(f,'2026-11-01','2026-11-30',String(branch.id))).data.summary.net,3*b.base_price);
 for(const token of [f.a,f.b,f.staff])assert.equal((await report(f,undefined,undefined,undefined,token)).status,403);
});
test('v1.10 KST boundary, cancellation event date, zero stores and disabled store history',async t=>{
 const f=await tenantFixture(t),m=(await f.callTenant(f.hq,1,'/api/admin/menu')).data.menu[0],id=await paid(f,1,m);
 f.sqlite.prepare("UPDATE payment SET created_at='2026-11-09 15:00:00' WHERE order_id=? AND status='SUCCESS'").run(id);
 f.sqlite.prepare("UPDATE orders SET cancelled_at='2026-11-10 15:00:00',status='CANCELLED' WHERE id=?").run(id);
 assert.equal((await report(f,'2026-11-09','2026-11-09')).data.summary.net,0);
 assert.equal((await report(f,'2026-11-10','2026-11-10')).data.summary.net,m.base_price);
 const cancel=(await report(f,'2026-11-11','2026-11-11')).data;assert.equal(cancel.summary.net,-m.base_price);assert.equal(cancel.menus[0].net_quantity,-1);assert.equal(cancel.stores.find(s=>s.id===2).net,0);
 f.sqlite.prepare('UPDATE store SET enabled=0 WHERE id=1').run();assert.equal((await report(f,'2026-11-10','2026-11-10')).data.summary.net,m.base_price);
 assert.equal((await report(f,'2026-11-30','2026-11-01')).status,400);assert.equal((await report(f,'2025-01-01','2026-11-30')).status,400);assert.equal((await report(f,undefined,undefined,'999')).status,404);
});
test('v1.10 pending, failed and future non-demo payments excluded, option snapshots included',async t=>{
 const f=await tenantFixture(t),m=(await f.callTenant(f.hq,1,'/api/admin/menu')).data.menu[0],id=await paid(f,1,m,2,[m.options[0]]);
 const pending=await f.callTenant(f.hq,1,'/api/orders',{key:randomUUID(),items:[{menu_id:m.id,quantity:1,options:[],expected_unit:m.base_price}]});assert.equal(pending.status,200);
 f.sqlite.prepare('UPDATE order_item SET choice_snapshot=?,price=price-100 WHERE order_id=?').run(JSON.stringify([{option_price:100}]),id);
 const d=(await report(f)).data;assert.equal(d.menus[0].net,d.summary.net);assert.equal(d.summary.orders,1);
 f.sqlite.prepare("UPDATE payment SET mode='live' WHERE order_id=?").run(id);assert.equal((await report(f)).data.summary.net,0);
 f.sqlite.prepare("UPDATE payment SET mode='demo',status='FAILED' WHERE order_id=?").run(id);assert.equal((await report(f)).data.summary.net,0);
});
test('v1.10 migration preserves existing rows, duplicate names and proven copy lineage',()=>{
 const db=new DatabaseSync(':memory:');try{
 for(const file of ['schema.sql','catalog-migration.sql','choices-migration.sql','v12-migration.sql','admin-cancel-migration.sql','v14-migration.sql','v15-migration.sql','v16-migration.sql','inventory-triggers.sql','v17-migration.sql','v18-migration.sql','v19-migration.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
 db.exec("INSERT INTO store(id,name,opening_tag,template_store_id) VALUES(2,'기존 중복점','abc',1),(3,'기존 중복점','def',2); INSERT INTO menu(id,name,description,kind,base_price,store_id,registration_key,photo_key) VALUES(1,'원본','설명','classic',5500,1,'old','original-photo'),(2,'다른 표시 이름','설명','classic',5500,2,'franchise:abc:1','original-photo'),(3,'3차 복사','설명','classic',5500,3,'franchise:def:2','original-photo');");
 const before=JSON.stringify(db.prepare('SELECT * FROM menu').all()),stores=db.prepare('SELECT * FROM store').all();
 db.exec(readFileSync(new URL('../cloud/v110-migration.sql',import.meta.url),'utf8'));
 assert.equal(JSON.stringify(db.prepare('SELECT * FROM menu').all()),before);for(const old of stores){const current=db.prepare('SELECT * FROM store WHERE id=?').get(old.id);for(const [key,value]of Object.entries(old))assert.equal(current[key],value);}
 assert.deepEqual(db.prepare('SELECT product_code FROM menu_identity ORDER BY menu_id').all().map(m=>m.product_code),['MENU-1','MENU-1','MENU-1']);
 }finally{db.close();}
});
