import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tenantFixture} from './tenant-fixture.mjs';
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const c=(f,token,store,path,body)=>f.callTenant(token,store,path,body);
async function ingredient(f,extra={}){return ok(await c(f,f.hq,1,'/api/account/supply/ingredients',{key:randomUUID(),name:'소고기 패티',unit:'장',pack_label:'박스',pack_size:100,active:true,...extra}));}
const request=(f,items,store=1,extra={})=>c(f,store===1?f.a:f.b,store,'/api/admin/supply',{key:randomUUID(),note:'행사 준비',lines:items.map(([i,packs])=>({ingredient_id:i.id,packs,revision:i.revision})),...extra});
const step=(f,o,action,note='')=>c(f,f.hq,1,'/api/account/supply/orders/'+o.id,{action,revision:o.revision,note});
async function shipped(f,items,store=1){let o=ok(await request(f,items,store)).order;o=ok(await step(f,o,'approve')).order;return ok(await step(f,o,'ship')).order;}
const receive=(f,o,lines,extra={})=>c(f,o.store_id===1?f.a:f.b,o.store_id,'/api/admin/supply/'+o.id+'/receive',{key:randomUUID(),revision:o.revision,note:'검수 완료',lines:lines.map(([l,quantity])=>({line_id:l.id,quantity})),...extra});
const qty=(f,store,id)=>f.sqlite.prepare('SELECT quantity FROM ingredient_stock WHERE store_id=? AND ingredient_id=?').get(store,id)?.quantity??0;
test('v1.11 HQ ingredient registry validates units, locks specifications and rejects stale updates/owners',async t=>{
 const f=await tenantFixture(t),body={key:randomUUID(),name:'패티',unit:'장',pack_label:'박스',pack_size:100,active:true};
 const i=ok(await c(f,f.hq,1,'/api/account/supply/ingredients',body));assert.equal(ok(await c(f,f.hq,1,'/api/account/supply/ingredients',body)).id,i.id);
 assert.equal((await c(f,f.hq,1,'/api/account/supply/ingredients',{...body,pack_size:50})).status,409);
 for(const extra of [{pack_size:0},{pack_size:1.5},{unit:'무제한'},{name:''}])assert.equal((await c(f,f.hq,1,'/api/account/supply/ingredients',{...body,key:randomUUID(),...extra})).status,400);
 assert.equal((await c(f,f.a,1,'/api/account/supply/ingredients',body)).status,403);
 assert.equal((await c(f,f.hq,1,'/api/account/supply/ingredients/'+i.id,{name:'패티',active:true,revision:0,pack_size:200})).status,400);
 ok(await c(f,f.hq,1,'/api/account/supply/ingredients/'+i.id,{name:'본사 패티',active:true,revision:0}));
 assert.equal((await c(f,f.hq,1,'/api/account/supply/ingredients/'+i.id,{name:'패티',active:true,revision:0})).status,409);
});
test('v1.11 HQ aggregates two stores and inventory changes only on partial/final receipt',async t=>{
 const f=await tenantFixture(t),i=await ingredient(f),bun=await ingredient(f,{name:'버거 번',unit:'개',pack_size:50});
 let a=ok(await request(f,[[i,2],[bun,1]])).order,b=ok(await request(f,[[i,3]],2)).order;
 let summary=ok(await c(f,f.hq,1,'/api/account/supply')).summary.find(s=>s.id===i.id);assert.equal(summary.requested_packs,5);assert.equal(summary.open_units,500);assert.equal(summary.stores,2);
 for(const action of ['approve','ship']){a=ok(await step(f,a,action)).order;assert.equal(qty(f,1,i.id),0);}
 let result=ok(await receive(f,a,[[a.lines.find(l=>l.ingredient_id===i.id),180],[a.lines.find(l=>l.ingredient_id===bun.id),50]]));a=result.order;assert.equal(a.status,'PARTIAL');assert.equal(qty(f,1,i.id),180);assert.equal(qty(f,1,bun.id),50);assert.equal(qty(f,2,i.id),0);
 summary=ok(await c(f,f.hq,1,'/api/account/supply')).summary.find(s=>s.id===i.id);assert.equal(summary.in_transit_units,20);assert.equal(summary.requested_packs,3);assert.equal(summary.open_units,320);
 a=ok(await receive(f,a,[[a.lines.find(l=>l.ingredient_id===i.id),20]])).order;assert.equal(a.status,'RECEIVED');assert.equal(qty(f,1,i.id),200);
 b=ok(await step(f,b,'reject','공급 일정 조정')).order;assert.equal(b.status,'REJECTED');assert.equal(ok(await c(f,f.hq,1,'/api/account/supply')).summary.length,0);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM ingredient_movement WHERE kind='RECEIPT'").get().n,3);
});
test('v1.11 repeated/concurrent request and receipt apply exactly once and changed payload conflicts',async t=>{
 const f=await tenantFixture(t),i=await ingredient(f),key=randomUUID();
 const rs=await Promise.all([request(f,[[i,2]],1,{key}),request(f,[[i,2]],1,{key})]);let a=ok(rs[0]).order;assert.equal(ok(rs[1]).order.id,a.id);assert.equal((await request(f,[[i,3]],1,{key})).status,409);
 a=ok(await step(f,a,'approve')).order;a=ok(await step(f,a,'ship')).order;const receiptKey=randomUUID();
 const receipts=await Promise.all([receive(f,a,[[a.lines[0],100]],{key:receiptKey}),receive(f,a,[[a.lines[0],100]],{key:receiptKey})]);assert.equal(ok(receipts[0]).receipt_id,ok(receipts[1]).receipt_id);assert.equal(qty(f,1,i.id),100);
 assert.equal((await receive(f,a,[[a.lines[0],99]],{key:receiptKey})).status,409);
 assert.equal((await receive(f,a,[[a.lines[0],100]])).status,409);
 const current=ok(receipts[0]).order,competing=await Promise.all([receive(f,current,[[current.lines[0],100]]),receive(f,current,[[current.lines[0],100]])]);assert.deepEqual(competing.map(r=>r.status).sort(),[200,409]);assert.equal(qty(f,1,i.id),200);
});
test('v1.11 unauthorized owners/staff cannot read, transition, receive or inspect other stores',async t=>{
 const f=await tenantFixture(t),i=await ingredient(f),o=await shipped(f,[[i,1]],2);
 for(const [token,store,path,body]of [[f.a,2,'/api/admin/ingredients'],[f.a,1,'/api/admin/supply/'+o.id],[f.staff,2,'/api/admin/supply'],[f.a,1,'/api/account/supply'],[f.b,2,'/api/account/supply/orders/'+o.id,{action:'approve',revision:0}],[f.a,1,'/api/admin/supply/'+o.id+'/receive',{key:randomUUID(),revision:o.revision,lines:[{line_id:o.lines[0].id,quantity:1}]}]])assert.ok([403,404].includes((await c(f,token,store,path,body)).status),path);
 assert.equal((await c(f,f.b,2,'/api/admin/supply/'+o.id,{action:'ship',revision:o.revision})).status,400);assert.equal(qty(f,2,i.id),0);
});
test('v1.11 quantities, stale catalog, inactive items and illegal transitions reject without partial writes',async t=>{
 const f=await tenantFixture(t),i=await ingredient(f),o=ok(await request(f,[[i,1]])).order;
 assert.equal((await receive(f,o,[[o.lines[0],1]])).status,409);assert.equal((await step(f,o,'ship')).status,409);
 assert.equal((await request(f,[[i,0]])).status,400);assert.equal((await request(f,[[i,1.1]])).status,400);assert.equal((await request(f,[[i,1],[i,2]])).status,400);
 ok(await c(f,f.hq,1,'/api/account/supply/ingredients/'+i.id,{name:i.name,active:false,revision:0}));assert.equal((await request(f,[[i,1]])).status,409);
 let shippedOrder=ok(await step(f,o,'approve')).order;shippedOrder=ok(await step(f,shippedOrder,'ship')).order;
 assert.equal((await receive(f,shippedOrder,[[shippedOrder.lines[0],101]])).status,409);
 assert.equal((await receive(f,shippedOrder,[[shippedOrder.lines[0],-1]])).status,400);
 assert.equal((await receive(f,shippedOrder,[[{id:randomUUID()},1]])).status,409);
 assert.equal(qty(f,1,i.id),0);ok(await receive(f,shippedOrder,[[shippedOrder.lines[0],100]]));assert.equal(qty(f,1,i.id),100,'inactivation must not block previously shipped goods');
});
test('v1.11 multi-line receipt failure rolls back receipt, quantities, movements and order state',async t=>{
 const f=await tenantFixture(t),a=await ingredient(f),b=await ingredient(f,{name:'번'}),o=await shipped(f,[[a,1],[b,1]]),key=randomUUID();
 f.sqlite.exec("CREATE TRIGGER receipt_test_abort BEFORE INSERT ON ingredient_movement WHEN NEW.kind='RECEIPT' BEGIN SELECT RAISE(ABORT,'forced rollback'); END;");
 assert.equal((await receive(f,o,o.lines.map(l=>[l,100]),{key})).status,503);
 for(const table of ['supply_receipt','supply_receipt_line','ingredient_stock','ingredient_movement'])assert.equal(f.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,0,table);
 assert.equal(f.sqlite.prepare('SELECT status FROM supply_order WHERE id=?').get(o.id).status,'SHIPPED');assert.equal(f.sqlite.prepare('SELECT sum(received_units) n FROM supply_line').get().n,0);
 f.sqlite.exec('DROP TRIGGER receipt_test_abort');ok(await receive(f,o,o.lines.map(l=>[l,100]),{key}));assert.equal(qty(f,1,a.id),100);assert.equal(qty(f,1,b.id),100);
});
test('v1.11 manual stock correction is versioned, bounded and preserves menu inventory and customer orders',async t=>{
 const f=await tenantFixture(t),i=await ingredient(f);const preserved=()=>JSON.stringify(['menu','orders','payment','inventory','menu_option'].map(t=>[t,f.sqlite.prepare('SELECT * FROM '+t).all()]));const before=preserved();
 ok(await c(f,f.a,1,'/api/admin/ingredients/'+i.id,{quantity:30,low_threshold:10,revision:0,reason:'초기 실사'}));
 const o=await shipped(f,[[i,1]]);ok(await receive(f,o,[[o.lines[0],100]]));assert.equal(qty(f,1,i.id),130);
 assert.equal((await c(f,f.a,1,'/api/admin/ingredients/'+i.id,{quantity:20,low_threshold:10,revision:1,reason:'오래된 실사'})).status,409);
 ok(await c(f,f.a,1,'/api/admin/ingredients/'+i.id,{quantity:120,low_threshold:20,revision:2,reason:'패티 10장 사용'}));assert.equal(qty(f,1,i.id),120);
 assert.equal((await c(f,f.a,1,'/api/admin/ingredients/'+i.id,{quantity:-1,low_threshold:0,revision:3,reason:'오류'})).status,400);
 assert.equal(preserved(),before);assert.equal(qty(f,2,i.id),0);
});
test('v1.11 cancel/approve race has one winner, rejection reasons required, totals span pages',async t=>{
 const f=await tenantFixture(t),i=await ingredient(f);let o=ok(await request(f,[[i,1]])).order;
 assert.equal((await step(f,o,'reject')).status,400);
 const results=await Promise.all([step(f,o,'approve'),c(f,f.a,1,'/api/admin/supply/'+o.id,{action:'cancel',revision:0,note:'일정 변경'})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 for(let n=0;n<51;n++)ok(await request(f,[[i,1]]));
 const hq=ok(await c(f,f.hq,1,'/api/account/supply?status=REQUESTED&page=0'));assert.equal(hq.orders.length,50);assert.equal(hq.total,51);assert.equal(hq.summary[0].requested_packs,51);
 assert.equal(ok(await c(f,f.hq,1,'/api/account/supply?status=REQUESTED&page=1')).orders.length,1);
 assert.equal((await c(f,f.a,1,'/api/admin/supply?status=bad&page=-1')).status,400);
});
test('v1.11 twenty ingredient receipt and inventory capacity guards are atomic',async t=>{
 const f=await tenantFixture(t),items=[];for(let n=0;n<20;n++)items.push([await ingredient(f,{name:'재료 '+n,pack_size:1}),1]);
 const o=await shipped(f,items);ok(await receive(f,o,o.lines.map(l=>[l,1])));assert.equal(f.sqlite.prepare('SELECT sum(quantity) n FROM ingredient_stock').get().n,20);
 const i=items[0][0];ok(await c(f,f.a,1,'/api/admin/ingredients/'+i.id,{quantity:1000000000,low_threshold:0,revision:1,reason:'상한 검증'}));
 const tooMuch=await shipped(f,[[i,1]]);assert.equal((await receive(f,tooMuch,[[tooMuch.lines[0],1]])).status,409);assert.equal(qty(f,1,i.id),1000000000);
});
