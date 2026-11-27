import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export function tossFixture(f){
 Object.assign(f.env,{PAYMENT_MODE:'toss',TOSS_CLIENT_KEY:'test_ck_isolated_fixture_12345',TOSS_SECRET_KEY:'test_sk_isolated_fixture_12345'});
 const records=new Map(),calls=[];let hook;
 f.env.TOSS_FETCH=async(url,request)=>{
  const route=decodeURIComponent(url.split('/v1/payments/')[1]),body=request.body?JSON.parse(request.body):null;
  assert.equal(request.headers.Authorization,'Basic '+btoa(f.env.TOSS_SECRET_KEY+':'));assert.equal(request.redirect,'error');
  calls.push({route,body,idempotency:request.headers['Idempotency-Key']});
  const intercepted=await hook?.(route,body);if(intercepted)return intercepted;
  if(route==='confirm'){let value=records.get(body.paymentKey);if(!value){value={paymentKey:body.paymentKey,orderId:body.orderId,totalAmount:body.amount,balanceAmount:body.amount,currency:'KRW',status:'DONE'};records.set(body.paymentKey,value);}return Response.json(value);}
  if(route.endsWith('/cancel')){const value=records.get(route.slice(0,-7));if(value){value.status='CANCELED';value.balanceAmount=0;return Response.json(value);}}
  return records.has(route)?Response.json(records.get(route)):Response.json({code:'NOT_FOUND_PAYMENT'},{status:404});
 };
 const start=async(store=1)=>{const order=await f.callTenant(null,store,'/api/orders',{key:randomUUID(),items:[{menu_id:store===1?1:f.bMenu,quantity:1,options:[],expected_unit:store===1?5500:7000}]});assert.equal(order.status,200);const r=await f.callTenant(null,store,'/api/orders/'+order.data.id+'/attempts',{key:randomUUID(),checkout_version:'v115'});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
 const callback=o=>({paymentKey:'test-payment-'+o.payment.id,orderId:o.payment.id,amount:o.total});
 const resolve=(o,body=callback(o),store=1,customer)=>f.callTenant(null,store,'/api/payments/'+o.payment.id,body,customer);
 return {records,calls,start,callback,resolve,setHook:value=>hook=value};
}
