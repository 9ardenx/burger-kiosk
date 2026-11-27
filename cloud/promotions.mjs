import {check} from './problems.mjs';
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
export async function promotionState(db){
 const result=await db.batch([db.prepare('SELECT items,revision FROM promotion_catalog WHERE id=1'),
   db.prepare('SELECT id,ends_at FROM active_promotions'),db.prepare("SELECT unixepoch('now')*1000 AS server_time")]);
 const row=result[0].results[0];return {items:JSON.parse(row?.items??'[]'),revision:row?.revision??0,active:result[1].results,server_time:result[2].results[0].server_time};
}
export async function savePromotions(db,body){
 check(Number.isInteger(body.revision)&&body.revision>=0&&Array.isArray(body.items)&&body.items.length<=30,'할인은 최대 30개까지 등록할 수 있습니다.');
 const {results}=await db.prepare('SELECT id,base_price FROM menu').all(),menus=new Map(results.map(m=>[m.id,m.base_price]));
 const day=value=>{if(value==null||value==='')return null;check(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value),'날짜를 확인해 주세요.');const parsed=new Date(value+'T00:00:00Z');check(Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value,'날짜를 확인해 주세요.');return value;};
 const time=(value,end=false)=>typeof value==='string'&&(/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)||(end&&value==='24:00'));
 const items=body.items.map(p=>{
  check(p&&typeof p.id==='string'&&/^[A-Za-z0-9_-]{16,80}$/.test(p.id),'할인 식별자를 확인해 주세요.');
  check(typeof p.title==='string'&&p.title.trim()&&[...p.title.trim()].length<=40&&typeof p.enabled==='boolean','할인 이름과 사용 여부를 확인해 주세요.');
  check(Array.isArray(p.menu_ids)&&p.menu_ids.length>=1&&p.menu_ids.length<=100&&new Set(p.menu_ids).size===p.menu_ids.length&&p.menu_ids.every(id=>Number.isInteger(id)&&menus.has(id)),'할인할 메뉴를 선택해 주세요.');
  check(Array.isArray(p.weekdays)&&p.weekdays.length>=1&&p.weekdays.length<=7&&new Set(p.weekdays).size===p.weekdays.length&&p.weekdays.every(d=>Number.isInteger(d)&&d>=0&&d<=6),'할인 요일을 선택해 주세요.');
  check(time(p.start_time)&&time(p.end_time,true)&&p.start_time!==p.end_time,'시작·종료 시간을 다르게 입력해 주세요. 하루 전체는 00:00~24:00입니다.');
  check(['PERCENT','FIXED'].includes(p.mode)&&Number.isInteger(p.value)&&p.value>=1&&p.value<=(p.mode==='PERCENT'?99:1000000),'할인율은 1~99%, 할인 판매가는 1원 이상으로 입력해 주세요.');
  check(p.mode!=='FIXED'||p.menu_ids.every(id=>p.value<menus.get(id)),'할인 판매가는 선택한 모든 메뉴의 정상가보다 낮아야 합니다.');
  const start_date=day(p.start_date),end_date=day(p.end_date);check(!start_date||!end_date||start_date<=end_date,'종료 날짜는 시작 날짜보다 빠를 수 없습니다.');
  return {id:p.id,title:p.title.trim(),enabled:p.enabled,menu_ids:p.menu_ids,weekdays:p.weekdays,start_time:p.start_time,end_time:p.end_time,start_date,end_date,mode:p.mode,value:p.value};
 });
 check(new Set(items.map(p=>p.id)).size===items.length,'같은 할인이 중복되었습니다.');
 const changed=await db.batch([db.prepare('INSERT OR IGNORE INTO promotion_catalog(id) VALUES(1)'),stmt(db,'UPDATE promotion_catalog SET items=?,revision=revision+1 WHERE id=1 AND revision=?',JSON.stringify(items),body.revision)]);
 check(changed[1].meta.changes===1,'할인이 변경되었습니다. 최신 목록에서 다시 수정해 주세요.',409,'PROMOTIONS_CHANGED');return promotionState(db);
}
export const pricedMenu=(menu,q)=>({...menu,original_price:q.original_price,base_price:q.sale_price,
 promotion:q.promotion?{...JSON.parse(q.promotion),ends_at:q.ends_at}:null});
