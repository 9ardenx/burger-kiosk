import {escapeText as esc} from './common.js?v=20261128-v110';
import {addressFields} from './store-profile-ui.js?v=20261128-v110';
export function franchiseView(data){
 const stores=data.stores,templates=stores.filter(s=>s.menu_count>0);
 return `<section class="franchise-dashboard"><div class="heading"><h1>본사 관리</h1><p class="muted">같은 기본 구성으로 가맹점을 개설하고, 매장별 운영을 관리합니다.</p></div>
 <div class="franchise-layout"><section class="panel franchise-opening"><h2>가맹점 개설 · 점주 초대</h2>
 <p>메뉴·사진·옵션·분류·메뉴 순서·광고를 새 매장에 복사합니다. 점주는 자기 매장의 모든 운영 기능을 사용할 수 있습니다.</p>
 <form id="create-store"><input type="hidden" name="key" value="${crypto.randomUUID()}">
 <label class="check-line"><input type="checkbox" name="address_pending">점주가 가입 후 매장 주소 입력</label><p class="muted">선택하면 임시 이름으로 개설하고, 점주의 첫 주소 등록 시 점포명을 자동 확정합니다.</p>
 ${addressFields()}
 <label>본사 지정 점포명 (선택)<input name="name" maxlength="45" placeholder="비워 두면 주소로 자동 생성"></label>
 <label>점주 이메일<input name="owner_email" type="email" required maxlength="254" autocomplete="off" placeholder="점주가 가입할 이메일"></label>
 <label>기본 구성을 가져올 매장<select name="source_store_id" required>${templates.map(s=>`<option value="${s.id}" ${s.id===1?'selected':''}>${esc(s.name)} · 메뉴 ${s.menu_count}개</option>`).join('')}</select></label>
 <p class="muted">복사 후에는 매장별로 독립적으로 수정합니다. 주문·매출은 0건부터, 재고는 추적 해제·수량 0부터 시작합니다. 품절 상태와 할인 예약은 가져오지 않습니다.</p>
 <p class="muted">초대는 7일간 유효합니다. 완료 후 가입 안내를 복사해 점주에게 전달해 주세요. 초대 메일은 자동 발송하지 않습니다.</p>
 <button class="primary wide" ${templates.length?'':'disabled'}>기본 구성으로 개설하고 점주 초대</button>${templates.length?'':'<p class="error-note">기본 메뉴가 있는 매장을 먼저 준비해 주세요.</p>'}</form></section>
 <section class="franchise-stores"><h2>가맹점 ${stores.length}개</h2><div class="franchise-store-list">${stores.map(s=>`<article class="panel franchise-store"><h3>${esc(s.name)}</h3><p>메뉴 ${s.menu_count}개 · ${s.owner_count?'점주 연결 완료':s.pending_owners?'점주 가입 대기':'점주 등록 필요'}</p><p class="muted">${esc(s.address|| (s.address_pending?'점주 주소 입력 대기':'주소 미등록'))} ${esc(s.address_detail??'')}</p><div class="actions"><button class="primary" data-open-store="${s.id}">매장 운영 관리</button><button class="secondary" data-store-accounts="${s.id}">점주·구성원 관리</button><button class="secondary" data-store-profile="${s.id}">매장 정보</button></div><a class="text-btn" href="./?store=${s.id}" target="_blank" rel="noopener">이 매장 키오스크 열기</a></article>`).join('')}</div></section></div></section>`;
}
