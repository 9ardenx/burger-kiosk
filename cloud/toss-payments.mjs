import {check} from './problems.mjs';
import {storeId} from './store-context.mjs';
const sql=(db,q,...args)=>db.prepare(q).bind(...args);
const keyOK=(key,prefix)=>typeof key==='string'&&new RegExp('^'+prefix+'[A-Za-z0-9_-]{10,200}$').test(key);
const matchingTestKeys=env=>keyOK(env.TOSS_CLIENT_KEY,'test_ck_')&&keyOK(env.TOSS_SECRET_KEY,'test_sk_');
export function paymentConfig(env){
 if(!env.PAYMENT_MODE||env.PAYMENT_MODE==='demo')return {mode:'demo',clientKey:''};
 return env.PAYMENT_MODE==='toss'&&matchingTestKeys(env)?{mode:'toss',clientKey:env.TOSS_CLIENT_KEY}:{mode:'unavailable',clientKey:''};
}
function requireTestKeys(env){check(matchingTestKeys(env),'토스 테스트 결제 설정을 확인해 주세요. 운영 키는 사용할 수 없습니다.',503,'PAYMENT_UNAVAILABLE');}
const saleChanged=`SELECT 1 FROM order_item i JOIN menu m ON m.id=i.menu_id JOIN menu_pricing q ON q.id=m.id
 WHERE i.order_id=? AND (m.is_sold_out=1 OR (i.menu_version IS NOT NULL AND i.menu_version!=m.version)
 OR i.price!=q.sale_price OR coalesce(json_extract(i.promotion,'$.id'),'')!=coalesce(q.promotion_id,'')) LIMIT 1`;
async function saleAvailable(db,id){
 const changed=await sql(db,saleChanged,id).first();
 const stock=await sql(db,`SELECT 1 FROM order_item i JOIN inventory s ON s.menu_id=i.menu_id WHERE i.order_id=? AND s.enabled=1 GROUP BY s.menu_id HAVING sum(i.quantity)>s.quantity LIMIT 1`,id).first();
 return !changed&&!stock;
}
export async function beginToss(db,env,customer,id,ticket){
 requireTestKeys(env);check(paymentConfig(env).mode==='toss','결제 설정을 확인해 주세요.',503,'PAYMENT_UNAVAILABLE');
 const order=await sql(db,'SELECT * FROM orders WHERE id=? AND customer=? AND store_id=?',id,customer,storeId(db)).first();check(order,'주문을 찾을 수 없습니다.',404);
 check(!order.cancelled_at,'취소한 주문입니다.',409,'ORDER_CANCELLED');if(order.status!=='PENDING_PAYMENT')return;
 if(await sql(db,"SELECT 1 FROM payment WHERE order_id=? AND (id=? OR status IN ('PENDING','SUCCESS'))",id,ticket).first())return;
 check(await saleAvailable(db,id),'가격·품절 상태가 변경되었습니다. 장바구니를 다시 확인해 주세요.',409,'CART_CHANGED');
 await db.batch([
  sql(db,`INSERT OR IGNORE INTO payment(id,order_id,amount,status,mode) SELECT ?,id,total,'PENDING','toss_test' FROM orders WHERE id=? AND customer=? AND status='PENDING_PAYMENT' AND cancelled_at IS NULL`,ticket,id,customer),
  sql(db,"INSERT OR IGNORE INTO toss_checkout(payment_id) SELECT id FROM payment WHERE id=? AND mode='toss_test'",ticket)
 ]);
}
async function owned(db,id,customer){
 const row=await sql(db,`SELECT p.*,t.payment_key,t.phase,t.confirm_started,t.cancel_requested,t.lease_owner,t.lease_until,o.cancelled_at FROM payment p JOIN toss_checkout t ON t.payment_id=p.id JOIN orders o ON o.id=p.order_id WHERE p.id=? AND p.mode='toss_test' AND o.customer=? AND o.store_id=?`,id,customer,storeId(db)).first();
 check(row,'결제 정보를 찾을 수 없습니다.',404);return row;
}
async function gateway(env,route,body,idempotency){
 requireTestKeys(env);
 try{
  const response=await (env.TOSS_FETCH??fetch)('https://api.tosspayments.com/v1/payments/'+route,{method:body?'POST':'GET',headers:{Authorization:'Basic '+btoa(env.TOSS_SECRET_KEY+':'),'Content-Type':'application/json',...(idempotency?{'Idempotency-Key':idempotency}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});
  return {status:response.status,body:await response.json()};
 }catch{return {status:0,body:{}};}
}
function validRecord(record,p){return record&&record.orderId===p.id&&record.currency==='KRW'&&record.totalAmount===p.amount&&typeof record.paymentKey==='string'&&record.paymentKey.length<=200&&(!p.payment_key||record.paymentKey===p.payment_key);}
async function note(db,id,owner,message){await sql(db,'UPDATE toss_checkout SET last_error=?,updated_at=? WHERE payment_id=? AND lease_owner=?',message,Date.now(),id,owner).run();}
async function fail(db,p,owner,message){
 await db.batch([
  sql(db,"UPDATE payment SET status='FAILED' WHERE id=? AND status='PENDING' AND EXISTS(SELECT 1 FROM toss_checkout WHERE payment_id=? AND lease_owner=?)",p.id,p.id,owner),
  sql(db,"UPDATE toss_checkout SET phase='FAILED',last_error=?,updated_at=? WHERE payment_id=? AND lease_owner=?",message,Date.now(),p.id,owner)
 ]);
}
async function compensate(db,env,p,owner,record){
 await sql(db,"UPDATE toss_checkout SET cancel_requested=1,phase='CANCEL_PENDING',last_error='테스트 결제 취소 결과를 확인하고 있습니다.' WHERE payment_id=? AND lease_owner=?",p.id,owner).run();
 const result=await gateway(env,encodeURIComponent(record.paymentKey)+'/cancel',{cancelReason:'키오스크 주문 접수 불가 또는 고객 결제 중단'},'cancel-'+p.id);
 let value=result.status===200?result.body:null;
 if(!value){const lookup=await gateway(env,encodeURIComponent(record.paymentKey));if(lookup.status===200)value=lookup.body;}
 if(validRecord(value,p)&&value.status==='CANCELED'&&value.balanceAmount===0)await fail(db,p,owner,'테스트 결제가 취소되었습니다. 장바구니를 확인한 뒤 다시 주문해 주세요.');
 else await note(db,p.id,owner,'테스트 결제 취소 확인 중입니다. 결과 다시 확인을 눌러 주세요.');
}
async function accept(db,p,owner){
 const result=await db.batch([
  sql(db,`UPDATE payment SET status='SUCCESS' WHERE id=? AND status='PENDING' AND EXISTS(SELECT 1 FROM toss_checkout WHERE payment_id=? AND lease_owner=? AND cancel_requested=0)`,p.id,p.id,owner),
  sql(db,`UPDATE orders SET status='PAID',number=(SELECT coalesce(max(number),0)+1 FROM orders WHERE store_id=?) WHERE id=? AND status='PENDING_PAYMENT' AND cancelled_at IS NULL AND EXISTS(SELECT 1 FROM payment WHERE id=? AND status='SUCCESS')`,storeId(db),p.order_id,p.id),
  sql(db,"UPDATE toss_checkout SET phase='DONE',last_error='',updated_at=? WHERE payment_id=? AND lease_owner=? AND EXISTS(SELECT 1 FROM payment WHERE id=? AND status='SUCCESS')",Date.now(),p.id,owner,p.id)
 ]);return result[0].meta.changes===1;
}
export async function resolveToss(db,env,customer,id,body){
 requireTestKeys(env);let p=await owned(db,id,customer);
 if(Object.hasOwn(body,'paymentKey')){
  check(typeof body.paymentKey==='string'&&body.paymentKey.length>=1&&body.paymentKey.length<=200&&!/[\x00-\x20]/.test(body.paymentKey),'결제 인증 정보를 확인해 주세요.');
  check(body.orderId===id&&Number.isSafeInteger(body.amount)&&body.amount===p.amount,'주문번호 또는 결제 금액이 일치하지 않습니다.',400,'PAYMENT_MISMATCH');
  check(!p.payment_key||p.payment_key===body.paymentKey,'다른 결제 인증 정보입니다.',409,'PAYMENT_MISMATCH');
 }
 if(p.status!=='PENDING')return p.order_id;
 if(body.cancel===true)await sql(db,'UPDATE toss_checkout SET cancel_requested=1 WHERE payment_id=?',id).run();
 const owner=crypto.randomUUID(),now=Date.now();
 const locked=await sql(db,`UPDATE toss_checkout SET lease_owner=?,lease_until=?,updated_at=? WHERE payment_id=? AND lease_until<? AND EXISTS(SELECT 1 FROM payment WHERE id=? AND status='PENDING')`,owner,now+60000,now,id,now,id).run();
 if(!locked.meta.changes)return p.order_id;
 try{
  p=await owned(db,id,customer);
  if(body.paymentKey&&!p.payment_key){
   const other=await sql(db,'SELECT payment_id FROM toss_checkout WHERE payment_key=? AND payment_id!=?',body.paymentKey,id).first();check(!other,'다른 주문의 결제 정보입니다.',409,'PAYMENT_MISMATCH');
   await sql(db,'UPDATE toss_checkout SET payment_key=? WHERE payment_id=? AND lease_owner=? AND payment_key IS NULL',body.paymentKey,id,owner).run();p=await owned(db,id,customer);
  }
  // Read the provider first. A lost confirm response must never trigger a new charge.
  let result=p.payment_key?await gateway(env,encodeURIComponent(p.payment_key)):{status:404,body:{}},record=result.status===200?result.body:null;
  if(record&&!validRecord(record,p)){await note(db,id,owner,'결제 정보가 주문과 일치하지 않습니다. 매장에 문의해 주세요.');return p.order_id;}
  if(!record&&result.status!==404){await note(db,id,owner,'토스 결제 결과를 확인하지 못했습니다. 결과 다시 확인을 눌러 주세요.');return p.order_id;}
  if(record&&['CANCELED','ABORTED','EXPIRED'].includes(record.status)){await fail(db,p,owner,'테스트 결제가 취소되었거나 승인되지 않았습니다.');return p.order_id;}
  p=await owned(db,id,customer);
  if(record?.status!=='DONE'){
   if(p.cancel_requested||p.cancelled_at){
    if(!p.confirm_started)await fail(db,p,owner,'결제창을 닫았습니다. 다시 결제할 수 있습니다.');
    else await note(db,id,owner,'이전 승인 결과를 확인 중입니다. 취소 완료 전에는 다시 결제하지 마세요.');
    return p.order_id;
   }
   if(!p.payment_key)return p.order_id;
   if(!await saleAvailable(db,p.order_id)){
    if(!p.confirm_started)await fail(db,p,owner,'가격·품절 상태가 변경되어 승인하지 않았습니다. 장바구니를 다시 확인해 주세요.');
    else await sql(db,"UPDATE toss_checkout SET cancel_requested=1,phase='CANCEL_PENDING' WHERE payment_id=? AND lease_owner=?",id,owner).run();
    return p.order_id;
   }
   await sql(db,"UPDATE toss_checkout SET confirm_started=1,phase='CONFIRMING' WHERE payment_id=? AND lease_owner=?",id,owner).run();
   result=await gateway(env,'confirm',{paymentKey:p.payment_key,orderId:id,amount:p.amount},'confirm-'+id);
   record=result.status===200?result.body:null;
   if(!record){const lookup=await gateway(env,encodeURIComponent(p.payment_key));if(lookup.status===200)record=lookup.body;}
   if(!record){
    if(result.status===400&&['REJECT_CARD_COMPANY','REJECT_CARD_PAYMENT'].includes(result.body?.code))await fail(db,p,owner,'토스 테스트 승인이 거절되었습니다. 다시 결제해 주세요.');
    else await note(db,id,owner,'승인 결과를 확인 중입니다. 결과 다시 확인을 눌러 주세요.');return p.order_id;
   }
  }
  if(!validRecord(record,p)){await note(db,id,owner,'결제 정보가 주문과 일치하지 않습니다. 매장에 문의해 주세요.');return p.order_id;}
  if(['CANCELED','ABORTED','EXPIRED'].includes(record.status)){await fail(db,p,owner,'테스트 결제가 취소되었거나 승인되지 않았습니다.');return p.order_id;}
  if(record.status!=='DONE'||record.balanceAmount!==p.amount){await note(db,id,owner,'결제가 완료되지 않았습니다. 결과 다시 확인을 눌러 주세요.');return p.order_id;}
  // Keep only the payment key needed for reconciliation; no cardholder/card data is saved.
  await sql(db,'UPDATE toss_checkout SET payment_key=coalesce(payment_key,?) WHERE payment_id=? AND lease_owner=?',record.paymentKey,id,owner).run();
  p=await owned(db,id,customer);
  if(p.cancel_requested||p.cancelled_at){await compensate(db,env,p,owner,record);return p.order_id;}
  try{if(!await accept(db,p,owner)){p=await owned(db,id,customer);if(p.cancel_requested&&p.status==='PENDING')await compensate(db,env,p,owner,record);}}
  catch(error){
   if(/TOSS_SALE_CHANGED|STOCK_UNAVAILABLE/.test(String(error.message)+' '+String(error.cause?.message)))await compensate(db,env,p,owner,record);
   else await note(db,id,owner,'승인은 확인했지만 주문 저장을 다시 확인해야 합니다. 결과 다시 확인을 눌러 주세요.');
  }
  return p.order_id;
 }finally{await sql(db,'UPDATE toss_checkout SET lease_owner=NULL,lease_until=0 WHERE payment_id=? AND lease_owner=?',id,owner).run();}
}
