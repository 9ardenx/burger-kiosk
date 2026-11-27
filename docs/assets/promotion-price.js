import {escapeText as esc,money} from './common.js?v=20261128-v115';
let offset=0;
export function setPriceClock(serverTime){if(Number.isFinite(serverTime))offset=serverTime-Date.now();}
export function priceHtml(item){return item.promotion?`<span class="sale-price"><del>${money(item.original_price)}</del><b>${money(item.base_price)}</b></span>`:`<b>${money(item.base_price)}</b>`;}
export function promotionNote(item){return item.promotion?`<span class="promotion-note"><span class="discount-label">${item.promotion.mode==='PERCENT'?item.promotion.value+'% 할인':'시간 할인'}</span> ${esc(item.promotion.title)} <small data-discount-end="${esc(item.promotion.ends_at)}"></small></span>`:'';}
export function tickDiscounts(){for(const el of document.querySelectorAll('[data-discount-end]')){const remaining=Math.ceil((Date.parse(el.dataset.discountEnd.replace(' ','T')+'Z')-Date.now()-offset)/1000);el.textContent=remaining<=0?'종료 · 결제 시 가격 확인':`${Math.floor(remaining/3600)}:${String(Math.floor(remaining%3600/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')} 남음`;}}
