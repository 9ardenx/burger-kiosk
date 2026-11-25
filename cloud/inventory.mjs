import {check} from './problems.mjs';
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);

export async function inventoryState(db) {
  const [items,history]=await db.batch([
    db.prepare(`SELECT m.id,m.name,m.category,m.photo_key,m.kind,m.is_sold_out,
      coalesce(s.enabled,0) AS enabled,coalesce(s.quantity,0) AS quantity,
      coalesce(s.low_threshold,5) AS low_threshold,coalesce(s.revision,0) AS revision
      FROM menu m LEFT JOIN inventory s ON s.menu_id=m.id ORDER BY m.id`),
    db.prepare(`SELECT h.*,m.name,o.number FROM inventory_movement h JOIN menu m ON m.id=h.menu_id
      LEFT JOIN orders o ON o.id=h.order_id ORDER BY h.id DESC LIMIT 100`)
  ]);
  return {items:items.results,history:history.results};
}

export async function saveInventory(db,id,body) {
  check(typeof body.enabled==='boolean' && ['quantity','low_threshold','revision'].every(k=>
    Number.isSafeInteger(body[k])&&body[k]>=0&&body[k]<=(k==='revision'?2147483647:1000000)),
    '수량·부족 알림 기준·재고 버전을 확인해 주세요.');
  check(typeof body.reason==='string'&&body.reason.trim().length>=1&&body.reason.trim().length<=200,'변경 사유를 1~200자로 입력해 주세요.');
  check(await stmt(db,'SELECT id FROM menu WHERE id=?',id).first(),'메뉴를 찾을 수 없습니다.',404);
  const results=await db.batch([
    stmt(db,'INSERT OR IGNORE INTO inventory(menu_id) VALUES(?)',id),
    stmt(db,`INSERT INTO inventory_movement(menu_id,kind,delta,before_quantity,after_quantity,reason)
      SELECT menu_id,'ADJUST',?-quantity,quantity,?,? FROM inventory WHERE menu_id=? AND revision=?`,
      body.quantity,body.quantity,body.reason.trim()+(body.enabled?' · 수량 관리 사용':' · 수량 관리 중지'),id,body.revision),
    stmt(db,`UPDATE inventory SET enabled=?,quantity=?,low_threshold=?,revision=revision+1
      WHERE menu_id=? AND revision=?`,Number(body.enabled),body.quantity,body.low_threshold,id,body.revision)
  ]);
  check(results[2].meta.changes===1,'판매나 다른 관리자의 수정으로 재고가 바뀌었습니다. 최신 수량을 불러온 뒤 다시 입력해 주세요.',409,'INVENTORY_CHANGED');
  return {ok:true};
}

export async function checkStock(db,cart) {
  const totals=new Map();for(const line of cart)totals.set(line.menu_id,(totals.get(line.menu_id)||0)+line.quantity);
  const {results}=await db.prepare('SELECT s.menu_id,s.quantity,m.name FROM inventory s JOIN menu m ON m.id=s.menu_id WHERE s.enabled=1').all();
  for(const row of results)check((totals.get(row.menu_id)||0)<=row.quantity,
    `${row.name} 판매 가능 수량이 부족합니다. 장바구니 수량을 줄여 주세요.`,409,'CART_CHANGED');
}
