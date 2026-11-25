import {escapeText as esc,money} from './common.js';
import {diningName} from './welcome.js';

export function periodPreset(days=7) {
  const now=Date.now()+9*3600000,to=new Date(now).toISOString().slice(0,10);
  return {from:new Date(now-(days-1)*86400000).toISOString().slice(0,10),to};
}
const count=n=>Number(n).toLocaleString('ko-KR');
const stamp=value=>new Date(value.replace(' ','T')+'Z').toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
const stat=(label,value,note,accent=false)=>`<article class="panel metric ${accent?'metric-main':''}"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`;

function chart(days) {
  if(days.length===1)return `<div class="single-day-chart"><span>${esc(days[0].date)} 순매출</span><strong>${money(days[0].net)}</strong><div class="single-day-bar" aria-hidden="true"></div></div>`;
  const width=760,height=180,pad=16,values=days.map(d=>d.net),max=Math.max(1,...values),min=Math.min(0,...values);
  const y=n=>pad+(height-pad*2)*(max-n)/(max-min);
  const x=i=>pad+(width-pad*2)*(days.length===1?.5:i/(days.length-1));
  const points=values.map((n,i)=>`${x(i)},${y(n)}`).join(' ');
  return `<div class="sales-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="선택 기간의 일별 순매출 추이. 정확한 수치는 아래 일별 내역에서 확인할 수 있습니다.">
    <line x1="${pad}" y1="${y(0)}" x2="${width-pad}" y2="${y(0)}" stroke="#d7e3dc"/>
    <polyline points="${points}" fill="none" stroke="#155e4d" stroke-width="3" stroke-linejoin="round"/>
    ${days.length<=31?values.map((n,i)=>`<circle cx="${x(i)}" cy="${y(n)}" r="4" fill="#155e4d"><title>${days[i].date}: ${money(n)}</title></circle>`).join(''):''}</svg>
    <div class="chart-labels"><span>${esc(days[0]?.date??'')}</span><span>${esc(days.at(-1)?.date??'')}</span></div></div>`;
}

export function salesView(data,period) {
  const s=data.summary;
  return `<div class="heading split"><div><p class="eyebrow">매장 운영</p><h1>매출 분석</h1><p>얼마나 팔렸는지, 어떤 메뉴를 많이 찾는지 확인하세요.</p></div><span class="mode-tag">모의 결제 기준</span></div>
    <section class="panel report-controls"><div class="period-presets" aria-label="빠른 기간 선택"><button class="secondary" data-sales-days="1">오늘</button><button class="secondary" data-sales-days="7">최근 7일</button><button class="secondary" data-sales-days="30">최근 30일</button></div>
    <form id="sales-period"><label>시작일<input name="from" type="date" value="${esc(period.from)}" required></label><label>종료일<input name="to" type="date" value="${esc(period.to)}" required></label><button class="primary">조회</button></form></section>
    <p class="report-caption">${esc(data.from)} ~ ${esc(data.to)} · 한국 시간 · 승인일 / 취소일 기준</p>
    <div class="metrics">${stat('순매출',money(s.net),'승인 금액 − 취소 금액',true)}${stat('승인 금액',money(s.approved),count(s.orders)+'건 승인')}${stat('취소 금액',money(s.cancelled),count(s.cancellations)+'건 취소')}${stat('순판매 수량',count(s.quantity-s.returned_quantity)+'개','승인 '+count(s.quantity)+'개 · 취소 '+count(s.returned_quantity)+'개')}</div>
    <section class="panel report-section"><div class="split"><h2>일별 매출 흐름</h2><span class="muted">승인 주문당 평균 ${money(s.orders?Math.round(s.approved/s.orders):0)}</span></div>${chart(data.daily)}
    ${!s.orders&&!s.cancellations?'<p class="empty-insight">이 기간에는 승인·취소 내역이 없습니다.</p>':''}
    <details><summary>일별 수치 확인</summary><div class="data-scroll"><table class="data-table"><thead><tr><th>날짜</th><th>승인</th><th>취소</th><th>순매출</th></tr></thead><tbody>${data.daily.map(d=>`<tr><th>${esc(d.date)}</th><td>${money(d.approved)}</td><td>${money(d.cancelled)}</td><td><strong>${money(d.net)}</strong></td></tr>`).join('')}</tbody></table></div></details></section>
    <section class="panel report-section"><div class="split"><h2>인기 메뉴</h2><span class="muted">승인 수량순 · 옵션 금액 포함</span></div>
    ${data.menus.length?`<div class="data-scroll"><table class="data-table ranking"><thead><tr><th>메뉴</th><th>승인 수량</th><th>취소 수량</th><th>순판매</th><th>순매출</th></tr></thead><tbody>${data.menus.map((m,i)=>`<tr><th><span class="rank">${i+1}</span>${esc(m.name)}</th><td>${count(m.quantity)}개</td><td>${count(m.returned_quantity)}개</td><td>${count(m.quantity-m.returned_quantity)}개</td><td><strong>${money(m.net)}</strong></td></tr>`).join('')}</tbody></table></div>`:'<p class="empty-insight">판매된 메뉴가 쌓이면 여기에 표시됩니다.</p>'}</section>
    <section class="panel report-section"><h2>매장 · 포장</h2><div class="dining-metrics">${data.dining.map(d=>`<div><span>${diningName(d.type)}</span><strong>${money(d.net)}</strong><small>승인 ${count(d.orders)}건 · 취소 ${count(d.cancellations)}건</small></div>`).join('')}</div></section>
    <p class="report-footnote">취소는 취소한 날짜에서 차감하므로, 이전 기간 주문을 취소한 날에는 순매출·순판매 수량이 음수일 수 있습니다. 결제 실패·미결제 주문은 제외하며, 메뉴 가격이 바뀌어도 주문 당시 금액으로 계산합니다. 세트·추가 옵션은 주문한 대표 메뉴에 포함합니다.</p>`;
}

export function inventoryView(data,edit=null,filter='all') {
  if(edit)return `<div class="heading"><button class="text-btn" data-inventory-back>재고 목록으로</button><h1>${esc(edit.name)} 수량 관리</h1><p>현재 판매할 수 있는 메뉴 수량을 입력하세요.</p></div>
    <form id="inventory-editor" class="panel inventory-editor" data-menu-id="${edit.id}" data-revision="${edit.revision}">
    <label class="check-line"><input type="checkbox" name="enabled" ${edit.enabled?'checked':''}>이 메뉴의 판매 가능 수량 관리</label>
    <p class="muted">켜면 승인된 주문 수량만큼 차감하고 0개에서 자동 품절됩니다. 끄면 수량 제한 없이 판매합니다.</p>
    <div class="inventory-inputs"><label>판매 가능 수량 (개)<input name="quantity" type="number" min="0" max="1000000" step="1" value="${edit.quantity}" required></label><label>재고 부족 기준 (개 이하)<input name="low_threshold" type="number" min="0" max="1000000" step="1" value="${edit.low_threshold}" required></label></div>
    <label>변경 사유<textarea name="reason" maxlength="200" rows="2" required placeholder="예: 오전 준비 수량 등록 / 입고 / 폐기 / 실사 조정"></textarea></label>
    <p class="report-footnote">판매가 발생해 수량이 바뀌면 저장을 중단하고 최신 수량을 알려 줍니다. 수동 품절 상태는 재고를 보충해도 유지됩니다.</p>
    <div class="actions"><button type="button" class="secondary" data-inventory-back>돌아가기</button><button class="primary">재고 저장</button></div></form>`;
  const managed=data.items.filter(i=>i.enabled),low=managed.filter(i=>i.quantity>0&&i.quantity<=i.low_threshold),zero=managed.filter(i=>i.quantity===0);
  const items=data.items.filter(i=>filter==='all'||(i.enabled&&(filter==='zero'?i.quantity===0:i.quantity<=i.low_threshold)));
  return `<div class="heading split"><div><p class="eyebrow">매장 운영</p><h1>재고 관리</h1><p>메뉴별 판매 가능 수량과 변동 내역을 확인하세요.</p></div><button class="secondary" data-inventory-refresh>새로고침</button></div>
    <div class="metrics inventory-metrics">${stat('수량 관리 중',count(managed.length)+'종','전체 '+data.items.length+'종 중')}${stat('재고 부족',count(low.length)+'종','설정한 부족 기준 이하')}${stat('재고 소진',count(zero.length)+'종','고객 화면에 자동 품절')}</div>
    <p class="inventory-note">기존 메뉴는 <strong>수량 관리 안 함</strong>으로 시작합니다. 실제 판매 가능 수량을 확인한 뒤 켜 주세요. 세트·추가 옵션에 포함된 다른 메뉴와 재료는 별도로 차감하지 않습니다.</p>
    <div class="filters">${[['all','전체'],['low','부족 · 소진'],['zero','소진']].map(([key,label])=>`<button data-inventory-filter="${key}" aria-pressed="${filter===key}">${label}</button>`).join('')}</div>
    <div class="inventory-list">${items.map(i=>`<article class="panel inventory-row"><div class="inventory-name"><h2>${esc(i.name)}</h2><span class="stock-label ${i.enabled&&i.quantity<=i.low_threshold?'stock-low':''}">${!i.enabled?'수량 관리 안 함':i.quantity===0?'자동 품절':i.quantity<=i.low_threshold?'재고 부족':'판매 가능'}</span>${i.is_sold_out?'<small class="muted">수동 품절 설정됨</small>':''}</div><div class="inventory-count"><strong>${i.enabled?count(i.quantity):'—'}</strong><small>${i.enabled?'개 남음':'수량 제한 없음'}</small></div><button class="secondary" data-inventory-edit="${i.id}" aria-label="${esc(i.name)} 재고 수정">수량 수정</button></article>`).join('')||'<div class="panel empty-insight">해당하는 메뉴가 없습니다.</div>'}</div>
    <section class="panel report-section"><h2>최근 재고 변동</h2><p class="muted">최근 100건 · 판매·취소·관리자 조정 이력</p>${data.history.length?`<div class="data-scroll"><table class="data-table"><thead><tr><th>시간 / 메뉴</th><th>변동</th><th>변경 후</th><th>사유</th></tr></thead><tbody>${data.history.map(h=>`<tr><th><small>${stamp(h.created_at)}</small>${esc(h.name)}</th><td>${h.delta>0?'+':''}${count(h.delta)}개</td><td>${count(h.after_quantity)}개</td><td>${esc(h.reason)}${h.number?`<small>주문 ${String(h.number).padStart(3,'0')}번</small>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<p class="empty-insight">아직 재고 변동 내역이 없습니다.</p>'}</section>`;
}
