import {photoUrl} from "./backend.js";
let labels={burger:"버거",side:"사이드",drink:"음료"};
function setCategories(items){if(Array.isArray(items)&&items.length)labels=Object.fromEntries(items.map(c=>[c.id,c.name]));}
function categoryName(value) {return labels[value] || '미분류';}
function menuPicture(item) {
  if(item.photo_key && /^[a-f0-9]{64}$/.test(item.photo_key))return photoUrl(item.photo_key);
  const image=item.category==="side"?"fries":item.category==="drink"?"cola":item.kind==="chicken"?"chicken":"classic";
  return "./assets/"+image+".svg";
}
export {labels,setCategories,categoryName,menuPicture};
