import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {handleKiosk} from '../cloud/api.mjs';

// Exercise the real Worker routes and SQL with an in-memory SQLite D1 adapter.
async function setup(t) {
  const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
  for(const file of ['schema.sql','catalog-migration.sql','choices-migration.sql','v12-migration.sql','admin-cancel-migration.sql'])
    sqlite.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
  const DB={prepare(sql){
    const make=args=>({sql,bind:(...values)=>make(values),
      async all(){return {results:sqlite.prepare(sql).all(...args),meta:{changes:0}};},
      async first(){return sqlite.prepare(sql).get(...args)??null;},
      async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};},
      execute(){return /^\s*SELECT/i.test(sql)?{results:sqlite.prepare(sql).all(...args),meta:{changes:0}}:
        {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};}
    });return make([]);
  },async batch(commands){sqlite.exec('BEGIN');try{const result=commands.map(c=>c.execute());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  const password='isolated-test-password', env={DB,KIOSK_ADMIN_HASH:createHash('sha256').update(password).digest('hex')};
  let bearer='';
  async function call(path,body,customer='test-customer-session-0001',admin=true){
    const headers={'X-Kiosk-Session':customer};
    if(bearer&&admin)headers.Authorization='Bearer '+bearer;
    if(body!==undefined)headers['Content-Type']='application/json';
    const response=await handleKiosk(new Request('https://test.invalid'+path,{headers,method:body===undefined?'GET':'POST',body:body===undefined?undefined:JSON.stringify(body)}),env);
    return {status:response.status,data:await response.json()};
  }
  const login=await call('/api/admin/login',{password});assert.equal(login.status,200);bearer=login.data.token;
  const menu=(await call('/api/menu')).data.menu;
  async function create(){const item=menu[0];const result=await call('/api/orders',{key:randomUUID(),items:[{menu_id:item.id,quantity:1,options:[],expected_unit:item.base_price,expected_version:item.version}]});assert.equal(result.status,200);return result.data;}
  const pay=(id,result='success')=>call(`/api/orders/${id}/attempts`,{key:randomUUID(),demo_result:result});
  return {sqlite,call,menu,create,pay};
}

test('Worker persists full menu order and rejects stale, missing or duplicate IDs',async t=>{
  const {call,menu}=await setup(t), ids=menu.map(m=>m.id).reverse();
  assert.equal((await call('/api/admin/menu-order',{ids,revision:0})).status,200);
  const saved=(await call('/api/admin/menu')).data;
  assert.deepEqual(saved.menu.map(m=>m.id),ids);assert.equal(saved.order_revision,1);
  assert.deepEqual(saved.menu,menu.toReversed());
  assert.equal((await call('/api/admin/menu-order',{ids:ids.toReversed(),revision:0})).status,409);
  assert.equal((await call('/api/admin/menu-order',{ids:ids.slice(1),revision:1})).status,409);
  assert.equal((await call('/api/admin/menu-order',{ids:[ids[0],ids[0]],revision:1})).status,400);
  assert.deepEqual((await call('/api/menu')).data.menu.map(m=>m.id),ids);
});

test('Worker cancellation after decline blocks old payment attempts and does not enter kitchen',async t=>{
  const {call,create,pay}=await setup(t), order=await create();
  assert.equal((await pay(order.id,'failure')).status,200);
  assert.equal((await call(`/api/orders/${order.id}/cancel`,{},'different-customer-session')).status,404);
  for(let i=0;i<2;i++)assert.equal((await call(`/api/orders/${order.id}/cancel`,{})).data.status,'CANCELLED');
  assert.equal((await pay(order.id)).data.code,'ORDER_CANCELLED');
  assert.deepEqual((await call('/api/admin/orders')).data.orders,[]);
});

test('Worker refuses cancellation of paid or uncertain payments',async t=>{
  const {sqlite,call,create,pay}=await setup(t), a=await create(), b=await create();
  await pay(a.id);
  sqlite.prepare("INSERT INTO payment(id,order_id,status,amount) VALUES(?,?,'PENDING',?)").run(randomUUID(),b.id,b.total);
  for(const order of [a,b])assert.equal((await call(`/api/orders/${order.id}/cancel`,{})).data.code,'PAYMENT_IN_PROGRESS');
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM orders WHERE cancelled_at IS NOT NULL').get().n,0);
});

test('Worker changes only the selected kitchen order and rejects duplicate state transition',async t=>{
  const {call,create,pay}=await setup(t), a=await create(), b=await create();
  await pay(a.id);await pay(b.id);
  const updated=await call(`/api/admin/orders/${a.id}`,{expected:'PAID'});
  assert.equal(updated.data.order.status,'PREPARING');
  assert.equal((await call(`/api/admin/orders/${a.id}`,{expected:'PAID'})).status,409);
  assert.equal((await call(`/api/orders/${b.id}`)).data.status,'PAID');
});

test('Worker sold-out menus remain in place and cannot be ordered or paid',async t=>{
  const {call,create,pay,menu}=await setup(t),pending=await create(),item=menu[0];
  assert.equal((await call('/api/admin/menu/'+item.id,{version:item.version,base_price:item.base_price,is_sold_out:true})).status,200);
  const listed=(await call('/api/menu')).data.menu;
  assert.deepEqual(listed.map(m=>m.id),menu.map(m=>m.id));assert.equal(listed[0].is_sold_out,1);
  const rejected=await call('/api/orders',{key:randomUUID(),items:[{menu_id:item.id,quantity:1,options:[],expected_unit:item.base_price}]});
  assert.equal(rejected.data.code,'CART_CHANGED');assert.equal((await pay(pending.id)).data.code,'CART_CHANGED');
  assert.equal((await call('/api/admin/menu/'+item.id,{version:listed[0].version,base_price:item.base_price,is_sold_out:false})).status,200);
  assert.equal((await pay(pending.id)).data.status,'PAID');
});

test('Worker admin cancellation records reason, is idempotent and retains historical approval',async t=>{
  const {call,create,pay,sqlite}=await setup(t),a=await create(),b=await create();await pay(a.id);await pay(b.id);
  const url=`/api/admin/orders/${a.id}/cancel`,body={expected:'PAID',reason:'재료 소진'};
  assert.equal((await call(url,body,undefined,false)).status,401);
  assert.equal((await call(url,{...body,reason:' '})).status,400);
  const cancelled=(await call(url,body)).data.order;
  assert.equal(cancelled.status,'CANCELLED');assert.equal(cancelled.cancel_reason,body.reason);assert.equal(cancelled.cancelled_by,'admin');assert.ok(cancelled.cancelled_at);
  assert.deepEqual((await call(url,{...body,reason:'다른 사유'})).data.order,cancelled);
  assert.equal((await call(`/api/admin/orders/${a.id}`,{expected:'PAID'})).status,409);
  assert.equal((await pay(a.id)).data.code,'ORDER_CANCELLED');
  assert.equal((await call('/api/orders/'+b.id)).data.status,'PAID');
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM payment WHERE order_id=? AND status='SUCCESS'").get(a.id).n,1);
});

test('Worker cancellation rejects PG, completed, unpaid and stale orders',async t=>{
  const {call,create,pay,sqlite}=await setup(t);
  for(const type of ['pg','done','unpaid','stale']){
    const o=await create();if(type!=='unpaid')await pay(o.id);
    if(type==='pg')sqlite.prepare("UPDATE payment SET mode='toss' WHERE order_id=?").run(o.id);
    if(type==='done')sqlite.prepare("UPDATE orders SET status='COMPLETED' WHERE id=?").run(o.id);
    if(type==='stale')await call('/api/admin/orders/'+o.id,{expected:'PAID'});
    assert.equal((await call(`/api/admin/orders/${o.id}/cancel`,{expected:'PAID',reason:'요청 취소'})).status,409);
    assert.equal(sqlite.prepare('SELECT cancelled_at FROM orders WHERE id=?').get(o.id).cancelled_at,null);
  }
});

test('Worker kitchen progression racing cancellation has one accepted transition',async t=>{
  const {call,create,pay}=await setup(t),o=await create();await pay(o.id);
  const outcomes=await Promise.all([call(`/api/admin/orders/${o.id}/cancel`,{expected:'PAID',reason:'재료 소진'}),call('/api/admin/orders/'+o.id,{expected:'PAID'})]);
  assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);
});
