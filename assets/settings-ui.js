import {escapeText} from './common.js?v=20261127-v171';
export function categoriesView(items,menu,dirty){
  return `<div class="heading"><h1>분류 관리</h1><p>메뉴 분류의 이름과 표시 순서를 관리합니다.</p></div>
  <form id="category-settings" class="panel"><p class="muted">메뉴가 남아 있는 분류는 삭제할 수 없습니다. 메뉴 수정에서 다른 분류로 옮긴 뒤 삭제해 주세요.</p>
  <div class="category-rows">${items.map((item,i)=>{const count=menu.filter(m=>m.category===item.id).length;return `<div class="category-row" data-category-id="${escapeText(item.id)}">
    <label>분류명<input name="category-name" data-category-name="${escapeText(item.id)}" required maxlength="20" value="${escapeText(item.name)}"></label>
    <span class="muted">메뉴 ${count}개</span><div class="category-actions">
    <button type="button" class="secondary" data-category-move="${i}" data-direction="-1" ${i===0?'disabled':''}>앞으로</button>
    <button type="button" class="secondary" data-category-move="${i}" data-direction="1" ${i===items.length-1?'disabled':''}>뒤로</button>
    <button type="button" class="danger-outline" data-category-remove="${i}" ${count||items.length===1?'disabled':''}>삭제</button></div></div>`;}).join('')}</div>
    <button type="button" class="secondary" data-category-add ${items.length>=20?'disabled':''}>+ 분류 추가</button>
    <div class="settings-footer"><span data-category-dirty role="status">${dirty?'저장하지 않은 변경이 있습니다.':'현재 저장된 분류입니다.'}</span>
    <div class="actions"><button type="button" class="secondary" data-category-discard>되돌리기</button><button type="submit" class="primary">분류 저장</button></div></div></form>`;
}
const newPasswordFields=()=>`<label>새 암호<input type="password" name="new_password" autocomplete="new-password" minlength="12" maxlength="128" required aria-describedby="password-help"></label>
  <label>새 암호 확인<input type="password" name="confirm_password" autocomplete="new-password" minlength="12" maxlength="128" required></label>
  <small id="password-help">12~128자 · 기억하기 쉬운 긴 문장을 사용할 수 있습니다.</small>`;
export function securityView(info){
  return `<div class="heading"><h1>암호 관리</h1><p>관리자 암호와 분실 시 사용할 복구 코드를 관리합니다.</p></div><div class="security-grid">
  <form id="password-settings" class="panel security-form"><h2>암호 변경</h2><p class="muted">변경 후 모든 기기에서 다시 로그인해야 합니다. 기존 복구 코드도 무효가 됩니다.</p>
  <label>현재 암호<input type="password" name="current_password" autocomplete="current-password" required></label>${newPasswordFields()}
  <button class="primary wide" type="submit">암호 변경</button></form>
  <form id="recovery-settings" class="panel security-form"><h2>분실 대비 복구 코드</h2><p class="muted">암호를 잊었을 때 한 번 사용할 수 있습니다. 발급 직후에만 보이므로 별도로 보관해 주세요.</p>
  <p class="info-note">${info?.recovery_ready?'사용 가능한 복구 코드가 발급되어 있습니다.':'아직 복구 코드를 발급하지 않았습니다.'}</p>
  <label>현재 암호 확인<input type="password" name="current_password" autocomplete="current-password" required></label>
  <button class="secondary wide" type="submit">${info?.recovery_ready?'복구 코드 새로 발급':'복구 코드 발급'}</button>
  <small>새 코드를 발급하면 이전 코드는 사용할 수 없습니다.</small><div id="recovery-result"></div></form></div>`;
}
export function recoveryResult(code){return `<div class="recovery-result"><label>복구 코드<textarea readonly rows="3" data-recovery-value>${escapeText(code)}</textarea></label>
  <button type="button" class="secondary" data-save-recovery>복구 코드 파일 저장</button><small>이 화면을 나가면 다시 표시되지 않습니다. 다른 사람에게 공유하지 마세요.</small></div>`;}
export function resetView(){return `<div class="login panel"><h1>암호 재설정</h1><p class="muted">미리 보관한 일회용 복구 코드로 새 암호를 설정합니다.</p>
  <form id="password-reset" class="security-form"><label>복구 코드<input name="recovery_code" autocomplete="off" maxlength="128" required></label>${newPasswordFields()}<button type="submit" class="primary wide">암호 재설정</button></form>
  <p><button type="button" class="text-btn" data-show-login>로그인으로 돌아가기</button></p><small>복구 코드가 없다면 서버 관리자에게 복구를 요청해 주세요.</small></div>`;}
