import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {handleKiosk} from '../cloud/api.mjs';

// Exercise the real Worker routes and SQL with an in-memory SQLite D1 adapter.
async function setup(t) {
  const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
  for(const file of ['schema.sql','catalog-migration.sql','choices-migration.sql','v12-migration.sql','admin-cancel-migration.sql','v14-migration.sql','v15-migration.sql'])
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
  const images=new Map(),BUCKET={async put(key,bytes){images.set(key,new Uint8Array(bytes));},async get(key){return images.has(key)?{body:images.get(key)}:null;}};
  const password='isolated-test-password', env={DB,BUCKET,KIOSK_ADMIN_HASH:createHash('sha256').update(password).digest('hex')};
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
  return {sqlite,call,menu,create,pay,env,setBearer:value=>bearer=value,getBearer:()=>bearer,password};
}

test('v1.5 advertisements create, edit, hide, reorder and delete without touching menus or orders',async t=>{
  const {call,create,env}=await setup(t),before=(await call('/api/admin/menu')).data,order=await create();
  const photo=readFileSync(new URL('../assets/menu/published/classic-burger.jpg',import.meta.url)).toString('base64');
  const item={id:randomUUID(),title:'신제품 <안내>',description:'소개 문구',enabled:true,photo};
  const saved=await call('/api/admin/ads',{items:[item],revision:0});assert.equal(saved.status,200);assert.equal('photo' in saved.data.items[0],false);
  const key=saved.data.items[0].photo_key;
  const image=await handleKiosk(new Request('https://test.invalid/api/ad-photos/'+key),env);assert.equal(image.status,200);assert.equal(Buffer.from(await image.arrayBuffer()).toString('base64'),photo);
  const second={...item,id:randomUUID(),title:'두 번째'};
  const two=(await call('/api/admin/ads',{items:[second,{...saved.data.items[0],title:'수정',enabled:false}],revision:1})).data;
  assert.deepEqual((await call('/api/ads')).data.items.map(a=>a.id),[second.id]);
  const reversed=await call('/api/admin/ads',{items:two.items.toReversed(),revision:2});assert.equal(reversed.status,200);
  assert.equal(reversed.data.items[0].photo_key,key);
  assert.equal((await call('/api/admin/ads',{items:[],revision:3})).status,200);assert.deepEqual((await call('/api/ads')).data.items,[]);
  assert.deepEqual((await call('/api/admin/menu')).data,before);assert.deepEqual((await call('/api/orders/'+order.id)).data,order);
});
test('v1.5 ads reject unauthenticated, stale and malformed requests; concurrent edits have one winner',async t=>{
  const {call}=await setup(t);
  assert.equal((await call('/api/admin/ads',{items:[],revision:0},undefined,false)).status,401);
  assert.equal((await call('/api/admin/ads',{items:[{id:randomUUID(),title:'a',description:'',enabled:true,photo:'not-an-image'}],revision:0})).status,400);
  const results=await Promise.all([call('/api/admin/ads',{items:[],revision:0}),call('/api/admin/ads',{items:[],revision:0})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal((await call('/api/admin/ads',{items:[],revision:0})).status,409);
  assert.equal((await call('/api/admin/ads',{items:Array(11).fill({}),revision:1})).status,400);
  assert.equal((await call('/api/admin/ads')).data.revision,1);
});
test('v1.5 dining choice persists through payment, kitchen and cancellation and cannot change on retry',async t=>{
  const {call,pay}=await setup(t);
  for(const dining_type of ['DINE_IN','TAKEOUT']){
    const body={key:randomUUID(),dining_type,items:[{menu_id:1,quantity:1,options:[],expected_unit:5500}]};
    const first=await call('/api/orders',body);assert.equal(first.status,200);assert.equal(first.data.dining_type,dining_type);
    assert.equal((await call('/api/orders',body)).data.id,first.data.id);
    assert.equal((await call('/api/orders',{...body,dining_type:dining_type==='DINE_IN'?'TAKEOUT':'DINE_IN'})).status,409);
    const paid=await pay(first.data.id);assert.equal(paid.data.dining_type,dining_type);
    assert.equal((await call('/api/admin/orders/'+first.data.id,{expected:'PAID'})).data.order.dining_type,dining_type);
    assert.equal((await call('/api/admin/orders/'+first.data.id+'/cancel',{expected:'PREPARING',reason:'검증'})).data.order.dining_type,dining_type);
  }
});
test('v1.5 invalid dining value is rejected; legacy request is unknown; simultaneous different choices cannot overwrite',async t=>{
  const {call,create}=await setup(t);assert.equal((await create()).dining_type,null);
  const body={key:randomUUID(),items:[{menu_id:1,quantity:1,options:[],expected_unit:5500}]};
  for(const dining_type of ['DELIVERY','',0,{}])assert.equal((await call('/api/orders',{...body,dining_type})).status,400);
  const results=await Promise.all(['DINE_IN','TAKEOUT'].map(dining_type=>call('/api/orders',{...body,dining_type})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
});

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

test('v1.4 categories rename/reorder without altering menus; protect used and stale categories',async t=>{
  const {call,menu}=await setup(t),state=(await call('/api/admin/categories')).data;
  const items=state.items.toReversed().map(c=>({...c}));items[0].name='시원한 음료';items.push({id:'dessert',name:'디저트'});
  assert.equal((await call('/api/admin/categories',{items,revision:0})).status,200);
  assert.deepEqual((await call('/api/menu')).data.menu,menu);assert.deepEqual((await call('/api/menu')).data.categories,items);
  assert.equal((await call('/api/admin/categories',{items,revision:0})).status,409);
  assert.equal((await call('/api/admin/categories',{items:items.filter(c=>c.id!=='burger'),revision:1})).status,409);
  assert.equal((await call('/api/admin/categories',{items:[...items,{id:'all',name:'전체'}],revision:1})).status,400);
  assert.equal((await call('/api/admin/categories',{items:items.filter(c=>c.id!=='dessert'),revision:1})).status,200);
});

test('v1.4 category removal racing menu creation cannot leave an orphan',async t=>{
  const {call}=await setup(t),initial=(await call('/api/admin/categories')).data.items;
  await call('/api/admin/categories',{items:[...initial,{id:'dessert',name:'디저트'}],revision:0});
  const results=await Promise.all([call('/api/admin/menu',{key:randomUUID(),name:'아이스크림',description:'',category:'dessert',base_price:2500,is_sold_out:false,options:[]}),call('/api/admin/categories',{items:initial,revision:1})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const catalog=(await call('/api/menu')).data;const ids=new Set(catalog.categories.map(c=>c.id));assert.ok(catalog.menu.every(m=>ids.has(m.category)));
});

test('v1.4 category validation failure cannot deactivate existing options',async t=>{
  const {call,menu}=await setup(t),item=menu[0];
  assert.equal((await call('/api/admin/menu/'+item.id,{...item,is_sold_out:false,category:'missing',options:[]})).status,409);
  assert.deepEqual((await call('/api/admin/menu')).data.menu,menu);
});

test('v1.4 password change rejects wrong current password, revokes sessions and disables bootstrap',async t=>{
  const {call,password,sqlite,setBearer}=await setup(t),next='new long password 2026';
  const body={current_password:password,new_password:next,confirm_password:next};
  assert.equal((await call('/api/admin/password',{...body,current_password:'wrong'})).status,400);
  assert.equal((await call('/api/admin/menu')).status,200);
  assert.equal((await call('/api/admin/password',body)).status,200);
  assert.equal((await call('/api/admin/menu')).status,401);
  assert.equal((await call('/api/admin/login',{password})).status,401);
  const login=await call('/api/admin/login',{password:next});assert.equal(login.status,200);setBearer(login.data.token);
  assert.equal((await call('/api/admin/menu')).status,200);
  const stored=sqlite.prepare('SELECT * FROM admin_auth').get();assert.notEqual(stored.password_hash,next);assert.ok(stored.salt);assert.equal(stored.revision,1);
});

test('v1.4 recovery code rotation, one-use reset and no automatic login',async t=>{
  const {call,password,setBearer,sqlite}=await setup(t),next='recovered password 2026';
  const first=(await call('/api/admin/recovery-code',{current_password:password})).data.code;
  const second=(await call('/api/admin/recovery-code',{current_password:password})).data.code;
  assert.notEqual(sqlite.prepare('SELECT recovery_hash FROM admin_auth').get().recovery_hash,second.replaceAll('-',''));
  assert.equal((await call('/api/admin/reset-password',{recovery_code:first,new_password:next,confirm_password:next})).status,400);
  assert.equal((await call('/api/admin/reset-password',{recovery_code:second,new_password:next,confirm_password:next})).status,200);
  assert.equal((await call('/api/admin/menu')).status,401);
  assert.equal((await call('/api/admin/reset-password',{recovery_code:second,new_password:next,confirm_password:next})).status,400);
  setBearer((await call('/api/admin/login',{password:next})).data.token);
  assert.equal((await call('/api/admin/security')).data.recovery_ready,false);
});

test('v1.4 repeated wrong passwords are throttled and expire',async t=>{
  const {call,password,sqlite}=await setup(t);
  for(let i=0;i<10;i++)assert.equal((await call('/api/admin/login',{password:'wrong'})).status,401);
  assert.equal((await call('/api/admin/login',{password})).status,429);
  sqlite.exec('UPDATE auth_attempt SET expires=0');assert.equal((await call('/api/admin/login',{password})).status,200);
});

test('v1.4 concurrent recovery consumes its code once',async t=>{
  const {call,password}=await setup(t),code=(await call('/api/admin/recovery-code',{current_password:password})).data.code;
  const body={recovery_code:code,new_password:'concurrent reset 2026',confirm_password:'concurrent reset 2026'};
  const results=await Promise.all([call('/api/admin/reset-password',body),call('/api/admin/reset-password',body)]);
  assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>[400,409].includes(r.status)).length,1);
});
