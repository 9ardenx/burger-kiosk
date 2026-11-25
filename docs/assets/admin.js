import {handleVariantButton} from "./group-editor.js";
import {editorHtml,editorData,optionRow} from "./menu-editor.js";
import {categoryName,menuPicture} from "./catalog.js";
import {api, app, escapeText, money, itemsHtml, notice} from "./common.js";

const tabs=document.querySelector("#tabs");
const states={PAID:"결제완료",PREPARING:"조리중",READY:"준비완료",COMPLETED:"수령완료"};
const nextLabels={PAID:"조리 시작",PREPARING:"준비 완료",READY:"수령 완료"};
let current="orders", orders=[], menu=[], busy=false, selected=null, filter="open", timer;
let editor=null, previewUrl=null;
let menuRevision=0, savedMenuIds=[], readSequence=0, orderEpoch=0, sessionEpoch=0;
const pendingOrders=new Set();
const orderDirty=()=>JSON.stringify(menu.map(m=>m.id))!==JSON.stringify(savedMenuIds);
function resetPreview(){if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;}
function closeEditor(){resetPreview();editor=null;}
function login() {
  sessionEpoch++;orderEpoch++;pendingOrders.clear();
  closeEditor();
  clearInterval(timer);
  tabs.hidden=true;
  app.innerHTML=`<div class="login panel"><h1>관리자 로그인</h1><p class="muted">매장 메뉴와 주문을 관리합니다.</p>
    <form id="login"><label>관리자 암호<input type="password" name="password" autocomplete="current-password" required></label>
    <button class="primary wide">로그인</button></form></div>`;
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
      <div><small>${index+1}번째 · ${categoryName(item.category)} · ${item.is_sold_out?"품절":"판매 중"}</small><h2>${escapeText(item.name)}</h2>
      <strong>${money(item.base_price)}</strong></div><button class="secondary" data-edit-menu="${item.id}" ${orderDirty()?"disabled":""} aria-label="${escapeText(item.name)} 수정">수정</button>
      <div class="menu-position"><button class="secondary" data-move-menu="${item.id}" data-direction="-1" ${index===0?"disabled":""} aria-label="${escapeText(item.name)} 앞으로 이동">앞으로</button>
      <button class="secondary" data-move-menu="${item.id}" data-direction="1" ${index===menu.length-1?"disabled":""} aria-label="${escapeText(item.name)} 뒤로 이동">뒤로</button></div></article>`).join("")}</div>`;

}
function ordersView() {
  return `<div class="heading split"><div><h1>주문 현황</h1><p>결제가 끝난 주문을 확인하고 다음 단계로 이동하세요.</p></div>
    <button class="secondary" data-act="refresh">새로고침</button></div>
    <div class="filters">${[["open","진행 중"],["done","수령 완료"],["all","전체"]].map(([id,name])=>`<button data-filter="${id}" aria-pressed="${filter===id}">${name}</button>`).join("")}</div>
    <div class="panel orders-panel"><div class="order-head"><span>주문번호</span><span>주문 내역</span><span>현재 상태</span><span>다음 단계</span></div>
    <div id="order-rows"></div></div><div id="order-detail"></div>`;
}

function patchOrders() {
  const host=document.querySelector("#order-rows");if(!host)return;
  const rows=orders.filter(o=>filter==="all" || (filter==="done"?o.status==="COMPLETED":o.status!=="COMPLETED"));
  const wanted=new Set(rows.map(o=>o.id));
  for(const child of [...host.children])if(!wanted.has(child.dataset.orderId))child.remove();
  rows.forEach((o,index)=>{
    let row=host.querySelector(`[data-order-id="${o.id}"]`);
    if(!row){row=document.createElement("div");row.className="order-grid";row.dataset.orderId=o.id;}
    const signature=JSON.stringify(o);
    if(row.dataset.record!==signature){
      row.innerHTML=`<button class="num-link" data-detail="${o.id}" aria-label="주문 ${o.number} 상세">${String(o.number).padStart(3,"0")}</button>
        <div><strong>${escapeText(o.items[0].name)}${o.items.length>1?" 외 "+(o.items.length-1)+"종":""}</strong><small>${o.items.reduce((s,i)=>s+i.quantity,0)}개 · ${money(o.total)}</small></div>
        <span class="status ${o.status.toLowerCase()}">${states[o.status]}</span>${nextLabels[o.status]?`<button class="primary compact" data-next="${o.id}" data-status="${o.status}">${nextLabels[o.status]}</button>`:"<span>—</span>"}`;
      row.dataset.record=signature;
    }
    if(host.children[index]!==row)host.insertBefore(row,host.children[index]??null);
    const pending=pendingOrders.has(o.id), button=row.querySelector("[data-next]");
    if(row.getAttribute("aria-busy")!==String(pending))row.setAttribute("aria-busy",String(pending));
    if(button){button.disabled=pending;const label=pending?"처리 중…":nextLabels[o.status];if(button.textContent!==label)button.textContent=label;}
  });
  if(!rows.length&&!host.children.length)host.innerHTML='<div class="table-empty">표시할 주문이 없습니다.</div>';
  const detail=rows.find(o=>o.id===selected), target=document.querySelector("#order-detail");
  const html=detail?`<section class="panel order-detail"><h2>${String(detail.number).padStart(3,"0")}번 주문 상세</h2>${itemsHtml(detail.items)}<div class="total"><span>결제 금액</span><strong>${money(detail.total)}</strong></div></section>`:"";
  if(target.innerHTML!==html)target.innerHTML=html;
}
function render() {
  tabs.hidden=false;
  tabs.innerHTML=`<button data-tab="orders" aria-pressed="${current==="orders"}">주문 현황</button><button data-tab="menu" aria-pressed="${current==="menu"}">메뉴 관리</button><button class="logout" data-act="logout">로그아웃</button>`;
  app.innerHTML=current==="menu"?menuView():ordersView();
  if(current==="orders")patchOrders();
  setRequestState(busy);
}
async function refresh() {
  if(current==="orders"){await refreshOrders();if(!document.querySelector("#order-rows"))render();return;}
  const data=await api("/api/admin/menu");menu=data.menu;menuRevision=data.order_revision;
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
async function advanceOrder(id,expected) {
  if(pendingOrders.has(id))return;
  const session=sessionEpoch;
  pendingOrders.add(id);orderEpoch++;patchOrders();notice();
  try{
    const result=await api("/api/admin/orders/"+id,{expected});
    if(session!==sessionEpoch)return;
    orders=orders.map(o=>o.id===id?result.order:o);
  }catch(error){
    if(session!==sessionEpoch)return;
    if(error.status===401)login();
    else {notice(error.message);if(error.status===409){pendingOrders.delete(id);await refreshOrders().catch(()=>{});}}
  }finally{if(session===sessionEpoch){pendingOrders.delete(id);orderEpoch++;if(current==="orders")patchOrders();}}
}
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
  act(async()=>{
    const data=new FormData(form);
    if(form.id==="login"){
      await api("/api/admin/login",{password:data.get("password")});
      await refresh();poll();return;
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
    form.querySelector("#photo-preview").src=menuPicture({...editor.item,category:form.elements.category.value,photo_key:null});return;
  }
  if(b.dataset.filter){filter=b.dataset.filter;for(const item of app.querySelectorAll("[data-filter]"))item.setAttribute("aria-pressed",String(item.dataset.filter===filter));patchOrders();return;}
  if(b.dataset.detail){selected=selected===b.dataset.detail?null:b.dataset.detail;patchOrders();return;}
  if(b.dataset.act==="refresh"){
    b.disabled=true;const session=sessionEpoch;
    refreshOrders().catch(error=>{if(session===sessionEpoch){if(error.status===401)login();else notice(error.message);}}).finally(()=>{b.disabled=false;});return;
  }
  if(current==="menu"&&!editor&&orderDirty()&&(b.dataset.tab||b.dataset.act==="logout")&&!confirm("저장하지 않은 메뉴 순서를 되돌리고 이동할까요?"))return;
  act(async()=>{
    if(b.dataset.tab){closeEditor();current=b.dataset.tab;await refresh();}
    else if(b.dataset.act==="logout"){await api("/api/admin/logout",{});login();}
  });
});
act(async()=>{await refresh();poll();},true);

document.addEventListener("change",event=>{
  const form=event.target.closest("#menu-editor");if(!form||!editor)return;
  const image=form.querySelector("#photo-preview");
  if(event.target.name==="photo"){
    const file=form.elements.photo.files[0];if(!file)return;
    if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>10*1024*1024){
      form.elements.photo.value="";notice("10 MB 이하의 JPG, PNG, WebP 파일을 선택해 주세요.");return;
    }
    resetPreview();previewUrl=URL.createObjectURL(file);image.src=previewUrl;delete form.dataset.clearPhoto;notice();
  } else if(event.target.name==="category" && !previewUrl && (!editor.item?.photo_key||form.dataset.clearPhoto)){
    image.src=menuPicture({...editor.item,category:form.elements.category.value,photo_key:null});
  }
});
