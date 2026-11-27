import {storeId} from './store-context.mjs';
import {check} from './problems.mjs';
export const DEFAULT_CATEGORIES=[{id:'burger',name:'버거'},{id:'side',name:'사이드'},{id:'drink',name:'음료'}];
export const DEFAULT_CATEGORY_JSON=JSON.stringify(DEFAULT_CATEGORIES);
export const categoryExists=db=>`EXISTS(SELECT 1 FROM json_each(COALESCE((SELECT items FROM category_catalog WHERE id=${storeId(db)}),?)) WHERE json_extract(value,'$.id')=?)`;
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
export async function categoryState(db){
  const row=await db.prepare(`SELECT items,revision FROM category_catalog WHERE id=${storeId(db)}`).first();
  return {items:row?JSON.parse(row.items):DEFAULT_CATEGORIES,revision:row?.revision??0};
}
export async function saveCategories(db,body){
  check(Array.isArray(body.items)&&body.items.length>=1&&body.items.length<=20&&Number.isInteger(body.revision)&&body.revision>=0,'분류는 1~20개까지 등록할 수 있습니다.');
  const items=body.items.map(item=>{
    check(item&&typeof item.id==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(item.id)&&item.id!=='all','분류 식별자를 확인해 주세요.');
    check(typeof item.name==='string'&&item.name.trim().length>=1&&item.name.trim().length<=20,'분류 이름을 1~20자로 입력해 주세요.');
    return {id:item.id,name:item.name.trim()};
  });
  check(new Set(items.map(i=>i.id)).size===items.length&&new Set(items.map(i=>i.name.toLowerCase())).size===items.length,'분류 이름이나 식별자가 중복됩니다.');
  const data=JSON.stringify(items);
  const results=await db.batch([
    stmt(db,`INSERT OR IGNORE INTO category_catalog(id,items) VALUES(${storeId(db)},?)`,DEFAULT_CATEGORY_JSON),
    stmt(db,`UPDATE category_catalog SET items=?,revision=revision+1 WHERE id=${storeId(db)} AND revision=?
      AND NOT EXISTS(SELECT 1 FROM menu WHERE store_id=${storeId(db)} AND category NOT IN (SELECT json_extract(value,'$.id') FROM json_each(?)))`,data,body.revision,data)
  ]);
  check(results[1].meta.changes===1,'분류가 변경되었거나 삭제하려는 분류에 메뉴가 남아 있습니다. 최신 목록에서 메뉴를 먼저 옮겨 주세요.',409,'CATEGORIES_CHANGED');
  return {items,revision:body.revision+1};
}
