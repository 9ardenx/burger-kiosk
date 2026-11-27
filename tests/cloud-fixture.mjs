import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {handleKiosk} from '../cloud/api.mjs';
export async function setup(t) {
  const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
  for(const file of ['schema.sql','catalog-migration.sql','choices-migration.sql','v12-migration.sql','admin-cancel-migration.sql','v14-migration.sql','v15-migration.sql','v16-migration.sql','inventory-triggers.sql','v17-migration.sql','v18-migration.sql','promotion-pricing.sql'])
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
  async function call(path,body,customer='test-customer-session-0001',admin=true,store=1,override){
    const headers={'X-Kiosk-Session':customer,'X-Kiosk-Store':String(store)};
    if((override??bearer)&&admin)headers.Authorization='Bearer '+(override??bearer);
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

