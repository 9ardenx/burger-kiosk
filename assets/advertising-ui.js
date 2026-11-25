import {escapeText} from './common.js';
import {adPhotoUrl} from './backend.js';
export function adList(items){
  return `<div class="heading split"><div><h1>광고 관리</h1><p>키오스크 첫 화면에 보여 줄 소식을 관리합니다.</p></div><button class="primary" data-new-ad ${items.length>=10?'disabled':''}>+ 광고 등록</button></div>
  <p class="info-note ad-help">최대 10개 · 노출 중인 광고는 등록한 순서대로 표시됩니다. 광고가 없으면 기본 안내 화면을 보여 줍니다.</p>
  <div class="ad-list">${items.map((a,i)=>`<article class="panel ad-card" data-ad-id="${a.id}"><img src="${adPhotoUrl(a.photo_key)}" alt="${escapeText(a.title)}">
    <div class="ad-card-copy"><small>${i+1}번째 광고 · ${a.enabled?'노출 중':'숨김'}</small><h2>${escapeText(a.title)}</h2><p class="muted">${escapeText(a.description)}</p>
    <div class="actions"><button class="secondary" data-edit-ad="${a.id}">수정</button><button class="secondary" data-toggle-ad="${a.id}">${a.enabled?'숨기기':'노출하기'}</button><button class="danger-outline" data-delete-ad="${a.id}">삭제</button></div>
    <div class="ad-order"><button class="text-btn" data-move-ad="${i}" data-direction="-1" ${i===0?'disabled':''}>앞으로</button><button class="text-btn" data-move-ad="${i}" data-direction="1" ${i===items.length-1?'disabled':''}>뒤로</button></div></div></article>`).join('')||'<div class="panel ad-empty"><h2>첫 광고를 등록해 보세요</h2><p class="muted">신제품 사진과 소개를 올리면 고객이 주문을 시작하기 전에 볼 수 있어요.</p></div>'}</div>`;
}
export function adEditor(item){
  return `<div class="heading split"><div><h1>${item?'광고 수정':'광고 등록'}</h1><p>첫 화면에 들어갈 이미지와 문구를 확인해 주세요.</p></div><button class="secondary" data-back-ads>목록으로</button></div>
  <form id="ad-editor" class="panel ad-editor"><section class="ad-photo-editor"><div class="ad-preview"><img id="ad-preview" src="${item?adPhotoUrl(item.photo_key):'./assets/classic.svg'}" alt="광고 이미지 미리보기"></div>
    <label>광고 이미지<input type="file" name="ad-photo" accept="image/jpeg,image/png,image/webp" ${item?'':'required'}></label>
    <small>권장 1440 × 810px (16:9) · JPG, PNG, WebP · 최대 10 MB</small><p class="muted">비율을 유지해 꽉 채우고 가장자리를 자릅니다. 미리보기와 같은 사진이 저장됩니다.</p>
    <div class="ad-crop" hidden><label>가로 위치<input type="range" name="ad-x" min="0" max="100" value="50"></label><label>세로 위치<input type="range" name="ad-y" min="0" max="100" value="50"></label><small data-ad-photo-state role="status"></small></div></section>
    <section><label>광고 제목<input name="ad-title" maxlength="40" required value="${escapeText(item?.title??'')}" placeholder="예: 바삭한 새우버거를 만나보세요"></label>
    <label>광고 설명<textarea name="ad-description" maxlength="120" rows="4" placeholder="새 메뉴의 특징이나 행사 내용을 적어 주세요.">${escapeText(item?.description??'')}</textarea></label>
    <label class="ad-enabled"><input type="checkbox" name="ad-enabled" ${item?.enabled===false?'':'checked'}> 고객 첫 화면에 노출</label>
    <p class="muted">메뉴 사진과 별도로 저장됩니다. 광고를 삭제해도 메뉴와 주문은 유지됩니다.</p><button class="primary wide" type="submit">광고 저장</button></section></form>`;
}
