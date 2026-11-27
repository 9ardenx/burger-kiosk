import {priceHtml,promotionNote,setPriceClock,tickDiscounts} from './promotion-price.js?v=20261127-v171';
import {evaluateGroups} from "./choice-rules.js?v=20261127-v171";
import {labels, menuPicture, setCategories} from "./catalog.js?v=20261127-v171";
import {api, app, money, escapeText, itemsHtml, notice} from "./common.js?v=20261127-v171";
import {welcomeView,heroView,diningName} from './welcome.js?v=20261127-v171';
import {buildAdSlides} from './ad-slides.js?v=20261127-v171';

const storageKey = "burger-kiosk-session-v1";
const defaults = () => ({cart: [], page: "welcome", diningType:null, checkoutKey: null, orderId: null, attemptKey: null, callback: null});
let state;
try { state = {...defaults(), ...JSON.parse(sessionStorage.getItem(storageKey))}; }
catch { state = defaults(); }
let menu = [], mode = "demo", clientKey = "", order = null, busy = false;
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
let ads=[],adCatalog=[],adIndex=0,adPaused=reducedMotion.matches,adElapsed=0,adLastTick=performance.now(),adAnimation=null;
const AD_INTERVAL=10000;
function resetAdClock(){adElapsed=0;adLastTick=performance.now();}
const validDining=()=>['DINE_IN','TAKEOUT'].includes(state.diningType);
function updateAdSlides(preserve=true){
 const id=preserve?ads[adIndex]?.id:null;ads=buildAdSlides(adCatalog,menu);
 const index=ads.findIndex(a=>a.id===id);adIndex=Math.max(0,index);if(index<0)resetAdClock();
}
async function loadAds(){try{adCatalog=(await api('/api/ads')).items;updateAdSlides(false);}catch{/* Ordering remains available without advertising. */}}
function paintAd(direction=0){
 const host=document.querySelector('#welcome-ad');if(!host)return;
 adAnimation?.cancel();adAnimation=null;
 const previous=host.querySelector('.ad-slide:not([aria-hidden="true"])')?.innerHTML,next=heroView(ads[adIndex],menu);
 if(direction&&previous&&!reducedMotion.matches){
  const old=`<div class="ad-slide" aria-hidden="true">${previous}</div>`,current=`<div class="ad-slide">${next}</div>`;
  host.innerHTML=`<div class="ad-track">${direction>0?old+current:current+old}</div>`;
  const track=host.firstElementChild,animation=track.animate([{transform:direction>0?'translateX(0)':'translateX(-100%)'},{transform:direction>0?'translateX(-100%)':'translateX(0)'}],{duration:380,easing:'ease-in-out',fill:'forwards'});adAnimation=animation;
  animation.finished.then(()=>{if(adAnimation!==animation||!host.isConnected)return;host.innerHTML=`<div class="ad-slide">${next}</div>`;adAnimation=null;}).catch(()=>{});
 }else host.innerHTML=`<div class="ad-slide">${next}</div>`;
 const counter=document.querySelector('#ad-position');if(counter)counter.textContent=(adIndex+1)+' / '+ads.length;
}
function moveAd(direction){if(ads.length<2)return;adIndex=(adIndex+direction+ads.length)%ads.length;paintAd(direction);resetAdClock();}
const dialog = document.querySelector("#options");
const save = () => sessionStorage.setItem(storageKey, JSON.stringify(state));
const count = () => state.cart.reduce((sum, line) => sum + line.quantity, 0);
const total = () => state.cart.reduce((sum, line) => sum + line.unit * line.quantity, 0);
const currentMenu = id => menu.find(item => item.id === id && !item.is_sold_out);
let categoryFilter="all";
const quantityControl = (line, i) => `<div class="quantity">
  <button data-action="minus" data-i="${i}" aria-label="${escapeText(line.name)} 수량 감소" ${line.quantity<=1?"disabled":""}>−</button>
  <b>${line.quantity}</b><button data-action="plus" data-i="${i}" aria-label="${escapeText(line.name)} 수량 증가" ${line.quantity>=99?"disabled":""}>+</button></div>`;
const button = (action, text, primary = true, disabled = false) =>
  `<button class="${primary?"primary":"secondary"}" data-action="${action}" ${disabled?"disabled":""}>${text}</button>`;

function go(page) {
  if(['menu','cart','review'].includes(page)&&!validDining()&&!state.orderId)page='welcome';
  if(page==='welcome'){adIndex=0;resetAdClock();}
  state.page = page;
  save();
  render();
  window.scrollTo({top:0});
}
function invalidateOrder() {
  Object.assign(state, {orderId:null, checkoutKey:null, attemptKey:null, callback:null});
  order = null;
}
async function leaveCheckout() {
  if(state.orderId){
    try {await api(`/api/orders/${state.orderId}/cancel`,{});}
    catch(error){
      if(error.status===409)applyOrder(await api("/api/orders/"+state.orderId));
      throw error;
    }
  }
  invalidateOrder();
}
async function loadMenu() {
  const catalog = await api("/api/menu");
  setPriceClock(catalog.server_time);
  menu = catalog.menu; mode = catalog.mode; clientKey = catalog.clientKey;
  updateAdSlides();
  setCategories(catalog.categories);if(categoryFilter!=='all'&&!Object.hasOwn(labels,categoryFilter))categoryFilter='all';
}
function syncPrices() {
  for (const line of state.cart) {
    const item = currentMenu(line.id);
    if (!item) continue;
    const options = item.options.filter(o => line.options.includes(o.id));
    line.options = options.map(o=>o.id);
    const selection=evaluateGroups(item.choice_groups??[],line.selections??[],options.map(o=>o.name));
    line.needsChoice=selection.invalid || selection.missing.length>0;
    line.selections=selection.ids;
    line.label=[...selection.snapshot.map(s=>s.name),...options.map(o=>o.name)].join(", ");
    line.promotion=item.promotion;
    line.version = item.version;
    line.name = item.name;
    line.unit = item.base_price + selection.amount + options.reduce((sum,o) => sum+o.extra_price,0);
  }
}
function cartLines(edit = false) {
  if (!count()) return `<div class="empty-cart"><span class="bag-icon" aria-hidden="true"></span><p>장바구니가 비어 있어요.</p><small>주문할 메뉴를 선택해 주세요.</small></div>`;
  return state.cart.map((line,i) => `<div class="cart-row"><div class="line-heading"><b>${escapeText(line.name)}</b>
    ${edit?`<button class="text-btn" data-action="remove" data-i="${i}">삭제</button>`:`<span>× ${line.quantity}</span>`}</div>
    <small>${escapeText(line.label || "기본 구성")}${currentMenu(line.id)?"":" · 품절"}</small>${line.promotion?`<small class="cart-discount">${escapeText(line.promotion.title)} 적용 · 결제 시 가격 재확인</small>`:""}
    ${edit && currentMenu(line.id) && (currentMenu(line.id).choice_groups?.length || line.needsChoice)?`<button class="text-btn" data-action="configure" data-i="${i}">${line.needsChoice?"필수 옵션 다시 선택":"옵션 변경"}</button>`:""}
    <div class="line-heading">${edit?quantityControl(line,i):"<span></span>"}<strong>${money(line.unit*line.quantity)}</strong></div></div>`).join("");
}
function cartSummary(edit = false) {
  return `<div class="panel"><div class="line-heading"><h2>장바구니 <span class="counter">${count()}</span></h2>${count()?'<button class="text-btn" data-action="clear-cart">전체 비우기</button>':""}</div>${cartLines(edit)}
    <div class="total"><span>합계</span><strong>${money(total())}</strong></div>
    ${button(edit?"review":"cart", edit?"주문 확인":"장바구니 보기",true,!count()||(edit && state.cart.some(line=>!currentMenu(line.id)||line.needsChoice)))}</div>`;
}
function menuView() {
  const visible=menu.filter(item=>categoryFilter==="all" || (item.category??"burger")===categoryFilter);
  const cards = visible.map(item => `<button class="menu-card ${item.kind==="chicken"?"sage":"oat"} ${item.is_sold_out?"sold-out":""}" data-action="choose" data-id="${item.id}" ${item.is_sold_out?'disabled aria-disabled="true"':""}>
    <span class="art ${item.photo_key?"with-photo":""}"><img src="${menuPicture(item)}" alt="">${item.is_sold_out?'<span class="stock-badge">품절</span>':""}</span><span class="card-copy"><strong>${escapeText(item.name)}</strong>
    <small>${escapeText(item.description)}</small>${promotionNote(item)}<span class="card-bottom">${priceHtml(item)}${item.is_sold_out?'<span class="sold-copy">선택 불가</span>':'<span class="add-mark" aria-hidden="true">＋</span>'}</span></span></button>`).join("");
  return `<div class="heading"><h1>메뉴 선택</h1><p>주문할 메뉴를 골라 주세요.</p></div>
    <nav class="filters menu-filters" aria-label="메뉴 분류">${Object.entries({all:"전체",...labels}).map(([id,title])=>
      `<button data-category="${escapeText(id)}" aria-pressed="${id===categoryFilter}">${escapeText(title)}</button>`).join("")}</nav><div class="shop-layout"><section class="menu-grid" aria-label="메뉴 목록">
    ${cards||'<p class="panel">이 분류에는 등록된 메뉴가 없습니다.</p>'}</section><aside>${cartSummary()}</aside></div>`;
}
function customerGroups(groups, ids, nested=false) {
  return groups.map(group=>{
    const current=group.choices.find(c=>ids.includes(c.id));
    const radio=(id,name,price,checked)=>`<label class="option single-choice"><span><input type="radio"
      name="v-${escapeText(group.id)}" data-choice value="${escapeText(id)}" ${checked?"checked":""}> ${escapeText(name)}</span>
      ${price?`<b>+${money(price)}</b>`:""}</label>`;
    return `<div class="pick-group ${nested?"pick-child":""}"><fieldset><legend>${escapeText(group.name)} <small>${group.required?"필수 · 1개":"선택 · 최대 1개"}</small></legend>
      ${group.required?"":radio("","선택 안 함",0,!current)}
      ${group.choices.map(c=>radio(c.id,c.name,c.extra_price,current?.id===c.id)).join("")}</fieldset>
      ${current?customerGroups(current.children,ids,true):""}</div>`;
  }).join("");
}
function optionView(id, editIndex=null) {
  const item=currentMenu(id);
  if(!item)return;
  const editing=editIndex===null?null:state.cart[editIndex];
  const groups=item.choice_groups??[];
  let choiceIds=evaluateGroups(groups,editing?.selections??[],item.options.filter(o=>editing?.options.includes(o.id)).map(o=>o.name)).ids;
  dialog.innerHTML=`<form id="option-form"><button type="button" class="close" data-action="close" aria-label="닫기">×</button>
    <div class="dialog-art ${item.photo_key?"with-photo":""} ${item.kind==="chicken"?"sage":"oat"}"><img src="${menuPicture(item)}" alt=""></div>
    <div class="dialog-body"><h2 id="option-title">${escapeText(item.name)}</h2><p class="muted">${escapeText(item.description)}</p>
    <div class="line-heading"><span>기본 가격</span>${priceHtml(item)}</div>${promotionNote(item)}
    ${item.options.length?`<fieldset><legend>추가 옵션</legend>${item.options.map(o=>`<label class="option"><span><input type="checkbox" value="${o.id}" ${editing?.options.includes(o.id)?"checked":""}> ${escapeText(o.name)}</span><b>+${money(o.extra_price)}</b></label>`).join("")}</fieldset>`:""}
    <div id="choice-fields"></div><p class="choice-message" aria-live="polite"></p><button type="submit" class="primary wide"><span id="option-price"></span> · ${editing?"선택 변경":"장바구니에 담기"}</button></div></form>`;
  const form=dialog.querySelector("form"), fields=form.querySelector("#choice-fields");
  const extras=()=>item.options.filter(opt=>form.querySelector(`input[type=checkbox][value="${opt.id}"]`)?.checked);
  function selection() {
    const selected=extras(), result=evaluateGroups(groups,choiceIds,selected.map(o=>o.name));
    return {...result, extras:selected, unit:item.base_price+result.amount+selected.reduce((n,o)=>n+o.extra_price,0)};
  }
  function updatePrice() {
    const result=selection();
    form.querySelector("#option-price").textContent=money(result.unit);
    form.querySelector('[type=submit]').disabled=result.missing.length>0 || result.invalid;
    form.querySelector(".choice-message").textContent=result.missing.length?"필수 선택: "+result.missing.join(", "):"";
  }
  const visibleGroups=()=>groups.filter(g=>!g.when_extra || extras().some(o=>o.name===g.when_extra));
  fields.innerHTML=customerGroups(visibleGroups(),choiceIds);
  updatePrice();
  dialog.onchange=event=>{
    if(event.target.matches("[data-choice],input[type=checkbox]")){
      const inputs=[...fields.querySelectorAll("[data-choice]:checked")].map(i=>i.value).filter(Boolean);
      const {name,value}=event.target;
      choiceIds=evaluateGroups(groups,inputs,extras().map(o=>o.name)).ids;
      fields.innerHTML=customerGroups(visibleGroups(),choiceIds);
      fields.querySelector(`input[name="${CSS.escape(name)}"][value="${CSS.escape(value)}"]`)?.focus({preventScroll:true});
    }
    updatePrice();
  };
  form.onsubmit=event=>{
    event.preventDefault();
    const result=selection();
    if(result.missing.length || result.invalid)return;
    const options=result.extras.map(o=>o.id), selections=result.ids;
    const label=[...result.snapshot.map(s=>s.name), ...result.extras.map(o=>o.name)].join(", ");
    const cart=state.cart.filter((line,i)=>i!==editIndex);
    const other=cart.find(l=>l.id===id && l.options.join()===options.join() && (l.selections??[]).join()===selections.join());
    const quantity=(editing?.quantity??1)+(other?.quantity??0);
    if(quantity>99){dialog.close();notice("한 항목은 최대 99개까지 담을 수 있습니다.");return;}
    const line={id,name:item.name,options,selections,label,quantity,unit:result.unit,version:item.version,promotion:item.promotion};
    if(other)Object.assign(other,line,{needsChoice:false});
    else cart.splice(editing?Math.min(editIndex,cart.length):cart.length,0,line);
    state.cart=cart;invalidateOrder();dialog.close();go("cart");
  };
  dialog.showModal();
}

function checkoutView() {
  const lines = order ? itemsHtml(order.items) : cartLines();
  const amount = order ? order.total : total();
  return `<div class="narrow"><div class="heading"><h1>주문 확인 및 결제</h1><p>메뉴와 최종 금액을 확인해 주세요.</p></div>
    <section class="panel"><p class="dining-summary">이용 방식 · <strong>${diningName(order?order.dining_type:state.diningType)}</strong></p>${lines}<div class="line-heading pay-method"><span>결제 방식</span><b>${mode==="demo"?"모의 카드 결제":"토스페이먼츠 테스트"}</b></div>
    ${demoSelect()}<div class="total"><span>최종 결제 금액</span><strong>${money(amount)}</strong></div>
    <div class="actions">${button("cart","장바구니 수정",false)}${button("pay",money(amount)+" 결제하기")}</div>
    <div class="checkout-exits">${button("menu","메뉴 선택으로 돌아가기",false)}<button class="text-btn" data-action="cancel-order">주문 전체 취소</button></div></section></div>`;
}
function demoSelect() {
  return mode==="demo"?`<label class="select-row">모의 승인 결과<select id="demo-result"><option value="success">승인 성공</option><option value="failure">승인 거절</option></select></label>`:"";
}
function resultView() {
  if (!order) return checkoutView();
  if(state.page==='cancelled')return `<div class="narrow"><div class="heading"><h1>주문이 취소되었습니다</h1></div><section class="panel receipt">
    <p class="error-note">매장에서 ${String(order.number).padStart(3,'0')}번 주문을 취소했습니다.</p>
    <p>취소 사유: ${escapeText(order.cancel_reason||'매장 요청')}</p><p class="dining-summary">${diningName(order.dining_type)} 주문</p>${itemsHtml(order.items)}
    <div class="total"><span>모의 결제 취소 금액</span><strong>${money(order.total)}</strong></div>${button('reset','메뉴 다시 선택')}</section></div>`;
  if (state.page==="done") return `<div class="narrow"><div class="heading"><h1>주문이 접수되었습니다</h1></div><div class="panel receipt">
    <div class="pickup"><span>${diningName(order.dining_type)} · 주문번호</span><strong>${String(order.number).padStart(3,"0")}</strong></div><p>수령 시 주문번호를 확인해 주세요.</p>
    ${itemsHtml(order.items)}<div class="total"><span>결제 금액</span><strong>${money(order.total)}</strong></div>${button("reset","처음으로")}</div></div>`;
  const failed = state.page==="failed";
  return `<div class="narrow"><div class="heading"><h1>${failed?"결제를 다시 시도해 주세요":"결제 결과 확인"}</h1></div><section class="panel">
    <p class="${failed?"error-note":"info-note"}">${failed?"승인이 거절되었거나 결제창이 닫혔습니다. 같은 주문으로 다시 결제할 수 있습니다.":
      order.payment?.has_key?"기존 거래의 승인 결과를 확인하고 있습니다.":"기존 주문의 테스트 결제 인증을 완료해 주세요."}</p>
    <p class="dining-summary">${diningName(order.dining_type)} 주문</p>${itemsHtml(order.items)}<div class="total"><span>결제할 금액</span><strong>${money(order.total)}</strong></div>
    ${failed?demoSelect():""}<div class="actions">${failed?button("edit","장바구니 수정",false):""}
    ${button(failed?"retry":"resume",failed?"다시 결제":order.payment?.has_key||state.callback?"결과 다시 확인":"결제창 열기")}</div>
    ${failed?'<div class="checkout-exits"><button class="text-btn" data-action="cancel-order">주문 전체 취소</button></div>':""}</section></div>`;
}
function render() {
  adAnimation?.cancel();adAnimation=null;
  document.querySelector('#steps').hidden=state.page==='welcome';
  const stage={menu:0,cart:1,review:2,failed:2,pending:2,done:3,cancelled:3}[state.page] ?? 0;
  document.querySelector("#steps").innerHTML = ["메뉴 선택","장바구니","결제","주문 완료"].map((label,i)=>
    `<span class="${i===stage?"active":i<stage?"past":""}" ${i===stage?'aria-current="step"':""}><i>${i+1}</i>${label}</span>`).join("");
  if(state.page==='welcome')app.innerHTML=welcomeView(ads,adIndex,menu,adPaused,count());
  else if(state.page==="menu") app.innerHTML=menuView();
  else if(state.page==="cart") app.innerHTML=`<div class="narrow"><div class="heading split"><h1>장바구니</h1>${button("menu","메뉴 더 담기",false)}</div>${cartSummary(true)}</div>`;
  else if(state.page==="review") app.innerHTML=checkoutView();
  else app.innerHTML=resultView();
  if(['menu','cart'].includes(state.page))app.insertAdjacentHTML('afterbegin',`<div class="dining-toolbar"><span>이용 방식 <strong>${diningName(state.diningType)}</strong></span><button class="text-btn" data-action="change-dining">매장·포장 변경</button></div>`);
}
function applyOrder(record) {
  state.diningType=record.dining_type??null;
  if(record.status==='CANCELLED'&&record.cancelled_by==='admin'){order=record;state.orderId=record.id;go('cancelled');return;}
  if(record.status==="CANCELLED"){invalidateOrder();go(count()?"cart":"menu");return;}
  order=record; state.orderId=record.id;
  if(record.number!=null) go("done");
  else if(record.payment?.status==="FAILED") go("failed");
  else if(record.payment?.status==="PENDING") go("pending");
  else go("review");
}
async function pay() {
  if(!order&&!validDining()){go('welcome');notice('매장 또는 포장을 먼저 선택해 주세요.');return;}
  const demo_result=document.querySelector("#demo-result")?.value || "success";
  if (!state.checkoutKey) {state.checkoutKey=crypto.randomUUID();save();}
  if (!order) {
    order=await api("/api/orders",{key:state.checkoutKey,dining_type:state.diningType,items:state.cart.map(l=>({
      menu_id:l.id,options:l.options,selections:l.selections??[],quantity:l.quantity,expected_unit:l.unit,expected_version:l.version
    }))});
    state.orderId=order.id;save();
  }
  if(!state.attemptKey) {state.attemptKey=crypto.randomUUID();save();}
  const record=await api(`/api/orders/${order.id}/attempts`,{key:state.attemptKey,demo_result});
  applyOrder(record);
  if(record.payment?.status==="PENDING") await resume();
}
let sdk;
async function openGateway() {
  if (!window.TossPayments) {
    if(!sdk) sdk=new Promise((resolve,reject)=>{
      const tag=document.createElement("script");tag.src="https://js.tosspayments.com/v2/standard";
      tag.onload=resolve;tag.onerror=()=>{sdk=null;tag.remove();reject(new Error("PG 결제창을 불러올 수 없습니다."));};
      document.head.append(tag);
    });
    await sdk;
  }
  const attempt=order.payment.id;
  const payment=window.TossPayments(clientKey).payment({customerKey:window.TossPayments.ANONYMOUS});
  const returnUrl=location.origin+"/return?attempt="+attempt;
  try {
    await payment.requestPayment({method:"CARD",amount:{currency:"KRW",value:order.total},orderId:attempt,
      orderName:order.items[0].name,successUrl:returnUrl,failUrl:returnUrl+"&failed=1"});
  } catch(error) {
    if(error.code==="USER_CANCEL" || error.code==="PAY_PROCESS_CANCELED") {
      applyOrder(await api("/api/payments/"+attempt,{cancel:true}));
    } else throw error;
  }
}
async function resume() {
  if(state.callback) {
    const {attempt, data}=state.callback;
    const record=await api("/api/payments/"+attempt,data);
    state.callback=null;applyOrder(record);
  } else if(order.payment.has_key) applyOrder(await api("/api/payments/"+order.payment.id,{}));
  else await openGateway();
}
async function recover(error) {
  if(error.code==="ORDER_CANCELLED"){invalidateOrder();go(count()?"cart":"menu");}
  if (error.code==="CART_CHANGED") {
    invalidateOrder();
    await loadMenu();syncPrices();go("cart");
  }
  notice(error.message);
}
async function run(task) {
  if(busy) return;
  busy=true;notice();app.inert=true;app.setAttribute("aria-busy","true");
  try {await task();}
  catch(error){try {await recover(error);} catch(second) {notice(second.message);} }
  finally {busy=false;app.inert=false;app.removeAttribute("aria-busy");}
}
document.addEventListener("click",event=>{
  const filterButton=event.target.closest("[data-category]");
  if(filterButton && !busy){categoryFilter=filterButton.dataset.category;render();return;}
  const control=event.target.closest("[data-action]");
  if(!control || control.disabled)return;
  const action=control.dataset.action;
  if(action.startsWith('ad-')){if(busy||!ads.length)return;if(action==='ad-pause'){adPaused=!adPaused;resetAdClock();control.setAttribute('aria-label',adPaused?'광고 자동 재생':'광고 일시 정지');control.setAttribute('aria-pressed',String(adPaused));}else moveAd(action==='ad-next'?1:-1);return;}
  if(action==="close") {dialog.close();return;}
  if(["clear-cart","cancel-order"].includes(action)){
    if(busy||!confirm(action==="clear-cart"?"장바구니의 메뉴를 모두 비울까요?":"현재 주문을 모두 취소하고 처음부터 시작할까요?"))return;
    run(async()=>{await leaveCheckout();const previousType=state.diningType;state=defaults();categoryFilter="all";
      if(action==='clear-cart'){state.diningType=previousType;go('menu');}else{await loadAds();go('welcome');}
      notice(action==="clear-cart"?"장바구니를 비웠습니다.":"결제 전 주문을 취소했습니다. 이용 방식을 다시 선택해 주세요.");});return;
  }
  run(async()=>{
    if(action==='dining'){if(!['DINE_IN','TAKEOUT'].includes(control.dataset.dining))return;await leaveCheckout();state.diningType=control.dataset.dining;await loadMenu();go('menu');return;}
    if(action==='change-dining'){await leaveCheckout();await loadAds();go('welcome');return;}
    if(action==="configure"){const index=Number(control.dataset.i);return optionView(state.cart[index].id,index);}
    if(action==="choose") return optionView(Number(control.dataset.id));
    if(action==="reset"){categoryFilter="all";state=defaults();order=null;await Promise.all([loadMenu(),loadAds()]);go("welcome");return;}
    if(action==="edit"){await leaveCheckout();await loadMenu();syncPrices();go("cart");return;}
    if(action==="retry"){state.attemptKey=null;save();return pay();}
    if(action==="pay") return pay();
    if(action==="resume") return resume();
    if(action==="reload") return boot();
    if(["minus","plus","remove"].includes(action)) {
      await leaveCheckout();
      const i=Number(control.dataset.i);
      if(action==="remove") state.cart.splice(i,1);
      else state.cart[i].quantity=Math.max(1,Math.min(99,state.cart[i].quantity+(action==="plus"?1:-1)));
      invalidateOrder();go("cart");return;
    }
    if(action==="menu"||action==="cart")await leaveCheckout();
    if(action==="menu") await loadMenu();
    go(action);
  });
});
async function boot() {
  await Promise.all([loadMenu(),loadAds()]);
  if(location.pathname==="/return") {
    const q=new URLSearchParams(location.search);
    if(q.has("attempt")) {
      state.callback={attempt:q.get("attempt"),data:q.get("failed")==="1"?{cancel:true}:{
        paymentKey:q.get("paymentKey"),orderId:q.get("orderId"),amount:Number(q.get("amount"))
      }};
      save();history.replaceState(null,"","/");
    }
  }
  if(state.orderId) {
    try {applyOrder(await api("/api/orders/"+state.orderId));}
    catch(error) {if(error.status!==404)throw error;state=defaults();save();}
  }
  if(state.callback) await resume();
  else {if(!state.orderId&&!validDining()){state.page='welcome';save();}render();}
}
app.innerHTML='<button class="secondary" data-action="reload">메뉴 다시 불러오기</button>';
run(boot);

let checkingShelf=false;
async function refreshShelf() {
  if(checkingShelf || document.hidden || busy || dialog.open)return;
  if(state.page==='done'&&state.orderId){
    const id=state.orderId;checkingShelf=true;
    try{const result=await api('/api/orders/'+id);if(state.page==='done'&&state.orderId===id&&result.status==='CANCELLED')applyOrder(result);}
    catch{}finally{checkingShelf=false;}return;
  }
  if(state.page==='welcome'){
    checkingShelf=true;try{
      const [adResult,menuResult]=await Promise.allSettled([api('/api/ads'),api('/api/menu')]);
      if(state.page==='welcome'&&!busy){
        const before=JSON.stringify(ads);
        if(adResult.status==='fulfilled')adCatalog=adResult.value.items;
        if(menuResult.status==='fulfilled'){menu=menuResult.value.menu;setPriceClock(menuResult.value.server_time);setCategories(menuResult.value.categories);}
        updateAdSlides();if(before!==JSON.stringify(ads))render();
      }
    }catch{}finally{checkingShelf=false;}return;
  }
  if(!['menu','cart'].includes(state.page))return;
  checkingShelf=true;
  try{
    const catalog=await api("/api/menu");
    // A popup may open while this request is pending. Apply labels and menus together.
    if(busy || dialog.open || !['menu','cart'].includes(state.page))return;
    setPriceClock(catalog.server_time);
    const oldLabels=JSON.stringify(labels);setCategories(catalog.categories);
    if(categoryFilter!=='all'&&!Object.hasOwn(labels,categoryFilter))categoryFilter='all';
    if(JSON.stringify(menu)!==JSON.stringify(catalog.menu)||oldLabels!==JSON.stringify(labels)){
      menu=catalog.menu;render();
    }
  } catch { /* The current shelf stays usable while the next refresh is pending. */ }
  finally {checkingShelf=false;}
}
document.addEventListener("visibilitychange",refreshShelf);
setInterval(refreshShelf,15000);
setInterval(tickDiscounts,1000);
setInterval(()=>{
 const now=performance.now(),elapsed=now-adLastTick;adLastTick=now;
 if(state.page!=='welcome'||document.hidden||busy||adPaused||ads.length<2)return;
 adElapsed+=elapsed;
 if(adElapsed>=AD_INTERVAL)moveAd(1);
},250);
document.addEventListener('visibilitychange',resetAdClock);
reducedMotion.addEventListener('change',event=>{if(event.matches){adPaused=true;resetAdClock();const b=document.querySelector('[data-action=ad-pause]');if(b){b.setAttribute('aria-label','광고 자동 재생');b.setAttribute('aria-pressed','true');}if(adAnimation)paintAd();}});
