import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const m=await import('data:text/javascript;base64,'+Buffer.from(await readFile(new URL('../docs/assets/device-store.js',import.meta.url))).toString('base64'));
const memory=()=>{const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
test('device binding persists only public store metadata and survives a new read',()=>{
 const s=memory(),value=m.writeDeviceStore({id:2,name:'B매장',password:'not-stored',token:'not-stored',email:'not-stored'},s);
 assert.deepEqual(m.readDeviceStore(s),value);assert.deepEqual(Object.keys(value).sort(),['linkedAt','storeId','storeName','version']);
 m.removeDeviceStore(s);assert.equal(m.readDeviceStore(s),null);
});
test('unconfigured root requires setup; explicit public links stay temporary; linked store wins',()=>{
 assert.equal(m.customerStore(null,'https://example.test/'),null);
 for(const id of ['0','-1','invalid','01','1000000000'])assert.equal(m.customerStore(null,'https://example.test/?store='+id),null);
 assert.equal(m.customerStore(null,'https://example.test/?store=2'),2);
 assert.equal(m.customerStore({storeId:1},'https://example.test/?store=2'),1);
});
test('corrupt and future-version bindings never fall back to a default store',()=>{
 const s=memory();for(const v of ['bad','null',JSON.stringify({version:2,storeId:1}),JSON.stringify({version:1,storeId:-1,storeName:'X',linkedAt:1})]){s.setItem(m.DEVICE_STORE_KEY,v);assert.equal(m.readDeviceStore(s),null);}
 assert.equal(m.readDeviceStore({getItem(){throw Error('blocked');}}),null);
 assert.throws(()=>m.writeDeviceStore({id:1,name:'A'},{setItem(){throw Error('quota');}}),/저장할 수 없습니다/);
 assert.throws(()=>m.writeDeviceStore({id:1,name:'A'},{setItem(){},getItem(){return null;}}),/저장할 수 없습니다/);
});
test('setup offers owners and headquarters only, never legacy or staff accounts',()=>{
 const stores=[{id:1,role:'OWNER'},{id:2,role:'STAFF'}];assert.deepEqual(m.setupStores({platform_role:'USER',stores}).map(s=>s.id),[1]);
 assert.equal(m.setupStores({platform_role:'HQ',stores}).length,2);assert.equal(m.setupStores({legacy:true,stores}).length,0);
});
