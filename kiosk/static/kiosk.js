import {api, app, money, escapeText, itemsHtml, notice} from "./common.js";

const storageKey = "burger-kiosk-session-v1";
const defaults = () => ({cart: [], page: "menu", checkoutKey: null, orderId: null, attemptKey: null, callback: null});
let state;
try { state = {...defaults(), ...JSON.parse(sessionStorage.getItem(storageKey))}; }
catch { state = defaults(); }
let menu = [], mode = "demo", clientKey = "", order = null, busy = false;
const dialog = document.querySelector("#options");
const save = () => sessionStorage.setItem(storageKey, JSON.stringify(state));
const count = () => state.cart.reduce((sum, line) => sum + line.quantity, 0);
const total = () => state.cart.reduce((sum, line) => sum + line.unit * line.quantity, 0);
const currentMenu = id => menu.find(item => item.id === id);
const picture = item => `/assets/${item.kind === "chicken" ? "chicken" : "classic"}.svg`;
const quantityControl = (line, i) => `<div class="quantity">
  <button data-action="minus" data-i="${i}" aria-label="${escapeText(line.name)} 수량 감소" ${line.quantity<=1?"disabled":""}>−</button>
  <b>${line.quantity}</b><button data-action="plus" data-i="${i}" aria-label="${escapeText(line.name)} 수량 증가" ${line.quantity>=99?"disabled":""}>+</button></div>`;
const button = (action, text, primary = true, disabled = false) =>
  `<button class="${primary?"primary":"secondary"}" data-action="${action}" ${disabled?"disabled":""}>${text}</button>`;

function go(page) {
  state.page = page;
  save();
  render();
  window.scrollTo({top:0});
}
function invalidateOrder() {
  Object.assign(state, {orderId:null, checkoutKey:null, attemptKey:null, callback:null});
  order = null;
}
async function loadMenu() {
  const catalog = await api("/api/menu");
  menu = catalog.menu; mode = catalog.mode; clientKey = catalog.clientKey;
}
function syncPrices() {
  for (const line of state.cart) {
    const item = currentMenu(line.id);
    if (!item) continue;
    const options = item.options.filter(o => line.options.includes(o.id));
    line.unit = item.base_price + options.reduce((sum,o) => sum+o.extra_price,0);
  }
}
function cartLines(edit = false) {
  if (!count()) return `<div class="empty-cart"><span class="bag-icon" aria-hidden="true"></span><p>장바구니가 비어 있어요.</p><small>주문할 메뉴를 선택해 주세요.</small></div>`;
  return state.cart.map((line,i) => `<div class="cart-row"><div class="line-heading"><b>${escapeText(line.name)}</b>
    ${edit?`<button class="text-btn" data-action="remove" data-i="${i}">삭제</button>`:`<span>× ${line.quantity}</span>`}</div>
    <small>${escapeText(line.label || "기본 구성")}${currentMenu(line.id)?"":" · 품절"}</small>
    <div class="line-heading">${edit?quantityControl(line,i):"<span></span>"}<strong>${money(line.unit*line.quantity)}</strong></div></div>`).join("");
}
function cartSummary(edit = false) {
  return `<div class="panel"><h2>장바구니 <span class="counter">${count()}</span></h2>${cartLines(edit)}
    <div class="total"><span>합계</span><strong>${money(total())}</strong></div>
    ${button(edit?"review":"cart", edit?"주문 확인":"장바구니 보기",true,!count()||(edit && state.cart.some(line=>!currentMenu(line.id))))}</div>`;
}
function menuView() {
  const cards = menu.map(item => `<button class="menu-card ${item.kind==="chicken"?"sage":"oat"}" data-action="choose" data-id="${item.id}">
    <span class="art"><img src="${picture(item)}" alt=""></span><span class="card-copy"><strong>${escapeText(item.name)}</strong>
    <small>${escapeText(item.description)}</small><span class="card-bottom"><b>${money(item.base_price)}</b><span class="add-mark" aria-hidden="true">＋</span></span></span></button>`).join("");
  return `<div class="heading"><h1>메뉴 선택</h1><p>주문할 버거를 골라 주세요.</p></div><div class="shop-layout"><section class="menu-grid" aria-label="판매 중인 메뉴">
    ${cards||'<p class="panel">현재 주문 가능한 메뉴가 없습니다.</p>'}</section><aside>${cartSummary()}</aside></div>`;
}
function optionView(id) {
  const item = currentMenu(id);
  if (!item) return;
  dialog.innerHTML = `<form id="option-form"><button type="button" class="close" data-action="close" aria-label="닫기">×</button>
    <div class="dialog-art ${item.kind==="chicken"?"sage":"oat"}"><img src="${picture(item)}" alt=""></div><div class="dialog-body">
    <h2 id="option-title">${escapeText(item.name)}</h2><p class="muted">${escapeText(item.description)}</p>
    <div class="line-heading"><span>기본 가격</span><b>${money(item.base_price)}</b></div>
    ${item.options.length?`<fieldset><legend>추가 옵션</legend>${item.options.map(o=>`<label class="option"><span><input type="checkbox" value="${o.id}"> ${escapeText(o.name)}</span><b>+${money(o.extra_price)}</b></label>`).join("")}</fieldset>`:""}
    <button type="submit" class="primary wide"><span id="option-price">${money(item.base_price)}</span> · 장바구니에 담기</button></div></form>`;
  const selected = () => item.options.filter(opt => dialog.querySelector(`input[value="${opt.id}"]`)?.checked);
  const price = () => item.base_price + selected().reduce((sum,opt)=>sum+opt.extra_price,0);
  dialog.onchange = () => { dialog.querySelector("#option-price").textContent = money(price()); };
  dialog.querySelector("form").onsubmit = event => {
    event.preventDefault();
    const options = selected().map(o=>o.id);
    const existing = state.cart.find(l=>l.id===id && l.options.join()===options.join());
    if (existing && existing.quantity>=99) {dialog.close();notice("한 항목은 최대 99개까지 담을 수 있습니다.");return;}
    if (existing) existing.quantity++;
    else state.cart.push({id,name:item.name,options,label:selected().map(o=>o.name).join(", "),quantity:1,unit:price()});
    invalidateOrder(); dialog.close(); go("cart");
  };
  dialog.showModal();
}
function checkoutView() {
  const lines = order ? itemsHtml(order.items) : cartLines();
  const amount = order ? order.total : total();
  return `<div class="narrow"><div class="heading"><h1>주문 확인 및 결제</h1><p>메뉴와 최종 금액을 확인해 주세요.</p></div>
    <section class="panel">${lines}<div class="line-heading pay-method"><span>결제 방식</span><b>${mode==="demo"?"로컬 모의 결제":"토스페이먼츠 테스트"}</b></div>
    ${demoSelect()}<div class="total"><span>최종 결제 금액</span><strong>${money(amount)}</strong></div>
    <div class="actions">${button("cart","이전",false)}${button("pay",money(amount)+" 결제하기")}</div></section></div>`;
}
function demoSelect() {
  return mode==="demo"?`<label class="select-row">모의 승인 결과<select id="demo-result"><option value="success">승인 성공</option><option value="failure">승인 거절</option></select></label>`:"";
}
function resultView() {
  if (!order) return checkoutView();
  if (state.page==="done") return `<div class="narrow"><div class="heading"><h1>주문이 접수되었습니다</h1></div><div class="panel receipt">
    <div class="pickup"><span>주문번호</span><strong>${String(order.number).padStart(3,"0")}</strong></div><p>수령 시 주문번호를 확인해 주세요.</p>
    ${itemsHtml(order.items)}<div class="total"><span>결제 금액</span><strong>${money(order.total)}</strong></div>${button("reset","처음으로")}</div></div>`;
  const failed = state.page==="failed";
  return `<div class="narrow"><div class="heading"><h1>${failed?"결제를 다시 시도해 주세요":"결제 결과 확인"}</h1></div><section class="panel">
    <p class="${failed?"error-note":"info-note"}">${failed?"승인이 거절되었거나 결제창이 닫혔습니다. 같은 주문으로 다시 결제할 수 있습니다.":
      order.payment?.has_key?"기존 거래의 승인 결과를 확인하고 있습니다.":"기존 주문의 테스트 결제 인증을 완료해 주세요."}</p>
    ${itemsHtml(order.items)}<div class="total"><span>결제할 금액</span><strong>${money(order.total)}</strong></div>
    ${failed?demoSelect():""}<div class="actions">${failed?button("edit","장바구니 수정",false):""}
    ${button(failed?"retry":"resume",failed?"다시 결제":order.payment?.has_key||state.callback?"결과 다시 확인":"결제창 열기")}</div></section></div>`;
}
function render() {
  const stage={menu:0,cart:1,review:2,failed:2,pending:2,done:3}[state.page] ?? 0;
  document.querySelector("#steps").innerHTML = ["메뉴 선택","장바구니","결제","주문 완료"].map((label,i)=>
    `<span class="${i===stage?"active":i<stage?"past":""}" ${i===stage?'aria-current="step"':""}><i>${i+1}</i>${label}</span>`).join("");
  if(state.page==="menu") app.innerHTML=menuView();
  else if(state.page==="cart") app.innerHTML=`<div class="narrow"><div class="heading split"><h1>장바구니</h1>${button("menu","메뉴 더 담기",false)}</div>${cartSummary(true)}</div>`;
  else if(state.page==="review") app.innerHTML=checkoutView();
  else app.innerHTML=resultView();
}
function applyOrder(record) {
  order=record; state.orderId=record.id;
  if(record.number!=null) go("done");
  else if(record.payment?.status==="FAILED") go("failed");
  else if(record.payment?.status==="PENDING") go("pending");
  else go("review");
}
async function pay() {
  const demo_result=document.querySelector("#demo-result")?.value || "success";
  if (!state.checkoutKey) {state.checkoutKey=crypto.randomUUID();save();}
  if (!order) {
    order=await api("/api/orders",{key:state.checkoutKey,items:state.cart.map(l=>({
      menu_id:l.id,options:l.options,quantity:l.quantity,expected_unit:l.unit
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
  const control=event.target.closest("[data-action]");
  if(!control || control.disabled)return;
  const action=control.dataset.action;
  if(action==="close") {dialog.close();return;}
  run(async()=>{
    if(action==="choose") return optionView(Number(control.dataset.id));
    if(action==="reset"){state=defaults();order=null;await loadMenu();go("menu");return;}
    if(action==="edit"){invalidateOrder();await loadMenu();syncPrices();go("cart");return;}
    if(action==="retry"){state.attemptKey=null;save();return pay();}
    if(action==="pay") return pay();
    if(action==="resume") return resume();
    if(action==="reload") return boot();
    if(["minus","plus","remove"].includes(action)) {
      const i=Number(control.dataset.i);
      if(action==="remove") state.cart.splice(i,1);
      else state.cart[i].quantity=Math.max(1,Math.min(99,state.cart[i].quantity+(action==="plus"?1:-1)));
      invalidateOrder();go("cart");return;
    }
    if(action==="menu") await loadMenu();
    go(action);
  });
});
async function boot() {
  await loadMenu();
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
  else render();
}
app.innerHTML='<button class="secondary" data-action="reload">메뉴 다시 불러오기</button>';
run(boot);
