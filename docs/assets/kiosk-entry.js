import {api,beginLogout} from './backend.js?v=20261128-v115';
import {readDeviceStore,customerStore,DEVICE_STORE_KEY} from './device-store.js?v=20261128-v115';
import {escapeText,app} from './common.js?v=20261128-v115';
import {capturePaymentReturn} from './payment-return.js?v=20261128-v115';
const initialBinding=readDeviceStore();
function routeChanged(){return JSON.stringify(readDeviceStore())!==JSON.stringify(initialBinding);}
function customerLinks(id){
 const admin=new URL('./admin.html',location.href);admin.searchParams.set('store',String(id));admin.searchParams.set('unlock','1');admin.searchParams.set('v','20261128-v115');
 document.querySelector('.header-link').href=admin.href;
 const home=new URL('./',location.href);if(!initialBinding)home.searchParams.set('store',String(id));document.querySelector('.brand').href=home.href;
}
async function enter(){
 // Device identity is public routing information; it never authorizes administration.
 beginLogout();
 const returned=capturePaymentReturn(location.href,initialBinding,sessionStorage);
 if(returned){history.replaceState(null,'',returned.clean);if(returned.error){app.innerHTML=`<section class="panel"><h1>결제 결과 확인</h1><p>${escapeText(returned.error)}</p><a href="./">키오스크로 돌아가기</a></section>`;return;}}
 const id=customerStore(initialBinding,location.href);
 if(!id){location.replace(new URL('./setup.html?v=20261128-v115',location.href));return;}
 const url=new URL(location.href);url.searchParams.set('store',String(id));history.replaceState(null,'',url);customerLinks(id);
 try{
  await api('/api/menu');
  if(routeChanged()){location.replace('./');return;}
  await import('./kiosk.js?v=20261128-v115');
 }catch(error){
  const unavailable=error.code==='STORE_NOT_FOUND';
  app.innerHTML=`<section class="login panel"><h1>${unavailable?'매장 연결을 확인해 주세요':'매장에 연결하지 못했어요'}</h1><p>${escapeText(unavailable?'연결된 매장을 이용할 수 없습니다. 점주가 로그인해 매장 상태와 기기 연결을 확인해 주세요.':error.message)}</p><div class="actions"><button class="primary" data-retry-entry>다시 시도</button><a class="secondary" href="./setup.html?v=20261128-v115">매장 연결 설정</a></div></section>`;
  app.querySelector('[data-retry-entry]').onclick=()=>location.reload();
 }
}
window.addEventListener('storage',event=>{if((event.key===DEVICE_STORE_KEY||event.key===null)&&routeChanged())location.replace('./');});
window.addEventListener('pageshow',event=>{if(event.persisted){beginLogout();if(routeChanged())location.replace('./');}});
void enter();
