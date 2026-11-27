import {pushState} from './assets/push-state.js?v=20261128-v115';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
let delivery=Promise.resolve();
async function received(message){
 const binding=await pushState('binding');
 const test=message?.type==='PUSH_TEST';
 if(!binding||!['ORDER_ACCEPTED','PUSH_TEST'].includes(message?.type)||binding.id!==message.subscription_id||binding.generation!==message.generation||binding.store_id!==message.store_id||binding.expires<Date.now())return;
 if(!Number.isSafeInteger(message.event_id)||!Number.isSafeInteger(message.number)||message.number<(test?0:1)||!Number.isFinite(message.created_at)||Date.now()-message.created_at>300000)return;
 const key=message.store_id+':'+(test?'test-'+message.created_at:message.event_id),seen=(await pushState('seen'))??[];if(seen.includes(key))return;
 await self.registration.showNotification(String(message.store_name).slice(0,80)+(test?' · 알림 연결 확인':' · 새 주문'),{
  body:test?'이 기기로 매장 주문 알림을 받을 수 있습니다.':String(message.number).padStart(3,'0')+'번 주문이 접수되었습니다. 주문 현황을 확인해 주세요.',
  tag:'order-'+key,icon:new URL('./assets/pwa-192.png',self.registration.scope).href,
  badge:new URL('./assets/pwa-192.png',self.registration.scope).href,
  data:{store_id:message.store_id,event_id:message.event_id,generation:binding.generation},renotify:false,vibrate:[180,80,180]
 });
 await pushState('seen',[...seen,key].slice(-200));
 if(!test)for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))client.postMessage({type:'KIOSK_ORDER_PUSH',store_id:message.store_id,event_id:message.event_id});
}
self.addEventListener('push',event=>{let message;try{message=event.data?.json();}catch{return;}delivery=delivery.catch(()=>{}).then(()=>received(message));event.waitUntil(delivery);});
self.addEventListener('notificationclick',event=>{
 event.notification.close();event.waitUntil((async()=>{
  const {store_id,event_id,generation}=event.notification.data??{},binding=await pushState('binding');
  if(!binding||binding.store_id!==store_id||binding.generation!==generation)return;
  const url=new URL('admin.html',self.registration.scope);url.searchParams.set('store',String(store_id));url.searchParams.set('workspace','store');url.searchParams.set('notification',String(event_id));url.searchParams.set('v','20261128-v115');url.hash='orders';
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const existing=clients.find(c=>{const u=new URL(c.url);return u.origin===url.origin&&u.pathname===url.pathname&&u.searchParams.get('store')===String(store_id);});
  if(existing){await existing.navigate(url.href);await existing.focus();}else await self.clients.openWindow(url.href);
 })());
});
// No fetch/cache handler: the service worker never caches APIs, passwords, or old screens.
