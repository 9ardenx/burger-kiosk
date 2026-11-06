import {groupHtml, groupEditor, readGroupEditor} from "./group-editor.js";
import {validateGroups} from "./choice-rules.js";
import {escapeText} from "./common.js";
import {labels,menuPicture} from "./catalog.js";
function categoryOptions(selected) {
  return Object.entries(labels).map(([id,label])=>`<option value="${id}" ${selected===id?"selected":""}>${label}</option>`).join("");
}
function optionRow(option={}, groups=[]) {
  return `<div class="option-edit" data-option-id="${option.id??""}">
    <label>옵션명<input required maxlength="40" name="option-name" value="${escapeText(option.name??"")}" placeholder="예: 치즈 추가"></label>
    <label>추가 금액 (원)<input type="number" name="option-price" min="0" max="1000000" step="1" required value="${option.extra_price??0}"></label>
    <button type="button" class="text-btn" data-remove-option aria-label="이 옵션 삭제">삭제</button>
    <div class="extra-branch"><div class="extra-children">${groups.map(g=>groupHtml(g,1)).join("")}</div>
    <button type="button" class="text-btn" data-variant-action="extra-group">이 추가 옵션에 하위 그룹 추가</button></div></div>`;
}
function editorHtml(item) {
  const create=!item;
  item??={category:"burger",options:[],name:"",description:"",base_price:"",is_sold_out:0};
  return `<div class="heading split"><h1>${create?"메뉴 등록":"메뉴 수정"}</h1><button class="secondary" data-back-menu>목록으로</button></div>
  <form id="menu-editor" class="panel catalog-editor">
    <div class="photo-editor"><img id="photo-preview" alt="메뉴 이미지 미리보기" src="${menuPicture(item)}">
    <label>메뉴 사진<input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></label>
    <small>JPG, PNG, WebP · 최대 10 MB</small><button type="button" class="text-btn" data-clear-photo>기본 그림 사용</button></div>
    <section class="editor-fields"><label>메뉴명<input name="name" required maxlength="50" value="${escapeText(item.name)}" placeholder="예: 감자튀김"></label>
    <label>메뉴 설명<input name="description" maxlength="140" value="${escapeText(item.description)}"></label>
    <div class="field-pair"><label>분류<select name="category">${categoryOptions(item.category)}</select></label>
    <label>판매 가격 (원)<input type="number" name="price" min="0" max="1000000" step="1" required value="${item.base_price}"></label></div>
    <label>판매 상태<select name="sold"><option value="no" ${item.is_sold_out?"":"selected"}>판매 중</option><option value="yes" ${item.is_sold_out?"selected":""}>품절</option></select></label>
    ${groupEditor((item.choice_groups??[]).filter(g=>!g.when_extra))}
    <fieldset><legend>여러 개를 고르는 추가 옵션</legend><div id="option-rows">${item.options.map(o=>optionRow(o,(item.choice_groups??[]).filter(g=>g.when_extra===o.name))).join("")}</div>
    <button class="secondary" type="button" data-add-option>+ 옵션 추가</button></fieldset>
    <button class="primary wide" type="submit">${create?"메뉴 등록하기":"변경 저장"}</button></section></form>`;
}
async function jpegForUpload(file) {
  if(file.size>10*1024*1024 || !["image/jpeg","image/png","image/webp"].includes(file.type))
    throw new Error("10 MB 이하의 JPG, PNG 또는 WebP 파일을 선택해 주세요.");
  const url=URL.createObjectURL(file), img=new Image();
  try {
    img.src=url; await img.decode();
    const factor=Math.min(1,720/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement("canvas");
    canvas.width=Math.max(1,Math.round(img.naturalWidth*factor));canvas.height=Math.max(1,Math.round(img.naturalHeight*factor));
    const ctx=canvas.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    for(const quality of [.86,.72,.55,.38]) {
      const data=canvas.toDataURL("image/jpeg",quality).split(",")[1];
      if(data && data.length<=256000)return data;
    }
    throw new Error("사진 용량이 큽니다. 더 작은 이미지를 선택해 주세요.");
  } finally {URL.revokeObjectURL(url);}
}
async function editorData(form,editor) {
  const data=new FormData(form);
  const options=Array.from(form.querySelectorAll(".option-edit"),row=>{
    const option={name:row.querySelector('[name="option-name"]').value.trim(),
      extra_price:Number(row.querySelector('[name="option-price"]').value)};
    if(row.dataset.optionId)option.id=Number(row.dataset.optionId);
    return option;
  });
  const result={name:data.get("name").trim(),description:data.get("description").trim(),category:data.get("category"),
    base_price:Number(data.get("price")),is_sold_out:data.get("sold")==="yes",options};
  const groups=readGroupEditor(form.querySelector("#variant-groups"));
  for(const row of form.querySelectorAll(".option-edit")){
    const name=row.querySelector('[name="option-name"]').value.trim();
    for(const g of readGroupEditor(row.querySelector(".extra-children")))groups.push({...g,when_extra:name});
  }
  result.choice_groups=validateGroups(groups,options.map(o=>o.name));
  if(editor.item)result.version=editor.item.version;else result.key=editor.key;
  if(form.elements.photo.files.length)result.photo=await jpegForUpload(form.elements.photo.files[0]);
  else if(form.dataset.clearPhoto)result.photo=null;
  return result;
}

export {editorHtml, editorData, optionRow};
