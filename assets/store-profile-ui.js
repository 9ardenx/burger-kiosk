import {escapeText as esc} from './common.js?v=20261128-v115';
import {suggestStoreName} from './store-naming.js?v=20261128-v115';
export function addressFields(store={}){return `<div class="address-fields">
 <label>매장 주소<input name="address" value="${esc(store.address??'')}" maxlength="200" placeholder="경기도 용인시 처인구 모현읍 외대로 81" required autocomplete="street-address"></label>
 <label>상세 주소<input name="address_detail" value="${esc(store.address_detail??'')}" maxlength="100" placeholder="층·호수 등"></label>
 <label>읍·면·동<input name="locality" value="${esc(store.locality??'')}" maxlength="31" placeholder="도로명 주소에 없으면 입력 · 예: 서현동"></label>
 <p class="muted">입력한 주소로 이름을 제안합니다. 도로명 주소에 읍·면·동이 없으면 별도로 입력해 주세요.</p>
 <output class="name-preview" aria-live="polite">${esc(suggestStoreName(store.address,store.locality)||'주소를 입력하면 점포명을 제안합니다.')}</output></div>`;}
export function updateNamePreview(form){
 const deferred=form.elements.address_pending?.checked;
 const fields=form.querySelector('.address-fields');if(!fields)return;
 if(form.id==='create-store')form.elements.name.disabled=!!deferred;
 fields.hidden=!!deferred;
 for(const input of fields.querySelectorAll('input'))input.disabled=!!deferred;
 const suggestion=suggestStoreName(form.elements.address.value,form.elements.locality.value);
 fields.querySelector('output').textContent=suggestion?`자동 점포명: ${suggestion} · 같은 이름이 있으면 번호가 붙습니다.`:'주소의 시·구와 읍·면·동을 입력해 주세요.';
}
export function profileView(store,isHQ){return `<section class="panel store-profile"><h1>매장 정보</h1><h2>${esc(store.name)}</h2>
 ${store.address_pending?'<p class="info-note">점주 가입을 마무리하려면 매장 주소를 등록해 주세요. 주소에 맞는 점포명이 자동으로 저장됩니다.</p>':''}
 <form id="store-profile" data-revision="${store.profile_revision}">${addressFields(store)}
 <label class="check-line"><input type="checkbox" name="auto_name" ${store.address_pending?'checked disabled':''}>주소에 맞춰 점포명도 변경</label>
 ${isHQ?'<label>본사 지정 점포명 (선택)<input name="name" maxlength="45" placeholder="비워 두면 주소 기반 이름 사용"></label>':''}
 <p class="muted">이름을 바꿔도 기존 메뉴·사진·주문·재고와 매장 링크는 유지됩니다.</p><button class="primary">매장 정보 저장</button></form></section>`;}
