import {handleVariantButton} from "./group-editor.js";
import {editorHtml,editorData,optionRow} from "./menu-editor.js";
import {jpegForUpload,photoPosition} from "./menu-photo.js";
import {categoryName,menuPicture,setCategories} from "./catalog.js";
import {categoriesView,securityView,recoveryResult,resetView} from './settings-ui.js';
import {adList,adEditor} from './advertising-ui.js';
import {diningName} from './welcome.js';
import {salesView,inventoryView,periodPreset} from './insights-ui.js';
import {api, app, escapeText, money, itemsHtml, notice} from "./common.js";

const tabs=document.querySelector("#tabs");
const states={PAID:"결제완료",PREPARING:"조리중",READY:"준비완료",COMPLETED:"수령완료",CANCELLED:"직권취소"};
const cancelDialog=document.querySelector('#admin-cancel-dialog');
const nextLabels={PAID:"조리 시작",PREPARING:"준비 완료",READY:"수령 완료"};
let current="orders", orders=[], menu=[], busy=false, selected=null, filter="open", timer;
let editor=null, previewUrl=null, previewSequence=0;
let categoryDraft=[],categorySaved=[],categoryRevision=0,security=null;
let advertising={items:[],revision:0},adEdit=null,adSequence=0,adDirty=false;
let sales=null,salesPeriod=periodPreset(),inventory={items:[],history:[]},inventoryEdit=null,inventoryFilter='all';
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
function closeEditor(){resetPreview();editor=null;adEdit=null;adDirty=false;adSequence++;inventoryEdit=null;}
function login(recovery=false) {
  cancelDialog.close();
  sessionEpoch++;orderEpoch++;pendingOrders.clear();
  closeEditor();
  clearInterval(timer);
  tabs.hidden=true;
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
        <button class="danger-outline compact" data-cancel-order="${o.id}" aria-label="${String(o.number).padStart(3,'0')}번 주문 직권취소">직권취소</button></div>`:"<span>—</span>"}`;
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
  tabs.innerHTML=Object.entries({orders:'주문 현황',sales:'매출 분석',inventory:'재고 관리',menu:'메뉴 관리',categories:'분류 관리',ads:'광고 관리',security:'암호 관리'}).map(([id,name])=>`<button data-tab="${id}" aria-pressed="${current===id}">${name}</button>`).join('')+'<button class="logout" data-act="logout">로그아웃</button>';
  app.innerHTML=current==='sales'?salesView(sales,salesPeriod):current==='inventory'?inventoryView(inventory,inventoryEdit,inventoryFilter):current==='ads'?(adEdit?adEditor(adEdit.item):adList(advertising.items)):current==='categories'?categoriesView(categoryDraft,menu,categoriesDirty()):current==='security'?securityView(security):current==="menu"?menuView():ordersView();
  if(current==="orders")patchOrders();
  setRequestState(busy);
}
async function refresh() {
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
    if(form.id==='sales-period'){
      salesPeriod={from:data.get('from'),to:data.get('to')};await refresh();return;
    }
    if(form.id==='inventory-editor'){
      await api('/api/admin/inventory/'+form.dataset.menuId,{enabled:data.has('enabled'),quantity:Number(data.get('quantity')),
        low_threshold:Number(data.get('low_threshold')),revision:Number(form.dataset.revision),reason:data.get('reason').trim()});
      inventoryEdit=null;await refresh();notice('재고를 저장했습니다. 고객 화면은 다음 자동 조회에 반영됩니다.');return;
    }
    if(form.id==='ad-editor'&&adEdit){
      const item={id:adEdit.id,title:data.get('ad-title').trim(),description:data.get('ad-description').trim(),enabled:data.has('ad-enabled')};
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
  if(!b || b.disabled || b.type==="submit" && b.closest("form"))return;
if(busy)return;
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
  if(current==='inventory'&&inventoryEdit&&(b.dataset.tab||b.dataset.act==='logout')&&!confirm('저장하지 않은 재고 입력을 버리고 이동할까요?'))return;
  act(async()=>{
    if(b.dataset.tab){closeEditor();current=b.dataset.tab;await refresh();}
    else if(b.dataset.act==="logout"){await api("/api/admin/logout",{});login();}
  });
});
act(async()=>{await refresh();poll();},true);

document.addEventListener("change",event=>{
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
