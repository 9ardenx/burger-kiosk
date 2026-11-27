import {buildPushPayload} from '@block65/webcrypto-web-push';
import {check} from './problems.mjs';
import {storeId} from './store-context.mjs';
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const uuid=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const ready=env=>Boolean(env.WEB_PUSH_PUBLIC_KEY&&env.WEB_PUSH_PRIVATE_KEY);
const active=`p.enabled=1 AND p.expires>unixepoch()*1000 AND a.enabled=1 AND s.enabled=1
 AND (a.platform_role='HQ' OR EXISTS(SELECT 1 FROM store_member m WHERE m.uid=p.uid AND m.store_id=p.store_id AND m.enabled=1))`;
async function sendPush(env,d,message){
 check(validPushEndpoint(d.endpoint),'알림 주소를 확인해 주세요.');
 const payload=await buildPushPayload({data:JSON.stringify(message),options:{ttl:120,urgency:'high',topic:'order-'+message.event_id}},
  {endpoint:d.endpoint,keys:{p256dh:d.p256dh,auth:d.auth}},
  {subject:'https://9ardenx.github.io/burger-kiosk/',publicKey:env.WEB_PUSH_PUBLIC_KEY,privateKey:env.WEB_PUSH_PRIVATE_KEY});
 return (env.PUSH_FETCH??fetch)(d.endpoint,{...payload,redirect:'error',signal:AbortSignal.timeout(5000)});
}
export function validPushEndpoint(value){
 try{const u=new URL(value);return value.length<=2048&&u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&(!u.port||u.port==='443')&&(
  u.hostname==='fcm.googleapis.com'&&/^\/(fcm\/send|wp)\//.test(u.pathname)||
  /^(?:[a-z0-9-]+\.)?push\.services\.mozilla\.com$/.test(u.hostname)||
  /^(?:[a-z0-9-]+\.)?push\.apple\.com$/.test(u.hostname));}catch{return false;}
}
function keyBytes(value,length){try{if(typeof value!=='string'||!/^[a-zA-Z0-9_-]+$/.test(value))return null;const b=Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));return b.length===length?b:null;}catch{return null;}}
export async function notificationConfig(db,env,actor){
 const store=await stmt(db,'SELECT id,name FROM store WHERE id=?',storeId(db)).first();
 return {store,push_available:ready(env)&&!actor.legacy,public_key:ready(env)?env.WEB_PUSH_PUBLIC_KEY:null};
}
export async function notificationEvents(db,params){
 const value=params.get('after');check(value===null||/^\d{1,15}$/.test(value),'알림 조회 위치를 확인해 주세요.');
 const latest=(await stmt(db,'SELECT coalesce(max(id),0) AS id FROM order_notification WHERE store_id=?',storeId(db)).first()).id;
 if(value===null)return {cursor:latest,events:[],more:false};
 const rows=(await stmt(db,`SELECT n.id,n.store_id,n.order_id,o.number,CASE WHEN o.cancelled_at IS NOT NULL THEN 'CANCELLED' ELSE o.status END AS status,n.created_at,s.name AS store_name
 FROM order_notification n JOIN orders o ON o.id=n.order_id JOIN store s ON s.id=n.store_id
 WHERE n.store_id=? AND n.id>? ORDER BY n.id LIMIT 50`,storeId(db),Number(value)).all()).results;
 const cursor=rows.at(-1)?.id??Math.min(Number(value),latest);
 return {cursor,events:rows,more:cursor<latest};
}
export async function subscribePush(db,env,actor,body){
 check(!actor.legacy&&ready(env),'이메일 로그인과 휴대폰 알림 연결을 확인해 주세요.',503,'PUSH_NOT_READY');
 const p=body.subscription,point=keyBytes(p?.keys?.p256dh,65),auth=keyBytes(p?.keys?.auth,16);
 check(p&&validPushEndpoint(p.endpoint)&&point?.[0]===4&&auth,'지원하는 브라우저의 알림 정보를 확인해 주세요.');
 try{await crypto.subtle.importKey('raw',point,{name:'ECDH',namedCurve:'P-256'},false,[]);}catch{check(false,'알림 암호화 키를 확인해 주세요.');}
 const id=await hash(p.endpoint),generation=crypto.randomUUID(),expires=Date.now()+30*86400000;
 const count=await stmt(db,'SELECT count(*) AS n FROM push_subscription WHERE uid=? AND store_id=? AND enabled=1 AND expires>? AND id!=?',actor.uid,storeId(db),Date.now(),id).first();
 check(count.n<5,'이 매장에서 최대 5개 기기의 알림을 사용할 수 있습니다.',409,'PUSH_DEVICE_LIMIT');
 const saved=await stmt(db,`INSERT INTO push_subscription(id,uid,store_id,endpoint,p256dh,auth,generation,enabled,expires)
 SELECT ?,?,?,?,?,?,?,1,? WHERE (SELECT count(*) FROM push_subscription WHERE uid=? AND store_id=? AND enabled=1 AND expires>? AND id!=?)<5
 ON CONFLICT(id) DO UPDATE SET uid=excluded.uid,store_id=excluded.store_id,
 endpoint=excluded.endpoint,p256dh=excluded.p256dh,auth=excluded.auth,generation=excluded.generation,enabled=1,expires=excluded.expires`,id,actor.uid,storeId(db),p.endpoint,p.keys.p256dh,p.keys.auth,generation,expires,actor.uid,storeId(db),Date.now(),id).run();
 check(saved.meta.changes===1,'이 매장에서 최대 5개 기기의 알림을 사용할 수 있습니다.',409,'PUSH_DEVICE_LIMIT');
 return {id,generation,uid:actor.uid,store_id:storeId(db),expires};
}
export async function pushStatus(db,actor,body){
 check(typeof body.id==='string'&&/^[a-f0-9]{64}$/.test(body.id),'알림 기기 정보를 확인해 주세요.');
 const p=await stmt(db,'SELECT id,generation,uid,store_id,expires FROM push_subscription WHERE id=? AND uid=? AND store_id=? AND enabled=1 AND expires>?',body.id,actor.uid,storeId(db),Date.now()).first();
 if(p){p.expires=Date.now()+30*86400000;await stmt(db,'UPDATE push_subscription SET expires=? WHERE id=? AND uid=? AND generation=?',p.expires,p.id,actor.uid,p.generation).run();}
 return {binding:p??null};
}
export async function unsubscribePush(db,actor,body){
 check(typeof body.id==='string'&&/^[a-f0-9]{64}$/.test(body.id)&&uuid(body.generation),'알림 기기 정보를 확인해 주세요.');
 await stmt(db,'UPDATE push_subscription SET enabled=0 WHERE id=? AND uid=? AND generation=?',body.id,actor.uid,body.generation).run();return {ok:true};
}
export async function testPush(db,env,actor,body){
 check(ready(env),'휴대폰 알림 연결을 준비 중입니다.',503);
 check(typeof body.id==='string'&&uuid(body.generation),'알림 기기 정보를 확인해 주세요.');
 const d=await stmt(db,`SELECT p.*,s.name AS store_name FROM push_subscription p JOIN staff_account a ON a.uid=p.uid JOIN store s ON s.id=p.store_id WHERE p.id=? AND p.uid=? AND p.store_id=? AND p.generation=? AND ${active}`,body.id,actor.uid,storeId(db),body.generation).first();
 check(d,'이 매장에 연결한 기기에서 다시 설정해 주세요.',404);
 const locked=await stmt(db,'UPDATE push_subscription SET last_test=? WHERE id=? AND generation=? AND last_test<?',Date.now(),d.id,d.generation,Date.now()-30000).run();
 check(locked.meta.changes,'연결 확인은 30초 후 다시 할 수 있습니다.',429);
 let response;try{response=await sendPush(env,d,{type:'PUSH_TEST',subscription_id:d.id,generation:d.generation,store_id:d.store_id,store_name:d.store_name,event_id:0,number:0,created_at:Date.now()});}catch{check(false,'알림 서비스에 연결하지 못했습니다. 잠시 후 다시 확인해 주세요.',503);}
 const status=response.status;await response.body?.cancel();
 if([404,410].includes(status))await stmt(db,'UPDATE push_subscription SET enabled=0 WHERE id=? AND generation=?',d.id,d.generation).run();
 check(status>=200&&status<300,'알림 서비스가 요청을 받지 못했습니다. 기기 알림을 다시 연결해 주세요.',503);
 return {accepted:true};
}
const deliverySelect=`SELECT d.event_id,d.subscription_id,d.generation,d.attempts,p.uid,p.endpoint,p.p256dh,p.auth,
 n.store_id,n.order_id,n.created_at,o.number,o.status,s.name AS store_name
 FROM notification_delivery d JOIN order_notification n ON n.id=d.event_id JOIN orders o ON o.id=n.order_id
 JOIN push_subscription p ON p.id=d.subscription_id JOIN staff_account a ON a.uid=p.uid JOIN store s ON s.id=n.store_id`;
export async function drainNotifications(db,env,store){
 if(!ready(env))return;
 const now=Date.now();
 // Expired / revoked / rebound destinations cannot receive an earlier binding's messages.
 await stmt(db,`UPDATE notification_delivery SET status='SKIPPED',lease=NULL WHERE status IN ('PENDING','SENDING') AND event_id IN(SELECT id FROM order_notification WHERE store_id=?)
 AND (event_id IN(SELECT n.id FROM order_notification n JOIN orders o ON o.id=n.order_id WHERE n.created_at<? OR o.cancelled_at IS NOT NULL OR o.status IN ('CANCELLED','COMPLETED'))
 OR NOT EXISTS(SELECT 1 FROM push_subscription p JOIN staff_account a ON a.uid=p.uid JOIN store s ON s.id=p.store_id
 WHERE p.id=notification_delivery.subscription_id AND p.generation=notification_delivery.generation AND ${active}))`,store,now-300000).run();
 const candidates=(await stmt(db,deliverySelect+` WHERE n.store_id=? AND d.status IN ('PENDING','SENDING') AND d.next_attempt<=? AND d.attempts<5
 AND p.generation=d.generation AND ${active} ORDER BY d.event_id LIMIT 10`,store,now).all()).results;
 await Promise.allSettled(candidates.map(async d=>{
  const lease=crypto.randomUUID();
  const claim=await stmt(db,"UPDATE notification_delivery SET status='SENDING',lease=?,next_attempt=?,attempts=attempts+1 WHERE event_id=? AND subscription_id=? AND generation=? AND status IN ('PENDING','SENDING') AND next_attempt<=? AND attempts<5",lease,now+30000,d.event_id,d.subscription_id,d.generation,now).run();
  if(!claim.meta.changes)return;
  let state='PENDING',code='NETWORK';
  try{
   // Recheck immediately before sending, not only when the payment was accepted.
   const authorized=await stmt(db,`SELECT 1 FROM push_subscription p JOIN staff_account a ON a.uid=p.uid JOIN store s ON s.id=p.store_id
    WHERE p.id=? AND p.generation=? AND p.store_id=? AND ${active} AND EXISTS(SELECT 1 FROM orders o WHERE o.id=? AND o.cancelled_at IS NULL AND o.status IN ('PAID','PREPARING','READY'))`,d.subscription_id,d.generation,d.store_id,d.order_id).first();
   if(!authorized){state='SKIPPED';code='REVOKED';}
   else{
    const message={type:'ORDER_ACCEPTED',event_id:d.event_id,order_id:d.order_id,store_id:d.store_id,store_name:d.store_name,number:d.number,subscription_id:d.subscription_id,generation:d.generation,created_at:d.created_at};
    const response=await sendPush(env,d,message);
    code=String(response.status);
    if(response.status>=200&&response.status<300)state='SENT';
    else if([404,410].includes(response.status)){state='DEAD';await stmt(db,'UPDATE push_subscription SET enabled=0 WHERE id=? AND generation=?',d.subscription_id,d.generation).run();}
    else if(response.status<500&&response.status!==429)state='FAILED';
    await response.body?.cancel();
   }
  }catch{code='NETWORK_OR_ENCRYPTION';}
  if(state==='PENDING'&&d.attempts+1>=5)state='FAILED';
  await stmt(db,'UPDATE notification_delivery SET status=?,last_result=?,next_attempt=?,lease=NULL WHERE event_id=? AND subscription_id=? AND generation=? AND lease=?',state,code,Date.now()+Math.min(60000,1000*2**d.attempts),d.event_id,d.subscription_id,d.generation,lease).run();
 }));
}
export function scheduleNotifications(db,env,ctx,store,retry=false){
 const task=(async()=>{await drainNotifications(db,env,store);if(retry&&ctx?.waitUntil&&ready(env))for(const delay of [1200,2500]){await new Promise(r=>setTimeout(r,delay));await drainNotifications(db,env,store);}})().catch(()=>console.error('Order notification delivery deferred'));
 if(ctx?.waitUntil){ctx.waitUntil(task);return Promise.resolve();}return task;
}
