import {franchiseView} from './franchise-ui.js?v=20261128-v112';
import {workspaceRoute,workspaceTabs,parentTab,directStores} from './workspace.js?v=20261128-v112';
import {workspaceBar,hqHomeView,hqAccountsView,hqStoreContext} from './workspace-ui.js?v=20261128-v112';
import {profileView,updateNamePreview} from './store-profile-ui.js?v=20261128-v112';
import {hqSalesView} from './hq-sales-ui.js?v=20261128-v112';
import {materialView,storeSupplyView,hqSupplyView} from './supply-ui.js?v=20261128-v112';
import {configureAccountAuth,rememberAccount,clearAccount,signInEmail,registerEmail,sendVerification,sendPasswordReset} from './account-client.js?v=20261128-v112';
import {accountLoginView,accountSettingsView,storeBar} from './accounts-ui.js?v=20261128-v112';
import {getStoreId,selectStore} from './backend.js?v=20261128-v112';
import {promotionView,promotionData,promotionPreview} from './promotions-ui.js?v=20261128-v112';
import {handleVariantButton} from "./group-editor.js?v=20261128-v112";
import {editorHtml,editorData,optionRow} from "./menu-editor.js?v=20261128-v112";
import {jpegForUpload,photoPosition} from "./menu-photo.js?v=20261128-v112";
import {categoryName,menuPicture,setCategories} from "./catalog.js?v=20261128-v112";
import {categoriesView,securityView,recoveryResult,resetView} from './settings-ui.js?v=20261128-v112';
import {adList,adEditor} from './advertising-ui.js?v=20261128-v112';
import {diningName} from './welcome.js?v=20261128-v112';
import {salesView,inventoryView,periodPreset} from './insights-ui.js?v=20261128-v112';
import {api, app, escapeText, money, itemsHtml, notice} from "./common.js?v=20261128-v112";

const tabs=document.querySelector('#tabs');
let authSettings={enabled:false,legacy_enabled:true},identity=null,memberRecords={members:[],invitations:[]},franchises={stores:[]};
const initialTab=location.hash.slice(1)||null;
let workspace=new URL(location.href).searchParams.get('workspace'),freshLogin=false;
const isStaff=()=>identity?.stores.find(s=>s.id===getStoreId())?.role==='STAFF';
const states={PAID:"결제완료",PREPARING:"조리중",READY:"준비완료",COMPLETED:"수령완료",CANCELLED:"직권취소"};
const cancelDialog=document.querySelector('#admin-cancel-dialog');
const nextLabels={PAID:"조리 시작",PREPARING:"준비 완료",READY:"수령 완료"};
let current=initialTab??'orders', orders=[], menu=[], busy=false, selected=null, filter="open", timer;
let editor=null, previewUrl=null, previewSequence=0;
let categoryDraft=[],categorySaved=[],categoryRevision=0,security=null;
let advertising={items:[],revision:0},adEdit=null,adSequence=0,adDirty=false;
let sales=null,salesPeriod=periodPreset(),inventory={items:[],history:[]},inventoryEdit=null,inventoryFilter='all';
let storeDetails=null,hqReport=null,hqPeriod={...periodPreset(),store:'all'},hqStores=[];
let materials={items:[],history:[]},materialEdit=null,supplyData=null,supplyDetail=null,ingredientEdit=null,supplyFilter={status:'open',page:0},supplyKey=crypto.randomUUID(),receiptKey=crypto.randomUUID();
const supplyBase=()=>current==='hqsupply'?'/api/account/supply/orders':'/api/admin/supply';
async function loadSupplyDetail(id){supplyDetail=await api(supplyBase()+'/'+id);receiptKey=crypto.randomUUID();render();}
let promotions={items:[],revision:0,active:[]},promotionEdit=null;
async function savePromotionCatalog(items){promotions=await api('/api/admin/promotions',{items,revision:promotions.revision});promotionEdit=null;render();}
const adPhotoOptions=form=>({width:1440,height:810,x:Number(form.elements['ad-x'].value)/100,y:Number(form.elements['ad-y'].value)/100});
async function refreshAdPreview(form){
  const sequence=++adSequence,file=form.elements['ad-photo'].files[0];if(!file)return;
  const status=form.querySelector('[data-ad-photo-state]');status.textContent='미리보기 만드는 중…';
  try{const photo=await jpegForUpload(file,adPhotoOptions(form));if(sequence!==adSequence||!form.isConnected)return;
    form.querySelector('#ad-preview').src='data:image/jpeg;base64,'+photo;status.textContent='1440 × 810px · 미리보기와 같은 사진이 저장됩니다.';
  }catch(error){if(sequence===adSequence&&form.isConnected){status.textContent=error.message;notice(error.message);}}
}
async function saveAdCatalog(items){advertising=await api('/api/admin/ads',{items,revision:advertising.revision});adEdit=null;adDirty=false;adSequence++;render();}
const categoriesDirty=()=>JSON.stringify(categoryDraft)!==JSON.stringify(categorySaved);
let menuRevision=0, savedMenuIds=[], readSequence=0, orderEpoch=0, sessionEpoch=0;
const pendingOrders=new Set();
const orderDirty=()=>JSON.stringify(menu.map(m=>m.id))!==JSON.stringify(savedMenuIds);
function resetPreview(){previewSequence++;previewUrl=null;}
async function refreshPhotoPreview(form) {
  const sequence=++previewSequence, file=form.elements.photo.files[0];
  if(!file)return;
  const state=form.querySelector('[data-photo-state]');state.textContent='미리보기 만드는 중…';
  try {
    const photo=await jpegForUpload(file,photoPosition(form));
    if(sequence!==previewSequence||!form.isConnected)return;
    previewUrl='data:image/jpeg;base64,'+photo;
    form.querySelector('#photo-preview').src=previewUrl;
    state.textContent='720 × 465px · 미리보기와 같은 사진이 저장됩니다.';
  } catch(error) {
    if(sequence!==previewSequence||!form.isConnected)return;
    state.textContent=error.message;notice(error.message);
  }
}
function closeEditor(){promotionEdit=null;resetPreview();editor=null;adEdit=null;adDirty=false;adSequence++;inventoryEdit=null;materialEdit=null;ingredientEdit=null;supplyDetail=null;}
function login(recovery=false,legacy=false) {
  identity=null;
  freshLogin=true;
  document.title='관리자 로그인 · 버거 키오스크';
  document.querySelector('.brand').lastChild.textContent='관리자 로그인';
  document.querySelector('.header-link').hidden=true;
  cancelDialog.close();
  sessionEpoch++;orderEpoch++;pendingOrders.clear();
  closeEditor();
  clearInterval(timer);
  tabs.hidden=true;
  if(authSettings.enabled&&!legacy){app.innerHTML=accountLoginView(recovery?'reset':'login',authSettings.legacy_enabled);return;}
  if(recovery){app.innerHTML=resetView();return;}
  app.innerHTML=`<div class="login panel"><h1>관리자 로그인</h1><p class="muted">매장 메뉴와 주문을 관리합니다.</p>
    <form id="login"><label>관리자 암호<input type="password" name="password" autocomplete="current-password" required></label>
    <button class="primary wide">로그인</button></form><p><button type="button" class="text-btn" data-show-recovery>암호를 잊으셨나요?</button></p></div>`;
}
function menuView() {
if(editor)return editorHtml(editor.item);
  return `<div class="heading split"><div><h1>메뉴 관리</h1><p>메뉴와 옵션, 사진, 판매 상태를 관리합니다.</p></div>
    <button class="primary" data-new-menu ${orderDirty()?"disabled":""}>+ 메뉴 등록</button></div>
    <div class="panel menu-order-toolbar"><div><strong>고객 화면의 메뉴 순서</strong><p class="muted">앞으로·뒤로 이동한 뒤 저장해 주세요. 분류 화면에도 같은 순서가 적용됩니다.</p>
    <small role="status">${orderDirty()?"저장하지 않은 순서 변경이 있습니다. 저장하거나 되돌린 뒤 메뉴를 수정해 주세요.":"현재 저장된 순서입니다. 새 메뉴는 마지막에 추가됩니다."}</small></div>
    <div class="actions"><button class="secondary" data-discard-order ${orderDirty()?"":"disabled"}>되돌리기</button><button class="primary" data-save-order ${orderDirty()?"":"disabled"}>순서 저장</button></div></div>
    <div class="admin-menus">
    ${menu.map((item,index)=>`<article class="panel catalog-card" data-menu-id="${item.id}"><img src="${menuPicture(item)}" alt="">
      <div><small>${index+1}번째 · ${escapeText(categoryName(item.category))} · ${item.is_sold_out?"수동 품절":item.stock_sold_out?'재고 소진 · 자동 품절':"판매 중"}</small><h2>${escapeText(item.name)}</h2>
      <strong>${money(item.base_price)}</strong></div><div class="catalog-actions"><button class="secondary" data-edit-menu="${item.id}" ${orderDirty()?"disabled":""} aria-label="${escapeText(item.name)} 수정">수정</button>
      <button class="${item.is_sold_out?'secondary':'danger-outline'}" data-toggle-stock="${item.id}" ${orderDirty()?"disabled":""} aria-label="${escapeText(item.name)} ${item.is_sold_out?'판매 재개':'품절 처리'}">${item.is_sold_out?'판매 재개':'품절 처리'}</button></div>
      <div class="menu-position"><button class="secondary" data-move-menu="${item.id}" data-direction="-1" ${index===0?"disabled":""} aria-label="${escapeText(item.name)} 앞으로 이동">앞으로</button>
      <button class="secondary" data-move-menu="${item.id}" data-direction="1" ${index===menu.length-1?"disabled":""} aria-label="${escapeText(item.name)} 뒤로 이동">뒤로</button></div></article>`).join("")}</div>`;

}
function ordersView() {
  return `<div class="heading split"><div><h1>주문 현황</h1><p>결제가 끝난 주문을 확인하고 다음 단계로 이동하세요.</p></div>
    <button class="secondary" data-act="refresh">새로고침</button></div>
    <div class="filters">${[["open","진행 중"],["done","수령 완료"],["cancelled","취소 내역"],["all","전체"]].map(([id,name])=>`<button data-filter="${id}" aria-pressed="${filter===id}">${name}</button>`).join("")}</div>
    <div class="panel orders-panel"><div class="order-head"><span>주문번호</span><span>주문 내역</span><span>현재 상태</span><span>다음 단계</span></div>
    <div id="order-rows"></div></div><div id="order-detail"></div>`;
}

function patchOrders() {
  const host=document.querySelector("#order-rows");if(!host)return;
  const rows=orders.filter(o=>filter==="all" || (filter==="done"?o.status==="COMPLETED":filter==="cancelled"?o.status==="CANCELLED":Boolean(nextLabels[o.status])));
  const wanted=new Set(rows.map(o=>o.id));
  for(const child of [...host.children])if(!wanted.has(child.dataset.orderId))child.remove();
  rows.forEach((o,index)=>{
    let row=host.querySelector(`[data-order-id="${o.id}"]`);
    if(!row){row=document.createElement("div");row.className="order-grid";row.dataset.orderId=o.id;}
    const signature=JSON.stringify(o);
    if(row.dataset.record!==signature){
      row.innerHTML=`<button class="num-link" data-detail="${o.id}" aria-label="주문 ${o.number} 상세">${String(o.number).padStart(3,"0")}</button>
        <div><span class="dining-tag ${o.dining_type==='TAKEOUT'?'takeout':''}">${diningName(o.dining_type)}</span><strong>${escapeText(o.items[0].name)}${o.items.length>1?" 외 "+(o.items.length-1)+"종":""}</strong><small>${o.items.reduce((s,i)=>s+i.quantity,0)}개 · ${money(o.total)}</small></div>
        <span class="status ${o.status.toLowerCase()}">${states[o.status]}</span>${nextLabels[o.status]?`<div class="order-actions"><button class="primary compact" data-next="${o.id}" data-status="${o.status}">${nextLabels[o.status]}</button>
        ${isStaff()?'':`<button class="danger-outline compact" data-cancel-order="${o.id}" aria-label="${String(o.number).padStart(3,'0')}번 주문 직권취소">직권취소</button>`}</div>`:"<span>—</span>"}`;
      row.dataset.record=signature;
    }
    if(host.children[index]!==row)host.insertBefore(row,host.children[index]??null);
    const pending=pendingOrders.has(o.id), button=row.querySelector("[data-next]");
    if(row.getAttribute("aria-busy")!==String(pending))row.setAttribute("aria-busy",String(pending));
    if(button){button.disabled=pending;const label=pending?"처리 중…":nextLabels[o.status];if(button.textContent!==label)button.textContent=label;}
    const cancelButton=row.querySelector('[data-cancel-order]');if(cancelButton)cancelButton.disabled=pending;
  });
  if(!rows.length&&!host.children.length)host.innerHTML='<div class="table-empty">표시할 주문이 없습니다.</div>';
  const detail=rows.find(o=>o.id===selected), target=document.querySelector("#order-detail");
  const html=detail?`<section class="panel order-detail"><h2>${String(detail.number).padStart(3,"0")}번 주문 상세</h2><p class="dining-summary">${diningName(detail.dining_type)} 주문</p>${itemsHtml(detail.items)}
    ${detail.status==='CANCELLED'?`<div class="error-note">관리자 직권취소 · ${escapeText(new Date(detail.cancelled_at.replace(' ','T')+'Z').toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))}<br>사유: ${escapeText(detail.cancel_reason||'—')}<br>${detail.restock_on_cancel===null?'이전 주문 · 재고 복원 선택 기록 없음':detail.restock_on_cancel?'차감했던 재고 복원':'재고 복원 안 함'}</div>`:''}
    <div class="total"><span>${detail.status==='CANCELLED'?'모의 결제 취소 금액':'결제 금액'}</span><strong>${money(detail.total)}</strong></div></section>`:"";
  if(target.innerHTML!==html)target.innerHTML=html;
}
function render() {
  tabs.hidden=false;
  const title=workspace==='hq'?'본사 관리':isStaff()?'직원 주문 관리':'매장 운영';
  document.title=title+' · 버거 키오스크';
  const brand=document.querySelector('.brand');brand.lastChild.textContent=title;
  const brandUrl=new URL('admin.html',location.href);brandUrl.searchParams.set('v','20261128-v112');if(workspace==='store'){brandUrl.searchParams.set('workspace','store');brandUrl.searchParams.set('store',String(getStoreId()));}brand.href=brandUrl.href;
  document.querySelector('.header-link').hidden=workspace==='hq';
  tabs.innerHTML=Object.entries(workspaceTabs(identity??{legacy:true},workspace)).filter(([id])=>(authSettings.enabled||!['accounts','storeinfo'].includes(id))&&(!isStaff()||id==='orders')).map(([id,name])=>`<button data-tab="${id}" aria-pressed="${(workspace==='hq'?parentTab(current):current)===id}">${name}</button>`).join('')+'<button class="logout" data-act="logout">로그아웃</button>';
  app.innerHTML=current==='hqsales'?hqSalesView(hqReport,hqPeriod,hqStores):current==='storeinfo'?profileView(storeDetails,identity?.platform_role==='HQ'):current==='franchise'?franchiseView(franchises):current==='accounts'?accountSettingsView(identity,memberRecords,getStoreId()):current==='promotions'?promotionView(promotions,menu,promotionEdit):current==='sales'?salesView(sales,salesPeriod):current==='inventory'?inventoryView(inventory,inventoryEdit,inventoryFilter):current==='ads'?(adEdit?adEditor(adEdit.item):adList(advertising.items)):current==='categories'?categoriesView(categoryDraft,menu,categoriesDirty()):current==='security'?securityView(security):current==="menu"?menuView():ordersView();
  if(current==='materials')app.innerHTML=materialView(materials,materialEdit);
  if(current==='supplies')app.innerHTML=storeSupplyView(supplyData,materials.items,supplyKey,supplyDetail,receiptKey);
  if(current==='hqsupply')app.innerHTML=hqSupplyView(supplyData,ingredientEdit,supplyDetail,receiptKey);
  if(current==='hqhome')app.innerHTML=hqHomeView(identity,franchises);
  if(current==='hqaccounts')app.innerHTML=hqAccountsView(identity,franchises);
  if(identity){
    if(workspace==='store')app.insertAdjacentHTML('afterbegin',storeBar(identity,getStoreId()));
    else if(['accounts','storeinfo'].includes(current))app.insertAdjacentHTML('afterbegin',hqStoreContext(identity,getStoreId(),current));
    app.insertAdjacentHTML('afterbegin',workspaceBar(identity,workspace,getStoreId(),current));
  }
  if(current==="orders")patchOrders();
  if(current==='promotions'&&promotionEdit)promotionPreview(app.querySelector('#promotion-editor'),menu);
  setRequestState(busy);
}
async function refresh() {
  if(authSettings.enabled&&!identity){
    try{identity=await api('/api/account');}
    catch(error){if(error.status===403){clearAccount();login();}throw error;}
    if(!identity.stores.length&&identity.platform_role!=='HQ'){login();throw new Error('연결된 매장이 없습니다. 점주에게 계정 등록을 요청해 주세요.');}
  }
  if(identity){
    const route=workspaceRoute(identity,{workspace,tab:current,storeId:getStoreId(),freshLogin});freshLogin=false;workspace=route.workspace;current=route.tab;
    if(route.storeId!==null&&route.storeId!==getStoreId()&&(workspace==='store'||['accounts','storeinfo'].includes(current))){selectStore(route.storeId,current,workspace);return;}
    const url=new URL(location.href);url.searchParams.set('workspace',workspace);url.hash=current;history.replaceState(null,'',url);
  }
  if(['hqhome','hqaccounts','franchise'].includes(current)){franchises=await api('/api/account/stores');render();return;}
  if(current==='materials'){materials=await api('/api/admin/ingredients');render();return;}
  if(current==='supplies'){const [orders,stock]=await Promise.all([api('/api/admin/supply?'+new URLSearchParams(supplyFilter)),api('/api/admin/ingredients')]);supplyData=orders;materials=stock;render();return;}
  if(current==='hqsupply'){supplyData=await api('/api/account/supply?'+new URLSearchParams(supplyFilter));render();return;}
  if(current==='storeinfo'){storeDetails=(await api('/api/admin/store-profile')).store;render();return;}
  if(current==='hqsales'){hqReport=await api('/api/account/sales?'+new URLSearchParams(hqPeriod));if(hqPeriod.store==='all')hqStores=hqReport.stores;render();return;}
  if(current==='accounts'){memberRecords=identity.legacy?{members:[],invitations:[]}:await api('/api/admin/accounts');render();return;}
  if(current==='promotions'){const [p,m]=await Promise.all([api('/api/admin/promotions'),api('/api/admin/menu')]);promotions=p;menu=m.menu;render();return;}
  if(current==='sales'){sales=await api('/api/admin/sales?'+new URLSearchParams(salesPeriod));render();return;}
  if(current==='inventory'){inventory=await api('/api/admin/inventory');render();return;}
  if(current==='ads'){advertising=await api('/api/admin/ads');render();return;}
  if(current==="orders"){await refreshOrders();if(!document.querySelector("#order-rows"))render();return;}
  if(current==='security'){security=await api('/api/admin/security');render();return;}
  if(current==='categories'){
    const [state,catalog]=await Promise.all([api('/api/admin/categories'),api('/api/admin/menu')]);
    categoryDraft=structuredClone(state.items);categorySaved=structuredClone(state.items);categoryRevision=state.revision;menu=catalog.menu;setCategories(state.items);render();return;
  }
  const data=await api("/api/admin/menu");menu=data.menu;menuRevision=data.order_revision;
  setCategories(data.categories);
  savedMenuIds=menu.map(m=>m.id);
  render();
}
async function refreshOrders() {
  const read=++readSequence, epoch=orderEpoch, session=sessionEpoch;
  const data=await api("/api/admin/orders");
  if(read!==readSequence||epoch!==orderEpoch||session!==sessionEpoch)return;
  orders=data.orders.map(o=>pendingOrders.has(o.id)?orders.find(previous=>previous.id===o.id)??o:o);
  if(current==="orders")patchOrders();
}
async function advanceOrder(id,expected,reason=null,restock=false) {
  if(pendingOrders.has(id))return;
  const session=sessionEpoch;
  pendingOrders.add(id);orderEpoch++;patchOrders();notice();
  try{
    const result=await api("/api/admin/orders/"+id+(reason===null?'':'/cancel'),{expected,...(reason===null?{}:{reason,restock})});
    if(session!==sessionEpoch)return;
    orders=orders.map(o=>o.id===id?result.order:o);
    if(reason!==null)notice('주문을 직권취소했습니다. 취소 내역에서 확인할 수 있습니다.');
    return true;
  }catch(error){
    if(session!==sessionEpoch)return;
    if(error.status===401)login();
    else {notice(error.message);if(error.status===409){pendingOrders.delete(id);await refreshOrders().catch(()=>{});}}
  }finally{if(session===sessionEpoch){pendingOrders.delete(id);orderEpoch++;if(current==="orders")patchOrders();}}
}
function openCancel(id) {
  const order=orders.find(o=>o.id===id);if(!order||!nextLabels[order.status]||pendingOrders.has(id))return;
  if(order.payment?.mode!=='demo'){notice('PG 결제 주문은 환불 연동 후 취소할 수 있습니다.');return;}
  cancelDialog.innerHTML=`<form id="admin-cancel-form" class="dialog-body" data-order-id="${id}" data-expected="${order.status}">
    <h2 id="admin-cancel-title">${String(order.number).padStart(3,'0')}번 주문 직권취소</h2>
    <p class="muted">${money(order.total)} 모의 결제 주문을 취소합니다. 취소 후에는 조리를 진행할 수 없습니다.</p>
    <label>취소 사유<textarea name="reason" required maxlength="200" rows="3" placeholder="예: 재료 소진으로 주문 제공 불가"></textarea></label>
    <label class="check-line"><input type="checkbox" name="restock" ${order.status==='PAID'?'checked':''}>이 주문에서 차감한 재고 복원</label>
    <p class="muted">${order.status==='PAID'?'조리 전 주문은 복원을 기본으로 선택합니다.':'조리한 음식은 다시 판매할 수 있는지 확인한 뒤 복원해 주세요.'} 실제 차감 이력이 있는 수량만 복원합니다.</p>
    <p class="error-note" data-cancel-error hidden></p><div class="actions"><button type="button" class="secondary" data-close-cancel>돌아가기</button><button class="danger" type="submit">직권취소 확정</button></div></form>`;
  cancelDialog.showModal();
}
cancelDialog.addEventListener('cancel',event=>{if(cancelDialog.querySelector('form')?.dataset.pending)event.preventDefault();});
function setRequestState(pending) {
  app.setAttribute("aria-busy", String(pending));
  app.inert=pending;
  for (const button of document.querySelectorAll("#tabs button")) {
    button.disabled = pending;
  }
}
function allowWorkspaceNavigation(){
  const dirty=editor||adDirty||promotionEdit||inventoryEdit||materialEdit||ingredientEdit||(current==='menu'&&orderDirty())||(current==='categories'&&categoriesDirty());
  return !dirty||confirm('저장하지 않은 입력을 버리고 화면을 전환할까요?');
}
async function act(task, silent=false) {
  if(busy)return;
  busy=true;setRequestState(true);if(!silent)notice();
  try{await task();}
  catch(error){
    if(error.status===401)login();
    else if(error.status===409){closeEditor();await refresh();}
    if(!silent || error.status!==401)notice(error.message);
  } finally{busy=false;setRequestState(false);}
}
function poll() {
  clearInterval(timer);
  timer=setInterval(()=>{
    if(current!=="orders"||document.hidden||tabs.hidden||busy)return;
    const session=sessionEpoch;
    refreshOrders().catch(error=>{if(session===sessionEpoch){if(error.status===401)login();else notice(error.message);}});
  },8000);
}
document.addEventListener("submit",event=>{
  event.preventDefault();
  const form=event.target;
  if(form.id==='admin-cancel-form'){
    if(form.dataset.pending)return;
    const reason=form.elements.reason.value.trim();
    if(!reason){form.elements.reason.setCustomValidity('취소 사유를 입력해 주세요.');form.elements.reason.reportValidity();return;}
    form.dataset.pending='1';form.inert=true;
    void advanceOrder(form.dataset.orderId,form.dataset.expected,reason,form.elements.restock.checked).then(ok=>{
      if(ok)cancelDialog.close();
      else {const error=form.querySelector('[data-cancel-error]');error.hidden=false;error.textContent=document.querySelector('#notice').textContent||'취소하지 못했습니다. 최신 주문 상태를 확인해 주세요.';}
    }).finally(()=>{delete form.dataset.pending;form.inert=false;});return;
  }
  act(async()=>{
    const data=new FormData(form);
    if(form.id==='open-direct-store'){selectStore(Number(data.get('store')),'orders','store');return;}
    if(form.id==='ingredient-editor'){const id=form.dataset.id;await api('/api/account/supply/ingredients'+(id?'/'+id:''),{key:data.get('key'),name:data.get('name'),active:data.has('active'),revision:Number(form.dataset.revision),...(id?{}:{unit:data.get('unit'),pack_label:data.get('pack_label'),pack_size:Number(data.get('pack_size'))})});ingredientEdit=null;await refresh();notice('공급 재료를 저장했습니다.');return;}
    if(form.id==='material-stock'){await api('/api/admin/ingredients/'+form.dataset.id,{quantity:Number(data.get('quantity')),low_threshold:Number(data.get('low_threshold')),revision:Number(form.dataset.revision),reason:data.get('reason')});materialEdit=null;await refresh();notice('재료 수량과 조정 이력을 저장했습니다.');return;}
    if(form.id==='supply-create'){const lines=[...form.querySelectorAll('[name^="packs:"]')].filter(i=>Number(i.value)>0).map(i=>({ingredient_id:Number(i.name.split(':')[1]),packs:Number(i.value),revision:Number(i.dataset.revision)}));const result=await api('/api/admin/supply',{key:data.get('key'),note:data.get('note'),lines});supplyKey=crypto.randomUUID();supplyDetail=result;render();notice('본사에 발주를 요청했습니다. 재고는 입고 확인 후 반영됩니다.');return;}
    if(form.id==='supply-transition'){supplyDetail=await api(supplyBase()+'/'+form.dataset.id,{action:event.submitter?.value,revision:Number(form.dataset.revision),note:data.get('note')});render();notice('발주 상태를 변경했습니다.');return;}
    if(form.id==='supply-receive'){const lines=[...form.querySelectorAll('[name^="receive:"]')].filter(i=>Number(i.value)>0).map(i=>({line_id:i.name.slice(8),quantity:Number(i.value)}));supplyDetail=await api('/api/admin/supply/'+form.dataset.id+'/receive',{key:data.get('key'),revision:Number(form.dataset.revision),note:data.get('note'),lines});receiptKey=crypto.randomUUID();render();notice('받은 수량을 재료 재고에 반영했습니다.');return;}
    if(form.id==='email-login'){
      rememberAccount(await signInEmail(data.get('email'),data.get('password')));identity=null;freshLogin=true;current='orders';await refresh();poll();return;
    }
    if(form.id==='email-signup'){
      await registerEmail(data.get('email'),data.get('password'));form.reset();app.innerHTML=accountLoginView('login',authSettings.legacy_enabled);notice('인증메일을 보냈습니다. 이메일의 링크를 확인한 뒤 로그인해 주세요.');return;
    }
    if(form.id==='email-reset'){
      await sendPasswordReset(data.get('email'));notice('가입된 이메일이면 재설정 안내가 발송됩니다. 받은편지함과 스팸함을 확인해 주세요.');return;
    }
    if(form.id==='claim-account'){
      const account=await signInEmail(data.get('email'),data.get('password'));
      await api('/api/admin/claim-account',{id_token:account.idToken});rememberAccount(account);authSettings.legacy_enabled=false;identity=null;freshLogin=true;current='orders';await refresh();poll();notice('기존 매장을 이메일 계정에 연결했습니다. 다음부터 이메일로 로그인해 주세요.');return;
    }
    if(form.id==='invite-account'){await api('/api/admin/accounts/invite',{email:data.get('email'),role:data.get('role')});await refresh();notice('초대를 등록했습니다. 구성원에게 관리자 화면 주소와 가입할 이메일을 알려 주세요.');return;}
    if(form.hasAttribute('data-member')){await api('/api/admin/accounts/member',{uid:form.dataset.member,revision:Number(form.dataset.revision),role:data.get('role'),enabled:data.has('enabled')});identity=null;await refresh();notice('권한을 변경했습니다. 다음 요청부터 적용됩니다.');return;}
    if(form.id==='create-store'){const result=await api('/api/account/stores',{key:data.get('key'),name:data.get('name'),owner_email:data.get('owner_email'),source_store_id:Number(data.get('source_store_id')),address:data.get('address')??'',address_detail:data.get('address_detail')??'',locality:data.get('locality')??'',address_pending:data.has('address_pending')});selectStore(result.store.id,'accounts','hq');return;}
    if(form.id==='store-profile'){await api('/api/admin/store-profile',{address:data.get('address'),address_detail:data.get('address_detail'),locality:data.get('locality'),auto_name:data.has('auto_name'),name:data.get('name')??'',revision:Number(form.dataset.revision)});identity=null;await refresh();notice('매장 주소와 점포명을 저장했습니다.');return;}
    if(form.id==='hq-sales-period'){hqPeriod={from:data.get('from'),to:data.get('to'),store:data.get('store')};await refresh();return;}
    if(form.id==='promotion-editor'){const p=promotionData(form,promotionEdit.id),items=promotions.items.map(x=>x.id===p.id?p:x);if(promotionEdit.isNew)items.push(p);await savePromotionCatalog(items);notice('할인 예약을 저장했습니다. 설정한 시간에 자동으로 적용됩니다.');return;}
    if(form.id==='sales-period'){
      salesPeriod={from:data.get('from'),to:data.get('to')};await refresh();return;
    }
    if(form.id==='inventory-editor'){
      await api('/api/admin/inventory/'+form.dataset.menuId,{enabled:data.has('enabled'),quantity:Number(data.get('quantity')),
        low_threshold:Number(data.get('low_threshold')),revision:Number(form.dataset.revision),reason:data.get('reason').trim()});
      inventoryEdit=null;await refresh();notice('재고를 저장했습니다. 고객 화면은 다음 자동 조회에 반영됩니다.');return;
    }
    if(form.id==='ad-editor'&&adEdit){
      const item={id:adEdit.id,title:data.get('ad-title').trim(),description:data.get('ad-description').trim(),enabled:data.has('ad-enabled'),placement:data.get('ad-placement')};
      if(form.elements['ad-photo'].files.length)item.photo=await jpegForUpload(form.elements['ad-photo'].files[0],adPhotoOptions(form));
      const items=advertising.items.map(a=>a.id===item.id?item:a);if(!adEdit.item)items.push(item);
      await saveAdCatalog(items);notice('광고를 저장했습니다. 고객 첫 화면의 다음 조회에 반영됩니다.');return;
    }
    if(form.id==='password-reset'){
      await api('/api/admin/reset-password',Object.fromEntries(data));current='orders';login();notice('암호를 재설정했습니다. 새 암호로 로그인한 뒤 복구 코드를 다시 발급해 주세요.');return;
    }
    if(form.id==="login"){
      await api("/api/admin/login",{password:data.get("password")});
      await refresh();poll();return;
    }
    if(form.id==='category-settings'){
      await api('/api/admin/categories',{items:categoryDraft,revision:categoryRevision});await refresh();notice('분류 이름과 순서를 저장했습니다.');return;
    }
    if(form.id==='password-settings'){
      await api('/api/admin/password',Object.fromEntries(data));current='orders';login();notice('암호를 변경했습니다. 새 암호로 로그인한 뒤 복구 코드를 다시 발급해 주세요.');return;
    }
    if(form.id==='recovery-settings'){
      const result=await api('/api/admin/recovery-code',Object.fromEntries(data));form.elements.current_password.value='';
      form.querySelector('#recovery-result').innerHTML=recoveryResult(result.code);
      form.querySelector('.info-note').textContent='복구 코드를 발급했습니다. 지금 별도로 보관해 주세요.';
      form.querySelector('[type=submit]').textContent='복구 코드 새로 발급';return;
    }
    if(form.id!=="menu-editor" || !editor)return;
    const payload=await editorData(form,editor);
    const create=!editor.item;
    await api(create?"/api/admin/menu":"/api/admin/menu/"+editor.item.id,payload);
    closeEditor();await refresh();
    notice(payload.name+(create?" 메뉴를 등록했습니다.":" 변경을 저장했습니다."));
  });
});
document.addEventListener("click",event=>{
  const b=event.target.closest("button");
  if(b&&!busy){
    if(b.hasAttribute('data-workspace-hq')){if(allowWorkspaceNavigation())act(async()=>{closeEditor();workspace='hq';current='hqhome';await refresh();});return;}
    if(b.hasAttribute('data-workspace-store')){
      const stores=directStores(identity);if(!stores.length||!allowWorkspaceNavigation())return;
      if(stores.length===1)selectStore(stores[0].id,'orders','store');
      else act(async()=>{closeEditor();workspace='hq';current='hqhome';await refresh();app.querySelector('#open-direct-store select')?.focus();});return;
    }
    if(b.hasAttribute('data-ingredient-new')){ingredientEdit={key:crypto.randomUUID(),active:1};supplyDetail=null;render();return;}
    if(b.dataset.ingredientEdit){ingredientEdit=structuredClone(supplyData.items.find(i=>i.id===Number(b.dataset.ingredientEdit)));render();return;}
    if(b.hasAttribute('data-ingredient-back')){ingredientEdit=null;render();return;}
    if(b.dataset.materialEdit){materialEdit=structuredClone(materials.items.find(i=>i.id===Number(b.dataset.materialEdit)));render();return;}
    if(b.hasAttribute('data-material-back')){materialEdit=null;render();return;}
    if(b.dataset.supplyDetail){act(()=>loadSupplyDetail(b.dataset.supplyDetail));return;}
    if(b.hasAttribute('data-supply-back')||b.hasAttribute('data-supply-refresh')){act(async()=>{supplyDetail=null;await refresh();});return;}
    if(b.hasAttribute('data-supply-page')){act(async()=>{supplyFilter.page=Number(b.dataset.supplyPage);await refresh();});return;}
    if(b.dataset.copyInvite){act(async()=>{const url=new URL('admin.html',location.href);url.searchParams.set('store',b.dataset.inviteStore);const message=`매장 관리자 가입 안내\n${url.href}\n등록된 이메일: ${b.dataset.copyInvite}\n초대받은 계정 가입 → 이메일 인증 → 로그인 순서로 진행해 주세요. 이미 계정이 있다면 로그인하면 됩니다. 초대는 등록 후 7일간 유효합니다.`;await navigator.clipboard.writeText(message);notice('가입 안내를 복사했습니다. 점주에게 전달해 주세요.');});return;}
    if(b.dataset.openStore){selectStore(Number(b.dataset.openStore),'orders','store');return;}
    if(b.dataset.storeAccounts){selectStore(Number(b.dataset.storeAccounts),'accounts','hq');return;}
    if(b.dataset.storeProfile){selectStore(Number(b.dataset.storeProfile),'storeinfo','hq');return;}
    if(b.dataset.hqDays){act(async()=>{hqPeriod={...periodPreset(Number(b.dataset.hqDays)),store:hqPeriod.store};await refresh();});return;}
    if(b.dataset.accountMode){app.innerHTML=accountLoginView(b.dataset.accountMode,authSettings.legacy_enabled);notice();return;}
    if(b.hasAttribute('data-legacy-login')){clearAccount();login(false,true);return;}
    if(b.hasAttribute('data-register-owner')||b.hasAttribute('data-verify-owner')||b.hasAttribute('data-verify-email')){
      const form=b.closest('form')??app.querySelector('form');if(!form.reportValidity())return;
      act(async()=>{const data=new FormData(form);await (b.hasAttribute('data-register-owner')?registerEmail:sendVerification)(data.get('email'),data.get('password'));form.elements.password.value='';notice('인증메일을 보냈습니다. 링크를 확인한 뒤 비밀번호를 다시 입력해 주세요.');});return;
    }
    if(b.hasAttribute('data-reset-own')){act(async()=>{await sendPasswordReset(identity.email);notice('비밀번호 재설정 안내를 이메일로 보냈습니다.');});return;}
    if(b.dataset.revokeInvite){act(async()=>{await api('/api/admin/accounts/revoke',{id:b.dataset.revokeInvite});await refresh();});return;}
  }
  if(!b || b.disabled || b.type==="submit" && b.closest("form"))return;
if(busy)return;
  if(b.hasAttribute('data-new-promotion')||b.dataset.editPromotion){promotionEdit=b.dataset.editPromotion?structuredClone(promotions.items.find(p=>p.id===b.dataset.editPromotion)):{id:crypto.randomUUID(),isNew:true,title:'',enabled:true,mode:'PERCENT',value:10,weekdays:[0,1,2,3,4,5,6],menu_ids:[],start_time:'11:00',end_time:'14:00',start_date:null,end_date:null};render();return;}
  if(b.hasAttribute('data-back-promotions')){if(confirm('저장하지 않은 할인 입력을 버리고 돌아갈까요?')){promotionEdit=null;render();}return;}
  if(b.dataset.deletePromotion){if(confirm('이 할인 예약을 삭제할까요?'))act(()=>savePromotionCatalog(promotions.items.filter(p=>p.id!==b.dataset.deletePromotion)));return;}
  if(b.dataset.togglePromotion){act(()=>savePromotionCatalog(promotions.items.map(p=>p.id===b.dataset.togglePromotion?{...p,enabled:!p.enabled}:p)));return;}
  if(b.dataset.salesDays){act(async()=>{salesPeriod=periodPreset(Number(b.dataset.salesDays));await refresh();});return;}
  if(b.dataset.inventoryEdit){inventoryEdit=structuredClone(inventory.items.find(i=>i.id===Number(b.dataset.inventoryEdit)));render();app.querySelector('[name="quantity"]').focus();return;}
  if(b.hasAttribute('data-inventory-back')){inventoryEdit=null;render();return;}
  if(b.hasAttribute('data-inventory-refresh')){act(refresh);return;}
  if(b.dataset.inventoryFilter){inventoryFilter=b.dataset.inventoryFilter;render();return;}
  if(b.hasAttribute('data-new-ad')||b.dataset.editAd){adEdit={id:b.dataset.editAd||crypto.randomUUID(),item:advertising.items.find(a=>a.id===b.dataset.editAd)??null};adDirty=false;adSequence++;render();return;}
  if(b.hasAttribute('data-back-ads')){if(adDirty&&!confirm('저장하지 않은 광고 변경을 버리고 돌아갈까요?'))return;closeEditor();render();return;}
  if(b.dataset.deleteAd){const item=advertising.items.find(a=>a.id===b.dataset.deleteAd);if(item&&confirm('「'+item.title+'」 광고를 삭제할까요?'))act(async()=>{await saveAdCatalog(advertising.items.filter(a=>a.id!==item.id));notice('광고를 삭제했습니다.');});return;}
  if(b.dataset.toggleAd){act(()=>saveAdCatalog(advertising.items.map(a=>a.id===b.dataset.toggleAd?{...a,enabled:!a.enabled}:a)));return;}
  if(b.hasAttribute('data-move-ad')){const i=Number(b.dataset.moveAd),j=i+Number(b.dataset.direction);if(j>=0&&j<advertising.items.length){const items=[...advertising.items];[items[i],items[j]]=[items[j],items[i]];act(()=>saveAdCatalog(items));}return;}
  if(b.hasAttribute('data-show-recovery')){notice();login(true);return;}
  if(b.hasAttribute('data-show-login')){notice();login();return;}
  if(b.hasAttribute('data-save-recovery')){
    const code=document.querySelector('[data-recovery-value]')?.value;if(!code)return;
    const url=URL.createObjectURL(new Blob(['버거 키오스크 관리자 일회용 복구 코드\n\n'+code+'\n\n암호 재설정 시 사용합니다. 안전한 곳에 보관하세요.\n'],{type:'text/plain;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='kiosk-recovery-code.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
  }
  if(b.hasAttribute('data-category-add')){
    if(categoryDraft.length>=20)return;categoryDraft.push({id:'cat_'+crypto.randomUUID().replaceAll('-',''),name:''});render();app.querySelector('.category-row:last-child input').focus();return;
  }
  if(b.hasAttribute('data-category-move')){
    const i=Number(b.dataset.categoryMove),j=i+Number(b.dataset.direction);if(j<0||j>=categoryDraft.length)return;
    [categoryDraft[i],categoryDraft[j]]=[categoryDraft[j],categoryDraft[i]];render();return;
  }
  if(b.hasAttribute('data-category-remove')){const i=Number(b.dataset.categoryRemove);if(categoryDraft.length>1&&!menu.some(m=>m.category===categoryDraft[i]?.id)){categoryDraft.splice(i,1);render();}return;}
  if(b.hasAttribute('data-category-discard')){categoryDraft=structuredClone(categorySaved);render();return;}
  if(b.dataset.cancelOrder){openCancel(b.dataset.cancelOrder);return;}
  if(b.hasAttribute('data-close-cancel')){cancelDialog.close();return;}
  if(b.dataset.toggleStock){
    const item=menu.find(m=>m.id===Number(b.dataset.toggleStock));if(!item||orderDirty())return;
    act(async()=>{await api('/api/admin/menu/'+item.id,{base_price:item.base_price,is_sold_out:!item.is_sold_out,version:item.version});
      await refresh();notice(item.name+(item.is_sold_out?' 판매를 재개했습니다.':' 메뉴를 품절 처리했습니다.')+' 고객 화면은 다음 자동 조회에 반영됩니다.');});return;
  }
  if(b.dataset.next){void advanceOrder(b.dataset.next,b.dataset.status);return;}
  if(b.dataset.moveMenu){
    const i=menu.findIndex(m=>m.id===Number(b.dataset.moveMenu)), j=i+Number(b.dataset.direction);
    if(i<0||j<0||j>=menu.length)return;
    [menu[i],menu[j]]=[menu[j],menu[i]];render();
    app.querySelector(`[data-move-menu="${b.dataset.moveMenu}"][data-direction="${b.dataset.direction}"]:not(:disabled)`)?.focus({preventScroll:true});return;
  }
  if(b.hasAttribute("data-discard-order")){menu.sort((a,b)=>savedMenuIds.indexOf(a.id)-savedMenuIds.indexOf(b.id));render();return;}
  if(b.hasAttribute("data-save-order")){
    act(async()=>{const result=await api("/api/admin/menu-order",{ids:menu.map(m=>m.id),revision:menuRevision});
      menuRevision=result.revision;savedMenuIds=menu.map(m=>m.id);render();notice("메뉴 순서를 저장했습니다. 고객 화면에도 적용됩니다.");});return;
  }
  if(handleVariantButton(b))return;
  if(b.hasAttribute("data-new-menu") || b.dataset.editMenu) {
    resetPreview();editor={item:menu.find(item=>item.id===Number(b.dataset.editMenu))||null,key:crypto.randomUUID()};
    notice();render();app.querySelector('[name="name"]').focus();return;
  }
  if(b.hasAttribute("data-back-menu")) {closeEditor();render();return;}
  if(b.hasAttribute("data-add-option")){
    const rows=document.querySelector("#option-rows");
    if(rows.children.length>=20){notice("옵션은 20개까지 등록할 수 있습니다.");return;}
    rows.insertAdjacentHTML("beforeend",optionRow());rows.lastElementChild.querySelector("input").focus();return;
  }
  if(b.hasAttribute("data-remove-option")){b.closest(".option-edit").remove();return;}
  if(b.hasAttribute("data-clear-photo")){
    const form=b.closest("form");resetPreview();form.elements.photo.value="";form.dataset.clearPhoto="1";
    form.querySelector('.photo-crop').hidden=true;
    form.querySelector("#photo-preview").src=menuPicture({...editor.item,category:form.elements.category.value,photo_key:null});return;
  }
  if(b.dataset.filter){filter=b.dataset.filter;for(const item of app.querySelectorAll("[data-filter]"))item.setAttribute("aria-pressed",String(item.dataset.filter===filter));patchOrders();return;}
  if(b.dataset.detail){selected=selected===b.dataset.detail?null:b.dataset.detail;patchOrders();return;}
  if(b.dataset.act==="refresh"){
    b.disabled=true;const session=sessionEpoch;
    refreshOrders().catch(error=>{if(session===sessionEpoch){if(error.status===401)login();else notice(error.message);}}).finally(()=>{b.disabled=false;});return;
  }
  if(current==="menu"&&!editor&&orderDirty()&&(b.dataset.tab||b.dataset.act==="logout")&&!confirm("저장하지 않은 메뉴 순서를 되돌리고 이동할까요?"))return;
  if(current==='categories'&&categoriesDirty()&&(b.dataset.tab||b.dataset.act==='logout')&&!confirm('저장하지 않은 분류 변경을 되돌리고 이동할까요?'))return;
  if(current==='ads'&&adDirty&&(b.dataset.tab||b.dataset.act==='logout')&&!confirm('저장하지 않은 광고 변경을 버리고 이동할까요?'))return;
  if(current==='promotions'&&promotionEdit&&(b.dataset.tab||b.dataset.act==='logout')&&!confirm('저장하지 않은 할인 입력을 버리고 이동할까요?'))return;
  if(current==='inventory'&&inventoryEdit&&(b.dataset.tab||b.dataset.act==='logout')&&!confirm('저장하지 않은 재고 입력을 버리고 이동할까요?'))return;
  act(async()=>{
    if(b.dataset.tab){closeEditor();current=b.dataset.tab;await refresh();}
    else if(b.dataset.act==="logout"){await api("/api/admin/logout",{});login();}
  });
});
act(async()=>{
  try{authSettings=await api('/api/auth/config');}catch(e){if(e.status!==404)throw e;}
  configureAccountAuth(authSettings);await refresh();poll();
},true);

document.addEventListener("change",event=>{
  if(event.target.id==='supply-status'){act(async()=>{supplyFilter={status:event.target.value,page:0};await refresh();});return;}
  if(event.target.id==='account-store'){
    if(busy){event.target.value=String(getStoreId());return;}
    if((editor||adEdit||promotionEdit||inventoryEdit||orderDirty()||categoriesDirty())&&!confirm('작성 중인 내용을 버리고 매장을 바꿀까요?')){event.target.value=String(getStoreId());return;}
    if(allowWorkspaceNavigation())selectStore(Number(event.target.value),current,'store');else event.target.value=String(getStoreId());return;
  }
  const adForm=event.target.closest('#ad-editor');if(adForm){adDirty=true;if(event.target.name==='ad-photo'){adForm.elements['ad-x'].value=50;adForm.elements['ad-y'].value=50;adForm.querySelector('.ad-crop').hidden=false;void refreshAdPreview(adForm);}return;}
  const form=event.target.closest("#menu-editor");if(!form||!editor)return;
  const image=form.querySelector("#photo-preview");
  if(event.target.name==="photo"){
    const file=form.elements.photo.files[0];if(!file)return;
    if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>10*1024*1024){
      resetPreview();form.elements.photo.value="";form.querySelector('.photo-crop').hidden=true;
      image.src=menuPicture({...editor.item,category:form.elements.category.value,...(form.dataset.clearPhoto?{photo_key:null}:{})});
      notice("10 MB 이하의 JPG, PNG, WebP 파일을 선택해 주세요.");return;
    }
    resetPreview();form.elements['photo-x'].value=50;form.elements['photo-y'].value=50;
    form.querySelector('.photo-crop').hidden=false;delete form.dataset.clearPhoto;notice();
    void refreshPhotoPreview(form);
  } else if(event.target.name==="category" && !form.elements.photo.files.length && (!editor.item?.photo_key||form.dataset.clearPhoto)){
    image.src=menuPicture({...editor.item,category:form.elements.category.value,photo_key:null});
  }
});
document.addEventListener('input',event=>{
  const adForm=event.target.closest('#ad-editor');if(adForm){adDirty=true;if(['ad-x','ad-y'].includes(event.target.name))void refreshAdPreview(adForm);return;}
  if(event.target.hasAttribute('data-category-name')){
    const item=categoryDraft.find(c=>c.id===event.target.dataset.categoryName);if(item)item.name=event.target.value;
    const status=document.querySelector('[data-category-dirty]');if(status)status.textContent=categoriesDirty()?'저장하지 않은 변경이 있습니다.':'현재 저장된 분류입니다.';return;
  }
  if(event.target.name==='reason'){event.target.setCustomValidity('');return;}
  if(!['photo-x','photo-y'].includes(event.target.name))return;
  const form=event.target.closest('#menu-editor');if(form&&editor)void refreshPhotoPreview(form);
});

document.addEventListener('input',event=>{const form=event.target.closest('#promotion-editor');if(form)promotionPreview(form,menu);});

for(const type of ['input','change'])document.addEventListener(type,event=>{const form=event.target.closest('#create-store,#store-profile');if(form)updateNamePreview(form);});
