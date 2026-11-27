import test from 'node:test';import assert from 'node:assert/strict';import {capturePaymentReturn,cartSessionKey} from '../docs/assets/payment-return.js';
test('T15-09 static callback preserves store/session and strips authentication parameters',()=>{
 const id='a'.repeat(32),map=new Map([[cartSessionKey(2),JSON.stringify({orderId:'order',paymentId:id})],['burger-kiosk.cloud.v1.customer.2','session']]),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};
 const href='https://example.test/burger-kiosk/payment-return.html?store=2&attempt='+id+'&paymentKey=test-key&orderId='+id+'&amount=7000';
 assert.ok(capturePaymentReturn(href,{storeId:1},storage).error);assert.equal(map.get(cartSessionKey(2)).includes('callback'),false);
 const r=capturePaymentReturn(href,{storeId:2},storage);assert.equal(r.error,null);assert.equal(new URL(r.clean).pathname,'/burger-kiosk/');assert.equal(r.clean.includes('paymentKey'),false);assert.equal(JSON.parse(map.get(cartSessionKey(2))).callback.data.amount,7000);
 map.clear();assert.ok(capturePaymentReturn(href,null,storage).error);
});
