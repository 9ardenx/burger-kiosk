import {api,beginLogout} from './backend.js?v=20261128-v114';
import {configureAccountAuth,signInEmail,sendPasswordReset} from './account-client.js?v=20261128-v114';
import {logoutNotifications} from './notifications.js?v=20261128-v114';
import {readDeviceStore,writeDeviceStore,removeDeviceStore,setupStores} from './device-store.js?v=20261128-v114';
import {app,escapeText,notice} from './common.js?v=20261128-v114';
let connected=readDeviceStore(),identity=null,idToken=null,busy=false,ready=false,reset=false,selection=null;
const previousToken=beginLogout();
function render(){
 const stores=setupStores(identity),current=connected?`<div class="connected-store"><small>현재 연결된 매장</small><strong>${escapeText(connected.storeName)}</strong><a href="./?v=20261128-v114" class="text-btn">고객 화면으로 돌아가기</a></div>`:'';
 const intro=`<p class="steps-note">점주 로그인 · 매장 선택 · 고객 화면 시작</p><h1>${connected?'키오스크 매장 연결':'키오스크 최초 설정'}</h1><p>이 기기의 주문을 받을 매장을 연결합니다. 한 번 설정하면 다음부터 고객 화면이 바로 열립니다.</p>${current}`;
 if(!identity)app.innerHTML=`<section class="panel">${intro}<h2>${reset?'비밀번호 찾기':'점주 계정으로 로그인'}</h2><form id="setup-login"><label>이메일<input type="email" name="email" required maxlength="254" autocomplete="username"></label>${reset?'':'<label>비밀번호<input type="password" name="password" required autocomplete="off"></label>'}<button class="primary wide" ${ready?'':'disabled'}>${reset?'재설정 메일 보내기':'로그인하고 매장 선택'}</button></form><div class="account-links"><button class="text-btn" data-reset-mode>${reset?'로그인으로 돌아가기':'비밀번호를 잊으셨나요?'}</button></div><p class="muted">매장 설정에는 점주 또는 본사 권한이 필요합니다. 공용 기기에는 비밀번호를 저장하지 마세요.</p></section>`;
 else app.innerHTML=`<section class="panel">${intro}<h2>주문을 받을 매장 선택</h2>${stores.length?`<form id="setup-connect"><label>매장<select name="store" id="setup-store">${stores.map(s=>`<option value="${s.id}" ${s.id===selection?'selected':''}>${escapeText(s.name)}</option>`).join('')}</select></label><p class="setup-store-preview">이 기기에서 받은 주문은 선택한 매장으로 접수됩니다. 고객 화면으로 전환하면 관리자 로그인은 해제됩니다.</p><button class="primary wide">이 매장 키오스크로 사용</button></form>`:'<p role="status">연결할 수 있는 매장이 없습니다. 점주 권한을 확인하거나 본사에 문의해 주세요.</p>'}<button class="text-btn" data-other-account>다른 계정으로 로그인</button>${connected&&(identity.platform_role==='HQ'||stores.some(s=>s.id===connected.storeId))?'<div><button class="danger-outline" data-unlink>이 기기 매장 연결 해제</button></div>':''}</section>`;
 app.inert=busy;
}
function freshAccount(){return api('/api/account',undefined,idToken);}
function clearCustomerDrafts(){for(const key of Object.keys(sessionStorage))if(key.startsWith('burger-kiosk-session-v1')||key.startsWith('burger-kiosk.cloud.v1.customer'))sessionStorage.removeItem(key);}
async function run(task){if(busy)return;busy=true;app.inert=true;notice();try{await task();}catch(error){if(error.status===401){identity=null;idToken=null;render();}notice(error.message);}finally{busy=false;app.inert=false;}}
document.addEventListener('submit',event=>{
 const form=event.target;if(!['setup-login','setup-connect'].includes(form.id))return;event.preventDefault();
 void run(async()=>{
  const data=new FormData(form);
  if(form.id==='setup-login'){
   if(reset){await sendPasswordReset(data.get('email'));notice('가입된 이메일이면 재설정 안내가 발송됩니다.');return;}
   const password=data.get('password');form.elements.password.value='';
   idToken=(await signInEmail(data.get('email'),password)).idToken;
   try{identity=await freshAccount();}catch(error){idToken=null;throw error;}
   const stores=setupStores(identity);selection=stores.find(s=>s.id===connected?.storeId)?.id??stores[0]?.id??null;render();return;
  }
  const selected=Number(data.get('store'));identity=await freshAccount();
  if(!setupStores(identity).some(s=>s.id===selected)){render();throw new Error('선택한 매장의 점주 권한이 변경되었습니다. 다시 확인해 주세요.');}
  const catalog=await api('/api/menu',undefined,undefined,selected);
  if(connected&&connected.storeId!==selected&&!confirm('이 기기의 주문 매장을 '+catalog.store.name+'으로 변경할까요? 진행 중인 장바구니는 새 매장으로 옮겨지지 않습니다.'))return;
  writeDeviceStore(catalog.store);await logoutNotifications(previousToken||idToken).catch(()=>{});clearCustomerDrafts();idToken=null;identity=null;beginLogout();location.replace('./?v=20261128-v114');
 });
});
document.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button||busy)return;
 if(button.hasAttribute('data-reset-mode')){reset=!reset;notice();render();}
 if(button.hasAttribute('data-other-account')){identity=null;idToken=null;notice();render();}
 if(button.hasAttribute('data-unlink'))void run(async()=>{
  identity=await freshAccount();connected=readDeviceStore();
  if(connected&&identity.platform_role!=='HQ'&&!setupStores(identity).some(s=>s.id===connected.storeId))throw new Error('연결된 매장의 점주 권한이 필요합니다.');
  if(!confirm('이 기기의 매장 연결을 해제할까요? 매장의 메뉴·사진·주문은 그대로 유지됩니다.'))return;
  removeDeviceStore();clearCustomerDrafts();connected=null;identity=null;idToken=null;render();notice('기기 연결을 해제했습니다. 사용할 매장을 다시 연결해 주세요.');
 });
});
window.addEventListener('pagehide',()=>{idToken=null;identity=null;});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
render();void run(async()=>{const config=await api('/api/auth/config');configureAccountAuth(config);if(!config.enabled)throw new Error('점주 이메일 로그인을 사용할 수 없습니다. 관리자에게 문의해 주세요.');ready=true;render();});
