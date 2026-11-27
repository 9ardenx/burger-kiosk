import {api,escapeText} from './common.js?v=20261128-v114';
import {pushState} from './push-state.js?v=20261128-v114';
let context=null,epoch=0,interval,config=null,binding=null,registering=null,pushBusy=false,pollBusy=false,connection='화면 알림 연결 중…',device='이 기기 알림 꺼짐',audio=null,newOrders=[],onChange=()=>{},onUnauthorized=()=>{};
const supported=()=>isSecureContext&&'serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window;
const channelKey=c=>'burger-kiosk.notice.v113:'+c.uid+':'+c.store;
const bindingLock=task=>navigator.locks?navigator.locks.request('burger-kiosk.push-binding',task):task();
function storedCursor(){const value=localStorage.getItem(channelKey(context));return value!==null&&/^\d+$/.test(value)?Number(value):null;}
async function registration(){if(!supported())throw new Error('이 브라우저는 휴대폰 알림을 지원하지 않습니다. 아이폰은 홈 화면에 추가한 앱에서 열어 주세요.');if(!registering)registering=navigator.serviceWorker.register('./order-push-sw.js?v=20261128-v114',{scope:'./',type:'module',updateViaCache:'none'}).then(()=>navigator.serviceWorker.ready).catch(e=>{registering=null;throw e;});return registering;}
function paint(){
 for(const node of document.querySelectorAll('[data-notification-connection]'))node.textContent=connection;
 for(const node of document.querySelectorAll('[data-notification-device]'))node.textContent=device;
 for(const node of document.querySelectorAll('[data-push-enable]')){node.disabled=pushBusy||!config?.push_available||!supported();node.textContent=binding?'이 기기 알림 다시 연결':'이 기기 알림 켜기';}
 for(const node of document.querySelectorAll('[data-push-disable],[data-push-test]')){node.hidden=!binding;node.disabled=pushBusy;}
 for(const node of document.querySelectorAll('[data-notification-sound]'))node.textContent=audio?.state==='running'?'소리 끄기':'소리 켜기';
}
export function notificationControls(){if(!context)return '';return `<section class="notification-controls" aria-label="주문 알림 설정"><div><strong>주문 알림</strong><small data-notification-connection>${escapeText(connection)}</small><small data-notification-device>${escapeText(device)}</small></div><div class="actions"><button class="secondary" data-push-enable ${pushBusy||!config?.push_available||!supported()?'disabled':''}>${binding?'이 기기 알림 다시 연결':'이 기기 알림 켜기'}</button><button class="secondary" data-push-test ${binding?'':'hidden'}>연결 확인</button><button class="text-btn" data-push-disable ${binding?'':'hidden'}>기기 알림 끄기</button><button class="secondary" data-notification-sound>${audio?.state==='running'?'소리 끄기':'소리 켜기'}</button></div><details><summary>휴대폰에서 알림 받는 방법</summary><p>안드로이드: 휴대폰에서 이 매장 관리자에 로그인하고 ‘이 기기 알림 켜기’를 누른 뒤 알림을 허용해 주세요.</p><p>아이폰(iOS 16.4 이상): Safari의 공유 → 홈 화면에 추가 → 추가된 앱에서 로그인 → ‘이 기기 알림 켜기’ → 허용 순서로 설정해 주세요.</p><p>기기마다 한 매장의 알림을 연결합니다. 다른 매장으로 전환하거나 로그아웃하면 이 기기 연결을 해제합니다. 본사로 돌아가거나 앱을 닫아도 연결한 매장 푸시는 유지됩니다. 화면 알림은 약 3초 간격으로 확인하며, 기기 알림과 소리는 운영체제의 알림·집중 모드·배터리 설정에 따릅니다.</p></details></section>`;}
function clearBanner(){newOrders=[];const host=document.querySelector('#order-alert');if(host){host.hidden=true;host.replaceChildren();}}
function announce(events){
 const additions=events.filter(e=>['PAID','PREPARING','READY'].includes(e.status)&&Date.now()-e.created_at<=300000);
 if(!additions.length)return;
 newOrders=[...newOrders,...additions].slice(-50);const host=document.querySelector('#order-alert');
 if(host){host.hidden=false;host.innerHTML=`<div><strong>${escapeText(additions.at(-1).store_name)} · 새 주문 ${newOrders.length}건</strong><p>${newOrders.slice(-5).map(e=>String(e.number).padStart(3,'0')+'번').join(', ')} 주문이 접수되었습니다.</p></div><div class="actions"><button class="primary" data-alert-orders>주문 확인</button><button class="text-btn" data-alert-dismiss>닫기</button></div>`;}
 if(audio?.state==='running')try{const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.frequency.value=880;gain.gain.setValueAtTime(.13,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.35);oscillator.connect(gain);gain.connect(audio.destination);oscillator.start();oscillator.stop(audio.currentTime+.35);}catch{}
 onChange();
}
async function poll(){
 if(!context||pollBusy||document.hidden||!navigator.onLine)return;
 const own=epoch,c=context;pollBusy=true;
 const run=async()=>{if(own!==epoch)return;const cursor=storedCursor();const result=await api('/api/admin/notifications'+(cursor===null?'':'?after='+cursor));if(own!==epoch)return;localStorage.setItem(channelKey(c),String(result.cursor));connection='화면 알림 연결됨 · 약 3초 간격';announce(result.events);paint();};
 try{if(navigator.locks)await navigator.locks.request('order-notice:'+channelKey(c),{ifAvailable:true},lock=>lock?run():undefined);else await run();}
 catch(e){if(own!==epoch)return;if([401,403].includes(e.status)){stopNotifications();onUnauthorized(e);}else{connection='알림 연결 끊김 · 재연결 중';paint();}}
 finally{pollBusy=false;}
}
export function stopNotifications(){epoch++;context=null;clearInterval(interval);clearBanner();audio?.close().catch(()=>{});audio=null;}
export function startNotifications({account,store,active,onOrders,onAuthError}){
 onChange=onOrders;onUnauthorized=onAuthError;
 if(!active||!account){if(context)stopNotifications();return;}
 if(context?.uid===account.uid&&context.store===store)return;
 stopNotifications();context={uid:account.uid,store};config=null;binding=null;device='이 기기 알림 확인 중…';connection='화면 알림 연결 중…';const own=epoch;
 void (async()=>{
  let saved=await pushState('binding').catch(()=>null);
  if(own!==epoch)return;
  if(saved&&(saved.uid!==account.uid||saved.store_id!==store)){await disconnectPush(saved);saved=null;}
  if(own!==epoch)return;const fetched=await api('/api/admin/notifications/config');if(own!==epoch)return;config=fetched;
  if(saved){const result=await api('/api/admin/notifications/status',{id:saved.id});if(own!==epoch)return;if(result.binding?.generation===saved.generation){binding=result.binding;await pushState('binding',binding);}else await disconnectPush(saved);}
  if(own!==epoch)return;
  if(supported()){await registration();device=binding?'이 기기 알림 켜짐 · '+config.store.name:Notification.permission==='denied'?'알림 차단됨 · 브라우저 설정에서 허용해 주세요.':'이 기기 알림 꺼짐';}
  else device='휴대폰은 지원 브라우저 또는 홈 화면 앱에서 연결해 주세요.';
  paint();
 })().catch(()=>{if(own===epoch){device='기기 알림 연결을 확인해 주세요.';paint();}});
 void poll();interval=setInterval(poll,3000);
}
async function disconnectPush(saved=binding,tokenSnapshot){
 await bindingLock(async()=>{
  const current=await pushState('binding').catch(()=>null);
  if(current&&(!saved||current.id!==saved.id||current.generation!==saved.generation))return;
  await pushState('binding',null).catch(()=>{});binding=null;
  if(saved)await api('/api/account/notifications/unsubscribe',{id:saved.id,generation:saved.generation},tokenSnapshot).catch(()=>{});
  if(supported())try{const r=await registration();const subscription=await r.pushManager.getSubscription();if(subscription)await subscription.unsubscribe();for(const n of await r.getNotifications())n.close();}catch{}
  device='이 기기 알림 꺼짐';paint();
 });
}
export async function logoutNotifications(tokenSnapshot){stopNotifications();const saved=await pushState('binding').catch(()=>null);await disconnectPush(saved,tokenSnapshot);}
async function enablePush(){
 if(pushBusy||!context||!config?.push_available||!supported())return;
 const own=epoch;pushBusy=true;paint();
 try{
  const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
  if(permission!=='granted')throw new Error('알림을 허용해야 휴대폰으로 받을 수 있습니다.');
  await bindingLock(async()=>{
   const r=await registration();if(own!==epoch)return;
   const key=Uint8Array.from(atob(config.public_key.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
   let subscription=await r.pushManager.getSubscription();if(!subscription)subscription=await r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
   if(own!==epoch)return;
   const result=await api('/api/admin/notifications/subscribe',{subscription:subscription.toJSON()});
   if(own!==epoch){await api('/api/account/notifications/unsubscribe',{id:result.id,generation:result.generation}).catch(()=>{});await subscription.unsubscribe().catch(()=>{});return;}
   binding=result;await pushState('binding',binding);device='이 기기 알림 켜짐 · '+config.store.name;
  });
 }catch(e){device=e.message;}finally{pushBusy=false;paint();}
}
export function notificationClick(button){
 if(button.hasAttribute('data-push-test')){if(binding&&!pushBusy){pushBusy=true;paint();void api('/api/admin/notifications/test',{id:binding.id,generation:binding.generation}).then(()=>{device='연결 확인 알림 요청 완료 · 기기 알림함을 확인해 주세요.';}).catch(e=>{device=e.message;}).finally(()=>{pushBusy=false;paint();});}return true;}
 if(button.hasAttribute('data-push-enable')){void enablePush();return true;}
 if(button.hasAttribute('data-push-disable')){void disconnectPush();return true;}
 if(button.hasAttribute('data-notification-sound')){if(audio){audio.close().catch(()=>{});audio=null;paint();}else{const Audio=window.AudioContext??window.webkitAudioContext;if(Audio){audio=new Audio();void audio.resume().then(paint).catch(()=>{audio=null;paint();});}}return true;}
 if(button.hasAttribute('data-alert-dismiss')){clearBanner();return true;}
 return false;
}
export function clearOrderAlert(){clearBanner();}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void poll();});
window.addEventListener('online',()=>void poll());
window.addEventListener('offline',()=>{if(context){connection='인터넷 연결 끊김 · 재연결 중';paint();}});
if('serviceWorker'in navigator)navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='KIOSK_ORDER_PUSH'&&event.data.store_id===context?.store)void poll();});
