import {photoUrl} from "./backend.js";
const labels={burger:"버거",side:"사이드",drink:"음료"};
function categoryName(value) {return labels[value] || labels.burger;}
function menuPicture(item) {
  if(item.photo_key && /^[a-f0-9]{64}$/.test(item.photo_key))return photoUrl(item.photo_key);
  const image=item.category==="side"?"fries":item.category==="drink"?"cola":item.kind==="chicken"?"chicken":"classic";
  return "./assets/"+image+".svg";
}
export {labels,categoryName,menuPicture};
