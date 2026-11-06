import {escapeText, notice} from "./common.js";
import {MAX_DEPTH, MAX_GROUPS, MAX_CHOICES} from "./choice-rules.js";
function newChoice() {return {id:crypto.randomUUID(),name:"",extra_price:0,children:[]};}
function newGroup() {return {id:crypto.randomUUID(),name:"",required:true,choices:[newChoice(),newChoice()]};}
function choiceHtml(choice,depth) {
  return `<div class="variant-choice" data-key="${escapeText(choice.id)}">
    <div class="variant-choice-fields"><label>선택지 이름<input data-choice-name required maxlength="40" placeholder="예: 콜라" value="${escapeText(choice.name)}"></label>
    <label>추가 금액 (원)<input data-choice-price type="number" min="0" max="1000000" step="1" required value="${choice.extra_price}"></label>
    <button type="button" class="text-btn" data-variant-action="remove-choice">선택지 삭제</button></div>
    <div class="variant-children">${choice.children.map(g=>groupHtml(g,depth+1)).join("")}</div>
    ${depth<MAX_DEPTH?'<button type="button" class="text-btn branch-btn" data-variant-action="child">이 선택지에 하위 그룹 추가</button>':""}</div>`;
}
function groupHtml(group,depth) {
  return `<div class="variant-group" data-depth="${depth}" data-key="${escapeText(group.id)}">
    <div class="variant-group-head"><label>그룹 이름<input data-group-name required maxlength="40" placeholder="예: 음료 종류" value="${escapeText(group.name)}"></label>
    <label>선택 규칙<select data-group-rule><option value="required" ${group.required?"selected":""}>필수 · 한 가지</option>
    <option value="optional" ${group.required?"":"selected"}>선택 · 최대 한 가지</option></select></label></div>
    <div class="variant-choices">${group.choices.map(c=>choiceHtml(c,depth)).join("")}</div>
    <div class="variant-toolbar"><button type="button" class="secondary" data-variant-action="choice">+ 선택지 추가</button>
    <button type="button" class="text-btn" data-variant-action="remove-group">그룹 삭제</button></div></div>`;
}
function groupEditor(groups) {
  return `<fieldset class="variant-editor"><legend>한 가지를 고르는 옵션</legend><p class="muted">예를 들어 ‘음료 종류’ 그룹에 콜라와 사이다를 넣고, 콜라 아래에 일반·제로를 추가할 수 있습니다.</p>
    <div id="variant-groups">${groups.map(g=>groupHtml(g,1)).join("")}</div>
    <button type="button" class="secondary" data-variant-action="group">+ 선택 그룹 추가</button></fieldset>`;
}
function handleVariantButton(button) {
  const action=button.dataset.variantAction;
  if(!action)return false;
  const root=document.querySelector("#variant-groups");
  const form=root.closest("form");
  const group=button.closest(".variant-group"),choice=button.closest(".variant-choice");
  if(action==="remove-choice"){choice.remove();return true;}
  if(action==="remove-group"){group.remove();return true;}
  if(action==="choice"){
    if(form.querySelectorAll(".variant-choice").length>=MAX_CHOICES){notice("선택지는 48개까지 추가할 수 있습니다.");return true;}
    const target=group.querySelector(":scope > .variant-choices");
    target.insertAdjacentHTML("beforeend",choiceHtml(newChoice(),Number(group.dataset.depth)));
    target.lastElementChild.querySelector("input").focus();return true;
  }
  const depth=action!=="child"?1:Number(group.dataset.depth)+1;
  if(depth>MAX_DEPTH || form.querySelectorAll(".variant-group").length>=MAX_GROUPS ||
      form.querySelectorAll(".variant-choice").length+2>MAX_CHOICES){notice("최대 3단계, 그룹 12개, 선택지 48개까지 구성할 수 있습니다.");return true;}
  const target=action==="extra-group"?button.closest(".option-edit").querySelector(".extra-children"):action==="group"?root:choice.querySelector(":scope > .variant-children");
  target.insertAdjacentHTML("beforeend",groupHtml(newGroup(),depth));
  target.lastElementChild.querySelector("input").focus();return true;
}
function readGroupEditor(container) {
  return Array.from(container.children,group=>({
    id:group.dataset.key,name:group.querySelector("[data-group-name]").value.trim(),
    required:group.querySelector("[data-group-rule]").value==="required",
    choices:Array.from(group.querySelector(":scope > .variant-choices").children,choice=>({
      id:choice.dataset.key,name:choice.querySelector("[data-choice-name]").value.trim(),
      extra_price:Number(choice.querySelector("[data-choice-price]").value),
      children:readGroupEditor(choice.querySelector(":scope > .variant-children"))
    }))
  }));
}

export {groupHtml, groupEditor, handleVariantButton, readGroupEditor};
