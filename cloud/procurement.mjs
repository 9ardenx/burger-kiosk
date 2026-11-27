import {check} from './problems.mjs';
import {storeId} from './store-context.mjs';
import {stmt,requireHQ,integer,textField,requestKey,ingredientCatalog} from './ingredients.mjs';
const OPEN="('REQUESTED','APPROVED','SHIPPED','PARTIAL')";
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
const selectOrder=`SELECT o.*,s.name AS store_name,(SELECT json_group_array(json_object('id',l.id,'ingredient_id',l.ingredient_id,'name',l.name,'unit',l.unit,'pack_label',l.pack_label,'pack_size',l.pack_size,'packs',l.packs,'ordered_units',l.ordered_units,'received_units',l.received_units)) FROM supply_line l WHERE l.order_id=o.id) AS lines FROM supply_order o JOIN store s ON s.id=o.store_id`;
const view=row=>({...row,lines:JSON.parse(row.lines)});
export async function supplyOrder(db,id,scope=storeId(db)){
 const row=await stmt(db,selectOrder+' WHERE o.id=?'+(scope===null?'':' AND o.store_id=?'),id,...(scope===null?[]:[scope])).first();check(row,'발주를 찾을 수 없습니다.',404,'SUPPLY_NOT_FOUND');
 const events=await stmt(db,'SELECT status,note,created_at FROM supply_event WHERE order_id=? ORDER BY id',id).all();
 const receipts=await stmt(db,`SELECT r.id,r.note,r.created_at,(SELECT json_group_array(json_object('line_id',x.line_id,'quantity',x.quantity)) FROM supply_receipt_line x WHERE x.receipt_id=r.id) AS lines FROM supply_receipt r WHERE r.order_id=? ORDER BY r.created_at,r.id`,id).all();
 return {order:view(row),events:events.results,receipts:receipts.results.map(r=>({...r,lines:JSON.parse(r.lines)}))};
}
export async function supplyList(db,params,scope=storeId(db)){
 const status=params.get('status')??'open',page=Number(params.get('page')??0);
 check(['open','all','REQUESTED','APPROVED','SHIPPED','PARTIAL','RECEIVED','CANCELLED','REJECTED'].includes(status)&&integer(page,0,10000),'조회 조건을 확인해 주세요.');
 const where=`WHERE 1=1${scope===null?'':' AND o.store_id=?'}${status==='all'?'':status==='open'?` AND o.status IN ${OPEN}`:' AND o.status=?'}`;
 const args=[...(scope===null?[]:[scope]),...(['open','all'].includes(status)?[]:[status])];
 const [rows,count]=await db.batch([stmt(db,selectOrder+' '+where+' ORDER BY o.created_at DESC,o.id DESC LIMIT 50 OFFSET ?',...args,page*50),stmt(db,'SELECT count(*) AS total FROM supply_order o '+where,...args)]);
 return {orders:rows.results.map(view),total:count.results[0].total,page,status};
}
export async function hqSupply(db,actor,params){
 requireHQ(actor);
 const [list,catalog,summary]=await Promise.all([supplyList(db,params,null),ingredientCatalog(db),db.prepare(`SELECT i.id,i.name,i.unit,i.pack_label,i.pack_size,
 sum(CASE WHEN o.status='REQUESTED' THEN l.packs ELSE 0 END) AS requested_packs,
 sum(CASE WHEN o.status='APPROVED' THEN l.packs ELSE 0 END) AS approved_packs,
 sum(CASE WHEN o.status IN ('SHIPPED','PARTIAL') THEN l.ordered_units-l.received_units ELSE 0 END) AS in_transit_units,
 sum(l.ordered_units-l.received_units) AS open_units,count(DISTINCT o.store_id) AS stores
 FROM supply_line l JOIN supply_order o ON o.id=l.order_id JOIN ingredient i ON i.id=l.ingredient_id WHERE o.status IN ${OPEN} GROUP BY i.id ORDER BY i.id`).all()]);
 return {...list,items:catalog.items,summary:summary.results};
}
export async function createSupply(db,actor,body){
 const store=storeId(db),key=requestKey(body.key),note=textField(body.note??'',200);
 check(Array.isArray(body.lines)&&body.lines.length>0&&body.lines.length<=20,'1~20개 재료를 선택해 주세요.');
 const lines=body.lines.map(l=>{check(l&&integer(l.ingredient_id,1)&&integer(l.packs,1,10000)&&integer(l.revision),'발주 품목과 포장 수량을 확인해 주세요.');return {id:l.ingredient_id,packs:l.packs,revision:l.revision};}).sort((a,b)=>a.id-b.id);
 check(new Set(lines.map(l=>l.id)).size===lines.length,'같은 재료가 중복되었습니다.');
 const signature=await hash([lines,note]);const old=await stmt(db,'SELECT id,signature FROM supply_order WHERE store_id=? AND request_key=?',store,key).first();
 if(old){check(old.signature===signature,'같은 요청의 발주 내용이 변경되었습니다.',409,'REQUEST_CHANGED');return supplyOrder(db,old.id);}
 const id=crypto.randomUUID(),tag=crypto.randomUUID(),conditions=lines.map(()=>'(id=? AND revision=? AND pack_size*?<=1000000000)').join(' OR ');
 const gate='EXISTS(SELECT 1 FROM supply_order WHERE id=? AND creation_tag=?)',guard=[id,tag];
 const commands=[stmt(db,`INSERT OR IGNORE INTO supply_order(id,store_id,request_key,signature,creation_tag,requested_by,note)
 SELECT ?,?,?,?,?,?,? WHERE (SELECT count(*) FROM ingredient WHERE active=1 AND (${conditions}))=?`,id,store,key,signature,tag,actor.uid,note,...lines.flatMap(l=>[l.id,l.revision,l.packs]),lines.length)];
 for(const line of lines)commands.push(stmt(db,`INSERT INTO supply_line(id,order_id,ingredient_id,name,unit,pack_label,pack_size,packs,ordered_units)
 SELECT ?,?,id,name,unit,pack_label,pack_size,?,pack_size*? FROM ingredient WHERE id=? AND ${gate}`,crypto.randomUUID(),id,line.packs,line.packs,line.id,...guard));
 commands.push(stmt(db,`INSERT INTO supply_event(order_id,status,actor,note) SELECT ?,'REQUESTED',?,? WHERE ${gate}`,id,actor.uid,note,...guard));
 await db.batch(commands);
 const saved=await stmt(db,'SELECT id,signature FROM supply_order WHERE store_id=? AND request_key=?',store,key).first();
 check(saved,'재료 규격이나 사용 상태가 변경되었습니다. 다시 불러온 뒤 발주해 주세요.',409,'INGREDIENT_CHANGED');
 check(saved.signature===signature,'같은 요청의 발주 내용이 변경되었습니다.',409,'REQUEST_CHANGED');return supplyOrder(db,saved.id);
}
export async function transitionSupply(db,actor,id,body,headOffice=false){
 if(headOffice)requireHQ(actor);
 const routes=headOffice?{approve:['REQUESTED','APPROVED'],ship:['APPROVED','SHIPPED'],reject:['REQUESTED','REJECTED']}:{cancel:['REQUESTED','CANCELLED']};
 const route=Object.hasOwn(routes,body.action)?routes[body.action]:null;check(route&&integer(body.revision),'처리할 발주 상태를 확인해 주세요.');
 const note=textField(body.note??'',200,['reject','cancel'].includes(body.action)),tag=crypto.randomUUID(),scope=headOffice?null:storeId(db);
 await supplyOrder(db,id,scope);
 const result=await db.batch([
  stmt(db,`UPDATE supply_order SET status=?,revision=revision+1,action_tag=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=? AND revision=?${headOffice?'':' AND store_id=?'}`,route[1],tag,id,route[0],body.revision,...(headOffice?[]:[scope])),
  stmt(db,`INSERT INTO supply_event(order_id,status,actor,note) SELECT id,status,?,? FROM supply_order WHERE id=? AND action_tag=?`,actor.uid,note,id,tag)
 ]);check(result[0].meta.changes===1,'발주 상태가 변경되었습니다. 최신 목록을 확인해 주세요.',409,'SUPPLY_CHANGED');return supplyOrder(db,id,scope);
}
export async function receiveSupply(db,actor,id,body){
 const store=storeId(db),key=requestKey(body.key),note=textField(body.note??'',200);
 check(integer(body.revision)&&Array.isArray(body.lines)&&body.lines.length>0&&body.lines.length<=20,'입고 수량을 확인해 주세요.');
 const lines=body.lines.map(l=>{check(l&&typeof l.line_id==='string'&&l.line_id.length<=80&&integer(l.quantity,1),'입고 수량은 기본 단위의 양의 정수로 입력해 주세요.');return {id:l.line_id,quantity:l.quantity};}).sort((a,b)=>a.id.localeCompare(b.id));
 check(new Set(lines.map(l=>l.id)).size===lines.length,'같은 입고 품목이 중복되었습니다.');
 const signature=await hash([id,lines,note]),old=await stmt(db,'SELECT id,signature FROM supply_receipt WHERE store_id=? AND request_key=?',store,key).first();
 if(old){check(old.signature===signature,'같은 입고 요청의 수량이 변경되었습니다.',409,'REQUEST_CHANGED');return {...await supplyOrder(db,id),receipt_id:old.id,replayed:true};}
 await supplyOrder(db,id);
 const receipt=crypto.randomUUID(),tag=crypto.randomUUID();
 const valid=lines.map(()=>'(l.id=? AND l.received_units+?<=l.ordered_units AND coalesce(s.quantity,0)+?<=1000000000)').join(' OR ');
 const gate='EXISTS(SELECT 1 FROM supply_receipt WHERE id=? AND creation_tag=?)',guard=[receipt,tag];
 const commands=[stmt(db,`INSERT OR IGNORE INTO supply_receipt(id,order_id,store_id,request_key,signature,creation_tag,actor,note)
 SELECT ?,id,store_id,?,?,?,?,? FROM supply_order WHERE id=? AND store_id=? AND revision=? AND status IN ('SHIPPED','PARTIAL')
 AND (SELECT count(*) FROM supply_line l LEFT JOIN ingredient_stock s ON s.store_id=? AND s.ingredient_id=l.ingredient_id WHERE l.order_id=? AND (${valid}))=?`,
 receipt,key,signature,tag,actor.uid,note,id,store,body.revision,store,id,...lines.flatMap(l=>[l.id,l.quantity,l.quantity]),lines.length)];
 for(const line of lines){
  commands.push(stmt(db,`INSERT INTO supply_receipt_line(receipt_id,line_id,quantity) SELECT ?,?,? WHERE ${gate}`,receipt,line.id,line.quantity,...guard));
 }
 commands.push(stmt(db,`INSERT OR IGNORE INTO ingredient_stock(store_id,ingredient_id) SELECT ?,l.ingredient_id FROM supply_receipt_line x JOIN supply_line l ON l.id=x.line_id WHERE x.receipt_id=? AND ${gate}`,store,receipt,...guard));
 commands.push(stmt(db,`INSERT INTO ingredient_movement(store_id,ingredient_id,kind,delta,before_quantity,after_quantity,reason,actor,receipt_id)
  SELECT s.store_id,s.ingredient_id,'RECEIPT',x.quantity,s.quantity,s.quantity+x.quantity,?,?,? FROM supply_receipt_line x JOIN supply_line l ON l.id=x.line_id JOIN ingredient_stock s ON s.ingredient_id=l.ingredient_id AND s.store_id=? WHERE x.receipt_id=? AND ${gate}`,note||'발주 입고 확인',actor.uid,receipt,store,receipt,...guard));
 commands.push(stmt(db,`UPDATE ingredient_stock SET quantity=quantity+(SELECT x.quantity FROM supply_receipt_line x JOIN supply_line l ON l.id=x.line_id WHERE x.receipt_id=? AND l.ingredient_id=ingredient_stock.ingredient_id),revision=revision+1
  WHERE store_id=? AND ingredient_id IN (SELECT l.ingredient_id FROM supply_receipt_line x JOIN supply_line l ON l.id=x.line_id WHERE x.receipt_id=?) AND ${gate}`,receipt,store,receipt,...guard));
 commands.push(stmt(db,`UPDATE supply_line SET received_units=received_units+(SELECT quantity FROM supply_receipt_line WHERE receipt_id=? AND line_id=supply_line.id) WHERE id IN (SELECT line_id FROM supply_receipt_line WHERE receipt_id=?) AND ${gate}`,receipt,receipt,...guard));
 commands.push(stmt(db,`UPDATE supply_order SET status=CASE WHEN EXISTS(SELECT 1 FROM supply_line WHERE order_id=? AND received_units<ordered_units) THEN 'PARTIAL' ELSE 'RECEIVED' END,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND ${gate}`,id,id,...guard));
 commands.push(stmt(db,`INSERT INTO supply_event(order_id,status,actor,note) SELECT id,status,?,? FROM supply_order WHERE id=? AND ${gate}`,actor.uid,note||'점포 입고 확인',id,...guard));
 await db.batch(commands);
 const saved=await stmt(db,'SELECT id,signature FROM supply_receipt WHERE store_id=? AND request_key=?',store,key).first();
 check(saved,'출고 상태·남은 수량·재고가 변경되었습니다. 최신 발주와 재고를 확인해 주세요.',409,'RECEIPT_CHANGED');
 check(saved.signature===signature,'같은 입고 요청의 수량이 변경되었습니다.',409,'REQUEST_CHANGED');
 return {...await supplyOrder(db,id),receipt_id:saved.id,replayed:false};
}
