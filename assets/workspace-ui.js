import {escapeText as esc} from './common.js?v=20261128-v115';
import {directStores} from './workspace.js?v=20261128-v115';
export function workspaceBar(account,workspace,current,tab){
 if(workspace==='hq')return `<section class="workspace-banner" aria-label="현재 작업 공간"><div><span class="workspace-label">본사</span><strong>프랜차이즈 통합 관리</strong><small>${esc(account.email)}</small></div>${directStores(account).length?'<button class="secondary" data-workspace-store>직영점 운영으로 전환</button>':''}</section>`;
 const store=account.stores.find(s=>s.id===current),hq=account.platform_role==='HQ';
 if(!hq)return '';
 return `<section class="workspace-banner operating" aria-label="현재 작업 공간"><div><span class="workspace-label">${store?.membership_role==='OWNER'?'직영점 운영':'가맹점 운영 지원'}</span><strong>현재 ${esc(store?.name??'선택 매장')} 운영 중</strong><small>이 화면의 주문·메뉴·재고 변경은 이 매장에만 적용됩니다.</small></div><button class="secondary" data-workspace-hq>본사로 돌아가기</button></section>`;
}
export function hqHomeView(account,data){
 const stores=data.stores,direct=directStores(account);
 return `<div class="heading"><h1>본사 관리</h1><p>가맹점 현황을 확인하고 본사 업무를 시작하세요.</p></div>
 <section class="metrics hq-overview" aria-label="가맹점 현황"><div class="panel metric"><span>전체 가맹점</span><strong>${stores.length}개</strong></div><div class="panel metric"><span>점주 연결 완료</span><strong>${stores.filter(s=>s.owner_count).length}개</strong></div><div class="panel metric"><span>점주 가입 대기</span><strong>${stores.filter(s=>!s.owner_count&&s.pending_owners).length}개</strong></div></section>
 <div class="hq-shortcuts">${[['hqsales','통합 매출','전체 매장의 매출과 인기 메뉴를 확인합니다.'],['hqsupply','본사 발주 취합','점포의 재료 발주를 모아 승인하고 출고합니다.'],['franchise','가맹점 관리','매장을 개설하고 점포명과 주소를 관리합니다.'],['hqaccounts','계정 관리','본사 로그인 정보와 매장별 점주·직원 초대를 관리합니다.']].map(([id,title,description])=>`<section class="panel"><h2>${title}</h2><p class="muted">${description}</p><button class="secondary" data-tab="${id}">${title} 열기</button></section>`).join('')}</div>
 ${direct.length?`<section class="panel direct-operation"><div><h2>직영점 운영</h2><p>직접 운영하는 매장의 주문·메뉴·재고를 관리합니다.</p></div><form id="open-direct-store"><label>운영할 매장<select name="store">${direct.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label><button class="primary">직영점 운영으로 전환</button></form></section>`:''}`;
}
export function hqAccountsView(account,data){
 return `<div class="heading"><h1>계정 관리</h1><p>본사 계정과 가맹점 구성원을 구분해서 관리합니다.</p></div><section class="panel hq-account-self"><h2>내 본사 계정</h2><p>${esc(account.email)}</p><button class="secondary" data-reset-own>내 비밀번호 재설정 메일 받기</button></section><section class="hq-member-stores"><h2>매장별 점주·직원 관리</h2><p class="muted">매장을 선택하면 해당 매장의 구성원과 초대 목록을 확인할 수 있습니다.</p><div class="franchise-store-list">${data.stores.map(s=>`<article class="panel franchise-store"><h3>${esc(s.name)}</h3><p>${s.owner_count?'점주 연결 완료':s.pending_owners?'점주 가입 대기':'점주 등록 필요'}</p><button class="secondary" data-store-accounts="${s.id}">점주·구성원 관리</button></article>`).join('')||'<p>등록된 매장이 없습니다. 가맹점 관리에서 매장을 개설해 주세요.</p>'}</div></section>`;
}
export function hqStoreContext(account,current,tab){
 const store=account.stores.find(s=>s.id===current);
 return `<section class="hq-store-context"><button class="text-btn" data-tab="${tab==='accounts'?'hqaccounts':'franchise'}">${tab==='accounts'?'전체 매장 계정 목록':'가맹점 목록'}으로 돌아가기</button><strong>${esc(store?.name??'선택 매장')} · ${tab==='accounts'?'점주·구성원 관리':'매장 정보'}</strong><p class="muted">변경 사항은 이 매장에만 적용됩니다.</p></section>`;
}
