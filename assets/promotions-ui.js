import {escapeText as esc,money} from './common.js?v=20261128-v111';
const days=['일','월','화','수','목','금','토'];
export function promotionView(state,menus,edit){
 if(edit)return promotionEditor(edit,menus);
 const active=new Set(state.active.map(p=>p.id));
 return `<div class="heading split"><div><h1>할인 관리</h1><p>요일과 시간을 예약하면 자동으로 할인 가격이 적용됩니다.</p></div><button class="primary" data-new-promotion ${state.items.length>=30?'disabled':''}>+ 할인 예약</button></div>
 <p class="inventory-note">한국 시간 기준 · 메뉴 기본 가격에만 적용 · 중복 시 가장 낮은 가격 하나 적용<br>고객 화면은 최대 15초마다 갱신되며, 결제할 때 최신 할인 가격을 다시 확인합니다.</p>
 <div class="promotion-list">${state.items.map(p=>`<article class="panel promotion-row" data-promotion-id="${esc(p.id)}"><div><span class="stock-label ${active.has(p.id)?'selling':''}">${!p.enabled?'사용 안 함':active.has(p.id)?'할인 중':'예약 / 기간 종료'}</span><h2>${esc(p.title)}</h2><p><strong>${p.mode==='PERCENT'?p.value+'% 할인':money(p.value)+'에 판매'}</strong> · ${p.menu_ids.length}개 메뉴</p><p class="muted">${p.weekdays.map(d=>days[d]).join('·')} ${esc(p.start_time)}–${esc(p.end_time)}${p.start_time>p.end_time?' (다음 날 종료)':''}<br>${p.start_date||'시작 제한 없음'} ~ ${p.end_date||'종료 제한 없음'}</p><small>${esc(p.menu_ids.map(id=>menus.find(m=>m.id===id)?.name||'삭제된 메뉴').join(', '))}</small></div><div class="actions"><button class="secondary" data-edit-promotion="${esc(p.id)}">수정</button><button class="secondary" data-toggle-promotion="${esc(p.id)}">${p.enabled?'끄기':'켜기'}</button><button class="text-btn" data-delete-promotion="${esc(p.id)}">삭제</button></div></article>`).join('')||'<div class="panel empty-insight">등록된 할인이 없습니다. 원하는 메뉴와 시간대를 예약해 보세요.</div>'}</div>`;
}
function promotionEditor(p,menus){
 return `<div class="heading"><h1>${p.isNew?'할인 예약':'할인 수정'}</h1><p>기본 가격을 할인합니다. 옵션·추가 구성의 금액은 유지됩니다.</p></div><form id="promotion-editor" class="panel promotion-editor">
 <label>할인 이름<input name="title" maxlength="40" required value="${esc(p.title)}" placeholder="예: 평일 점심 할인"></label>
 <label class="check-line"><input type="checkbox" name="enabled" ${p.enabled?'checked':''}>예약 사용</label>
 <div class="inventory-inputs"><label>할인 방식<select name="mode"><option value="PERCENT" ${p.mode==='PERCENT'?'selected':''}>할인율 (%)</option><option value="FIXED" ${p.mode==='FIXED'?'selected':''}>할인 판매가 (원)</option></select></label>
 <label><span data-promotion-unit>${p.mode==='PERCENT'?'할인율 (%)':'할인 판매가 (원)'}</span><input type="number" name="value" min="1" max="${p.mode==='PERCENT'?99:1000000}" step="1" required value="${p.value}"></label></div>
 <fieldset><legend>할인 요일</legend><div class="weekday-options">${days.map((d,i)=>`<label class="check-line"><input type="checkbox" name="weekdays" value="${i}" ${p.weekdays.includes(i)?'checked':''}>${d}</label>`).join('')}</div></fieldset>
 <div class="inventory-inputs"><label>시작 시간<input type="time" name="start_time" required value="${esc(p.start_time)}"></label><label>종료 시간<input name="end_time" required pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00" placeholder="18:00 또는 24:00" value="${esc(p.end_time)}"></label></div>
 <p class="muted">24시간 할인: 00:00~24:00. 종료가 시작보다 빠르면 다음 날 종료합니다. 요일과 날짜는 시작 시점을 기준으로 합니다.</p>
 <div class="inventory-inputs"><label>시작 날짜 (선택)<input type="date" name="start_date" value="${p.start_date||''}"></label><label>종료 날짜 (선택)<input type="date" name="end_date" value="${p.end_date||''}"></label></div>
 <fieldset><legend>할인할 메뉴</legend><div class="promotion-menu-options">${menus.map(m=>`<label class="check-line"><input type="checkbox" name="menu_ids" value="${m.id}" ${p.menu_ids.includes(m.id)?'checked':''}><span>${esc(m.name)} <small>${money(m.base_price)}</small></span></label>`).join('')}</div></fieldset>
 <div class="promotion-preview" aria-live="polite"></div><div class="actions"><button type="button" class="secondary" data-back-promotions>돌아가기</button><button type="submit" class="primary">할인 저장</button></div></form>`;
}
export function promotionData(form,id){
 const d=new FormData(form);return {id,title:d.get('title').trim(),enabled:d.has('enabled'),mode:d.get('mode'),value:Number(d.get('value')),weekdays:d.getAll('weekdays').map(Number),menu_ids:d.getAll('menu_ids').map(Number),start_time:d.get('start_time'),end_time:d.get('end_time'),start_date:d.get('start_date')||null,end_date:d.get('end_date')||null};
}
export function promotionPreview(form,menus){
 const p=promotionData(form,'preview'),input=form.elements.value;
 form.querySelector('[data-promotion-unit]').textContent=p.mode==='PERCENT'?'할인율 (%)':'할인 판매가 (원)';input.max=p.mode==='PERCENT'?'99':'1000000';
 form.querySelector('.promotion-preview').innerHTML=p.menu_ids.length?'<strong>적용 가격 미리보기</strong>'+menus.filter(m=>p.menu_ids.includes(m.id)).map(m=>`<p>${esc(m.name)} · ${money(m.base_price)} → <b>${money(p.mode==='PERCENT'?Math.floor(m.base_price*(100-p.value)/100):p.value)}</b></p>`).join(''):'할인할 메뉴를 선택해 주세요.';
}
