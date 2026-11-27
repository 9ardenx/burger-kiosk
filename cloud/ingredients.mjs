import {check} from './problems.mjs';
import {storeId} from './store-context.mjs';
export const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
export const requireHQ=actor=>check(!actor.legacy&&actor.platform_role==='HQ','본사 관리자 권한이 필요합니다.',403,'ROLE_FORBIDDEN');
export const integer=(value,min=0,max=1000000000)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
export function textField(value,max=200,required=false){check(typeof value==='string'&&value.length<=max&&(!required||value.trim())&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value),'입력 내용을 확인해 주세요.');return value.trim();}
export function requestKey(value){check(typeof value==='string'&&/^[A-Za-z0-9_-]{16,80}$/.test(value),'요청 화면을 새로고침해 주세요.');return value;}
export async function ingredientCatalog(db){return {items:(await db.prepare('SELECT * FROM ingredient ORDER BY active DESC,id').all()).results};}
export async function saveIngredient(db,actor,body,id){
 requireHQ(actor);const name=textField(body.name,60,true);check(typeof body.active==='boolean','사용 상태를 확인해 주세요.');
 if(id){
  check(integer(body.revision),'재료 정보를 다시 불러와 주세요.');
  const old=await stmt(db,'SELECT * FROM ingredient WHERE id=?',id).first();check(old,'재료를 찾을 수 없습니다.',404);
  for(const field of ['unit','pack_label','pack_size'])check(body[field]===undefined||body[field]===old[field],'등록 후 단위·포장 수량은 변경할 수 없습니다. 다른 규격은 새 재료로 등록해 주세요.');
  const r=await stmt(db,'UPDATE ingredient SET name=?,active=?,revision=revision+1 WHERE id=? AND revision=?',name,Number(body.active),id,body.revision).run();
  check(r.meta.changes===1,'다른 관리자가 재료를 변경했습니다. 새로고침해 주세요.',409,'INGREDIENT_CHANGED');return {ok:true};
 }
 const key=requestKey(body.key),unit=textField(body.unit,8,true),pack=textField(body.pack_label,12,true);
 check(['개','장','g','ml'].includes(unit)&&integer(body.pack_size,1,1000000),'기본 단위와 포장당 수량을 확인해 주세요.');
 await stmt(db,'INSERT OR IGNORE INTO ingredient(registration_key,name,unit,pack_label,pack_size,active) VALUES(?,?,?,?,?,?)',key,name,unit,pack,body.pack_size,Number(body.active)).run();
 const saved=await stmt(db,'SELECT * FROM ingredient WHERE registration_key=?',key).first();
 check(saved.name===name&&saved.unit===unit&&saved.pack_label===pack&&saved.pack_size===body.pack_size&&saved.active===Number(body.active),'같은 요청의 재료 내용이 변경되었습니다.',409,'REQUEST_CHANGED');return saved;
}
export async function ingredientInventory(db){
 const id=storeId(db),r=await db.batch([
  stmt(db,`SELECT i.*,coalesce(s.quantity,0) AS quantity,coalesce(s.low_threshold,0) AS low_threshold,coalesce(s.revision,0) AS stock_revision,
   CASE WHEN s.ingredient_id IS NULL THEN 0 ELSE 1 END AS tracked FROM ingredient i LEFT JOIN ingredient_stock s ON s.ingredient_id=i.id AND s.store_id=? ORDER BY i.active DESC,i.id`,id),
  stmt(db,`SELECT h.*,i.name,i.unit FROM ingredient_movement h JOIN ingredient i ON i.id=h.ingredient_id WHERE h.store_id=? ORDER BY h.id DESC LIMIT 100`,id)
 ]);return {items:r[0].results,history:r[1].results};
}
export async function adjustIngredient(db,actor,id,body){
 check(integer(body.quantity)&&integer(body.low_threshold)&&integer(body.revision),'수량·부족 기준·재고 버전을 확인해 주세요.');
 const reason=textField(body.reason,200,true),store=storeId(db);check(await stmt(db,'SELECT id FROM ingredient WHERE id=?',id).first(),'재료를 찾을 수 없습니다.',404);
 const r=await db.batch([
  stmt(db,'INSERT OR IGNORE INTO ingredient_stock(store_id,ingredient_id) SELECT ?,? WHERE ?=0',store,id,body.revision),
  stmt(db,`INSERT INTO ingredient_movement(store_id,ingredient_id,kind,delta,before_quantity,after_quantity,reason,actor)
   SELECT store_id,ingredient_id,'ADJUST',?-quantity,quantity,?,?,? FROM ingredient_stock WHERE store_id=? AND ingredient_id=? AND revision=?`,body.quantity,body.quantity,reason,actor.uid,store,id,body.revision),
  stmt(db,'UPDATE ingredient_stock SET quantity=?,low_threshold=?,revision=revision+1 WHERE store_id=? AND ingredient_id=? AND revision=?',body.quantity,body.low_threshold,store,id,body.revision)
 ]);check(r[2].meta.changes===1,'입고나 다른 수정으로 재고가 변경되었습니다. 최신 수량을 확인해 주세요.',409,'INGREDIENT_STOCK_CHANGED');return {ok:true};
}
