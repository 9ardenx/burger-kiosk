import {escapeText,money} from './common.js?v=20261127-v17-ads';
import {adPhotoUrl} from './backend.js?v=20261127-v17-ads';
import {menuPicture} from './catalog.js?v=20261127-v17-ads';
export const diningName=value=>value==='DINE_IN'?'매장':value==='TAKEOUT'?'포장':'이용 방식 미기록';
const eatIcon='<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 5v12m6-12v12m6-12v12M8 14v3a6 6 0 0 0 12 0v-3m-6 9v20m24 0V5c-8 4-10 15-8 21h8"/></svg>';
const bagIcon='<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 15h28l3 28H7l3-28Zm7 0v-4a7 7 0 0 1 14 0v4m-14 5v-5m14 5v-5"/></svg>';
export function heroView(ad,menu){
  const title=ad?.title??'오늘도, 맛있는 한 끼',description=ad?.description??'좋아하는 버거와 사이드를 골라 나만의 한 끼를 완성해 보세요.';
  const automatic=ad?.slide_type==='MENU',photo=automatic?menuPicture(ad.menu):ad?adPhotoUrl(ad.photo_key):menuPicture(menu.find(m=>!m.is_sold_out)??{kind:'classic'});
  return `<div class="welcome-copy"><span class="welcome-eyebrow">${automatic?'메뉴를 만나보세요':ad?'매장의 새로운 소식':'FRESH & TASTY'}</span><h1>${escapeText(title)}</h1><p>${escapeText(description)}</p><span class="welcome-signature">${automatic?money(ad.menu.base_price):'맛있는 순간을 준비합니다.'}</span></div><div class="welcome-image ${automatic?'menu-introduction':''}"><img src="${photo}" alt="${escapeText(ad?.title??'추천 메뉴')}" fetchpriority="high"></div>`;
}
export function welcomeView(ads,index,menu,paused,cartCount){
 return `<section class="welcome"><div class="welcome-hero" id="welcome-ad" role="region" aria-label="매장 광고" aria-roledescription="슬라이드"><div class="ad-slide">${heroView(ads[index],menu)}</div></div>
  <div class="ad-navigation" ${ads.length<2?'hidden':''}><button class="secondary" data-action="ad-prev" aria-label="이전 광고">← 이전</button><span id="ad-position" aria-live="off">${index+1} / ${ads.length}</span><button class="secondary" data-action="ad-next" aria-label="다음 광고">다음 →</button><button class="text-btn" data-action="ad-pause" aria-pressed="${paused}">${paused?'자동 재생':'일시 정지'}</button><small class="ad-timing">1분마다 다음 소식</small></div>
  <div class="welcome-start"><div><h2>어디에서 드시겠어요?</h2><p class="muted">이용 방식을 선택하면 주문을 시작합니다.${cartCount?' 담아둔 메뉴는 유지됩니다.':''}</p></div>
  <div class="dining-choices"><button class="dining-choice eat-in" data-action="dining" data-dining="DINE_IN">${eatIcon}<span><strong>매장에서 먹기</strong><small>편안하게 매장에서</small></span></button>
  <button class="dining-choice takeout" data-action="dining" data-dining="TAKEOUT">${bagIcon}<span><strong>포장하기</strong><small>맛있게 챙겨 가세요</small></span></button></div></div></section>`;
}
