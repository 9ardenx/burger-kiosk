import {api, app, escapeText, money, itemsHtml, notice} from "./common.js";

const tabs=document.querySelector("#tabs");
const states={PAID:"결제완료",PREPARING:"조리중",READY:"준비완료",COMPLETED:"수령완료"};
const nextLabels={PAID:"조리 시작",PREPARING:"준비 완료",READY:"수령 완료"};
let current="orders", orders=[], menu=[], busy=false, selected=null, filter="open", timer;
function login() {
  clearInterval(timer);
  tabs.hidden=true;
  app.innerHTML=`<div class="login panel"><h1>관리자 로그인</h1><p class="muted">매장 메뉴와 주문을 관리합니다.</p>
    <form id="login"><label>관리자 암호<input type="password" name="password" autocomplete="current-password" required></label>
    <button class="primary wide">로그인</button></form></div>`;
}
function menuView() {
  return `<div class="heading"><h1>메뉴 관리</h1><p>판매 가격과 품절 여부를 변경할 수 있습니다.</p></div><div class="admin-menus">
    ${menu.map(item=>`<form class="panel menu-edit" data-menu="${item.id}"><div class="edit-heading"><img alt="" src="./assets/${item.kind==="chicken"?"chicken":"classic"}.svg"><h2>${escapeText(item.name)}</h2></div>
    <label>판매 가격 (원)<input required type="number" name="price" min="0" max="1000000" step="1" value="${item.base_price}"></label>
    <label>판매 상태<select name="sold"><option value="no" ${item.is_sold_out?"":"selected"}>판매 중</option><option value="yes" ${item.is_sold_out?"selected":""}>품절</option></select></label>
    <button class="primary wide">변경 저장</button></form>`).join("")}</div>`;
}
function ordersView() {
  const rows=orders.filter(o=>filter==="all" || (filter==="done"?o.status==="COMPLETED":o.status!=="COMPLETED"));
  const detail=rows.find(o=>o.id===selected);
  return `<div class="heading split"><div><h1>주문 현황</h1><p>결제가 끝난 주문을 확인하고 다음 단계로 이동하세요.</p></div>
    <button class="secondary" data-act="refresh">새로고침</button></div>
    <div class="filters">${[["open","진행 중"],["done","수령 완료"],["all","전체"]].map(([id,name])=>`<button data-filter="${id}" aria-pressed="${filter===id}">${name}</button>`).join("")}</div>
    <div class="panel orders-panel"><div class="order-head"><span>주문번호</span><span>주문 내역</span><span>현재 상태</span><span>다음 단계</span></div>
    ${rows.length?rows.map(o=>`<div class="order-grid"><button class="num-link" data-detail="${o.id}" aria-label="주문 ${o.number} 상세">${String(o.number).padStart(3,"0")}</button>
    <div><strong>${escapeText(o.items[0].name)}${o.items.length>1?" 외 "+(o.items.length-1)+"종":""}</strong><small>${o.items.reduce((s,i)=>s+i.quantity,0)}개 · ${money(o.total)}</small></div>
    <span class="status ${o.status.toLowerCase()}">${states[o.status]}</span>${nextLabels[o.status]?`<button class="primary compact" data-next="${o.id}" data-status="${o.status}">${nextLabels[o.status]}</button>`:"<span>—</span>"}</div>`).join(""):'<div class="table-empty">표시할 주문이 없습니다.</div>'}</div>
    ${detail?`<section class="panel order-detail"><h2>${String(detail.number).padStart(3,"0")}번 주문 상세</h2>${itemsHtml(detail.items)}<div class="total"><span>결제 금액</span><strong>${money(detail.total)}</strong></div></section>`:""}`;
}
function render() {
  tabs.hidden=false;
  tabs.innerHTML=`<button data-tab="orders" aria-pressed="${current==="orders"}">주문 현황</button><button data-tab="menu" aria-pressed="${current==="menu"}">메뉴 관리</button><button class="logout" data-act="logout">로그아웃</button>`;
  app.innerHTML=current==="menu"?menuView():ordersView();
}
async function refresh() {
  if(current==="orders") orders=(await api("/api/admin/orders")).orders;
  else menu=(await api("/api/admin/menu")).menu;
  render();
}
async function act(task, silent=false) {
  if(busy)return;
  busy=true;if(!silent)notice();
  try{await task();}
  catch(error){
    if(error.status===401)login();
    else if(error.status===409)await refresh();
    if(!silent || error.status!==401)notice(error.message);
  } finally{busy=false;}
}
function poll() {
  clearInterval(timer);
  timer=setInterval(()=>{if(current==="orders"&&!document.hidden&&!tabs.hidden)act(refresh,true);},8000);
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
    const item=menu.find(m=>m.id===Number(form.dataset.menu));
    await api("/api/admin/menu/"+item.id,{base_price:Number(data.get("price")),is_sold_out:data.get("sold")==="yes",version:item.version});
    await refresh();notice(item.name+" 변경을 저장했습니다.");
  });
});
document.addEventListener("click",event=>{
  const b=event.target.closest("button");
  if(!b || b.type==="submit" && b.closest("form"))return;
  act(async()=>{
    if(b.dataset.tab){current=b.dataset.tab;await refresh();}
    else if(b.dataset.filter){filter=b.dataset.filter;render();}
    else if(b.dataset.detail){selected=selected===b.dataset.detail?null:b.dataset.detail;render();}
    else if(b.dataset.next){await api("/api/admin/orders/"+b.dataset.next,{expected:b.dataset.status});await refresh();}
    else if(b.dataset.act==="refresh")await refresh();
    else if(b.dataset.act==="logout"){await api("/api/admin/logout",{});login();}
  });
});
act(async()=>{await refresh();poll();},true);
