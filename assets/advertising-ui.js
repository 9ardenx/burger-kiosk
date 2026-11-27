import {escapeText} from './common.js?v=20261127-v173';
import {adPhotoUrl} from './backend.js?v=20261127-v173';
export function adList(items){
  return `<div class="heading split"><div><h1>광고 관리</h1><p>키오스크 첫 화면에 보여 줄 소식을 관리합니다.</p></div><button class="primary" data-new-ad ${items.length>=10?'disabled':''}>+ 광고 등록</button></div>
  <p class="info-note ad-help">첫 화면 소식 → 우선 광고 → 최신 등록 메뉴 → 일반 광고 순으로 1분마다 넘어갑니다.<br>사진이 있고 판매 가능한 메뉴는 최신 등록순으로 자동 소개됩니다. 광고 등록/수정에서 <strong>메뉴 소개보다 먼저 노출</strong>을 선택하면 관리자가 메뉴 소개보다 광고를 앞세울 수 있습니다. 같은 노출 위치 안에서는 아래 목록 순서를 따릅니다. 광고는 최대 10개입니다.</p>
  <div class="ad-list">${items.map((a,i)=>`<article class="panel ad-card" data-ad-id="${a.id}"><img src="${adPhotoUrl(a.photo_key)}" alt="${escapeText(a.title)}">
    <div class="ad-card-copy"><small>${({INTRO:'첫 화면 소식',PRIORITY:'메뉴보다 우선',NORMAL:'메뉴 소개 뒤'})[a.placement??'NORMAL']} · ${a.enabled?'노출 중':'숨김'}</small><h2>${escapeText(a.title)}</h2><p class="muted">${escapeText(a.description)}</p>
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
    <label>노출 위치<select name="ad-placement"><option value="NORMAL" ${!item?.placement||item.placement==='NORMAL'?'selected':''}>일반 광고 · 자동 메뉴 소개 뒤</option><option value="PRIORITY" ${item?.placement==='PRIORITY'?'selected':''}>메뉴 소개보다 먼저 노출</option><option value="INTRO" ${item?.placement==='INTRO'?'selected':''}>첫 화면 소식 · 맨 처음 (1개)</option></select></label>
    <p class="muted">우선 광고는 첫 화면 소식 다음, 자동 메뉴 소개 앞에 나옵니다. 숨김을 선택하면 노출 위치와 관계없이 나오지 않습니다.</p>
    <p class="muted">메뉴 사진과 별도로 저장됩니다. 광고를 삭제해도 메뉴와 주문은 유지됩니다.</p><button class="primary wide" type="submit">광고 저장</button></section></form>`;
}
