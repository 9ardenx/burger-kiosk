import test from 'node:test';
import assert from 'node:assert/strict';
import {tenantFixture} from './tenant-fixture.mjs';
import {workspaceRoute,directStores,workspaceTabs} from '../docs/assets/workspace.js';

test('v1.12 HQ identity distinguishes explicit operation membership without changing store access or data',async t=>{
 const f=await tenantFixture(t);
 const snapshot=()=>['store','store_member','menu','menu_option','orders','payment','ad_catalog','inventory','ingredient_stock'].map(table=>[table,f.sqlite.prepare('SELECT * FROM '+table).all()]);
 const before=snapshot(),account=(await f.callTenant(f.hq,2,'/api/account')).data;
 assert.equal(account.platform_role,'HQ');assert.deepEqual(account.stores.map(s=>[s.id,s.role,s.membership_role]),[[1,'HQ','OWNER'],[2,'HQ',null]]);
 assert.deepEqual(directStores(account).map(s=>s.id),[1]);assert.deepEqual(snapshot(),before);
 assert.equal((await f.callTenant(f.hq,2,'/api/admin/menu')).status,200);
 assert.deepEqual(workspaceRoute(account,{storeId:2,tab:'menu'}),{workspace:'hq',tab:'hqhome',storeId:2});
 assert.deepEqual(workspaceRoute(account,{storeId:1,workspace:'store',tab:'inventory'}),{workspace:'store',tab:'inventory',storeId:1});
 assert.equal(workspaceRoute(account,{workspace:'store',tab:'menu',storeId:2,freshLogin:true}).tab,'hqhome');
 assert.deepEqual(Object.keys(workspaceTabs(account,'hq')),['hqhome','hqsales','hqsupply','franchise','hqaccounts']);
 f.sqlite.prepare("UPDATE store_member SET enabled=0 WHERE uid='head'").run();
 assert.deepEqual(directStores((await f.callTenant(f.hq,1,'/api/account')).data),[]);
});
test('v1.12 store owners and staff cannot elevate by workspace/hash or cross-store requests',async t=>{
 const f=await tenantFixture(t),a=(await f.callTenant(f.a,1,'/api/account')).data,staff=(await f.callTenant(f.staff,2,'/api/account')).data;
 for(const tab of ['hqhome','hqaccounts','hqsales','hqsupply','franchise']){
  assert.deepEqual(workspaceRoute(a,{workspace:'hq',tab,storeId:2}),{workspace:'store',tab:'orders',storeId:1});
  assert.equal(workspaceRoute(staff,{workspace:'hq',tab:'accounts',storeId:2}).tab,'orders');
 }
 for(const path of ['/api/account/stores','/api/account/supply','/api/account/sales?from=2026-11-01&to=2026-11-28'])assert.equal((await f.callTenant(f.a,1,path)).status,403);
 for(const path of ['/api/admin/accounts','/api/admin/store-profile','/api/admin/menu'])assert.equal((await f.callTenant(f.a,2,path)).status,403);
 assert.equal((await f.callTenant(f.staff,2,'/api/admin/accounts')).status,403);
});
test('v1.12 HQ with no stores still lands on HQ; pending owners still complete their address',()=>{
 assert.deepEqual(workspaceRoute({platform_role:'HQ',stores:[]},{workspace:'store',tab:'orders',freshLogin:true}),{workspace:'hq',tab:'hqhome',storeId:null});
 const a={platform_role:'USER',stores:[{id:8,role:'OWNER',address_pending:1}]};
 assert.deepEqual(workspaceRoute(a,{workspace:'hq',tab:'hqaccounts',storeId:1}),{workspace:'store',tab:'storeinfo',storeId:8});
 assert.equal(workspaceRoute({platform_role:'HQ',stores:[{id:1,role:'HQ'}]},{workspace:'hq',tab:'accounts',storeId:1}).tab,'accounts');
});
