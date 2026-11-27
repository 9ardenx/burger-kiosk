// Run after building sites/kiosk-api and applying migrations to .wrangler/v17-test.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{randomUUID,createHash}=require('node:crypto');
async function main(){
 const cwd=path.resolve('sites/kiosk-api'),password=randomUUID();
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const child=spawn(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','dev','--config','dist/server/wrangler.json','--local','--ip','127.0.0.1','--port',String(port),'--persist-to','.wrangler/v17-test','--var','KIOSK_ADMIN_HASH:'+createHash('sha256').update(password).digest('hex')],{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let logs='',token;child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
 const base=`http://127.0.0.1:${port}`,api=async(p,data,expected=200)=>{const r=await fetch(base+p,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Kiosk-Session':'v17-runtime-customer-session',...(token?{Authorization:'Bearer '+token}:{})},body:data===undefined?undefined:JSON.stringify(data)});const b=await r.json();assert.equal(r.status,expected,JSON.stringify(b));return b;};
 try{
  let ready=false;for(let i=0;i<150;i++){try{if((await fetch(base+'/api/menu')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(ready,'Worker startup failed: '+logs.slice(-1200));
  token=(await api('/api/admin/login',{password})).token;
  const before=(await api('/api/admin/menu')).menu;
  const save=async(id,quantity)=>{const s=(await api('/api/admin/inventory')).items.find(i=>i.id===id);await api('/api/admin/inventory/'+id,{enabled:true,quantity,revision:s.revision,low_threshold:1,reason:'격리 검증'});};
  const create=items=>api('/api/orders',{key:randomUUID(),items:items||[{menu_id:1,quantity:1,options:[],expected_unit:5500}]});
  const pay=(id,status=200)=>api('/api/orders/'+id+'/attempts',{key:randomUUID(),demo_result:'success'},status);
  await save(1,1);const first=await create(),second=await create();await pay(first.id);const failed=await pay(second.id,409);assert.equal(failed.code,'CART_CHANGED');await pay(first.id);
  let stock=await api('/api/admin/inventory');assert.equal(stock.items.find(i=>i.id===1).quantity,0);
  assert.equal(stock.history.filter(h=>h.order_id===first.id&&h.kind==='SALE').length,1);
  await api('/api/admin/orders/'+first.id+'/cancel',{expected:'PAID',reason:'검증',restock:true});await api('/api/admin/orders/'+first.id+'/cancel',{expected:'PAID',reason:'재요청',restock:true});
  stock=await api('/api/admin/inventory');assert.equal(stock.items.find(i=>i.id===1).quantity,1);assert.equal(stock.history.filter(h=>h.order_id===first.id&&h.kind==='RETURN').length,1);
  await save(2,1);const multi=await create([{menu_id:1,quantity:1,options:[],expected_unit:5500},{menu_id:2,quantity:1,options:[],expected_unit:6000}]);await save(2,0);await pay(multi.id,409);stock=await api('/api/admin/inventory');assert.equal(stock.items.find(i=>i.id===1).quantity,1);assert.equal((await api('/api/orders/'+multi.id)).payment,null);
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10),sales=await api(`/api/admin/sales?from=${today}&to=${today}`);assert.equal(sales.summary.net,0);assert.ok(sales.summary.approved>=5500);
  const after=(await api('/api/admin/menu')).menu;for(const m of before){const n=after.find(i=>i.id===m.id);for(const [k,v] of Object.entries(m))if(k!=='stock_sold_out')assert.deepEqual(n[k],v);}
  const promo={id:randomUUID(),title:'격리 할인',enabled:true,menu_ids:[1],weekdays:[0,1,2,3,4,5,6],start_time:'00:00',end_time:'24:00',mode:'PERCENT',value:20};
  const saved=await api('/api/admin/promotions',{items:[promo],revision:0});assert.equal((await api('/api/menu')).menu[0].base_price,4400);
  const discounted=await create([{menu_id:1,quantity:1,options:[],expected_unit:4400}]);
  await api('/api/admin/promotions',{items:[{...promo,enabled:false}],revision:saved.revision});const stale=await pay(discounted.id,409);assert.equal(stale.code,'CART_CHANGED');assert.equal((await api('/api/orders/'+discounted.id)).payment,null);assert.equal((await api('/api/admin/inventory')).items.find(i=>i.id===1).quantity,1);
  await api('/api/admin/promotions',{items:[{...promo,mode:'FIXED',value:3900}],revision:saved.revision+1});
  const fixed=await create([{menu_id:1,quantity:1,options:[1],expected_unit:4400}]);const paid=await pay(fixed.id);assert.equal(paid.total,4400);assert.equal(paid.items[0].regular_price,5500);assert.equal(paid.items[0].promotion.title,promo.title);assert.equal((await api('/api/admin/inventory')).items.find(i=>i.id===1).quantity,0);
  await api('/api/admin/logout',{});
  const result={date:new Date().toISOString(),migration:'0008_redundant_lockheed.sql',runtime:'built Worker / local workerd + D1',shortageRollback:true,paymentRollback:true,idempotentSaleAndReturn:true,multiMenuAtomicity:true,sales:true,existingMenuPreserved:true,percentAndFixed:true,promotionApprovalRollback:true,discountSnapshot:true};fs.mkdirSync('data/qa/v1.7',{recursive:true});fs.writeFileSync('data/qa/v1.7/worker-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await new Promise(resolve=>{const stop=spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});stop.on('close',resolve);});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
