import {storeId} from './store-context.mjs';
import {check} from './problems.mjs';
const DAY=86400000,OFFSET=9*3600000;
const dayOf=value=>new Date(Date.parse(value.replace(' ','T')+'Z')+OFFSET).toISOString().slice(0,10);
export function dateRange(from,to) {
  const parse=value=>{
    check(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value),'조회 시작일과 종료일을 선택해 주세요.');
    const n=Date.parse(value+'T00:00:00Z');
    check(Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===value,'올바른 날짜를 입력해 주세요.');return n;
  };
  const start=parse(from),end=parse(to);
  check(start<=end&&end-start<366*DAY,'조회 기간은 시작일부터 최대 366일까지입니다.');
  return {from,to,start:new Date(start-OFFSET).toISOString().slice(0,19).replace('T',' '),end:new Date(end+DAY-OFFSET).toISOString().slice(0,19).replace('T',' ')};
}
export function summarizeSales(rows,range) {
  const blank=()=>({approved:0,cancelled:0,net:0,orders:0,cancellations:0,quantity:0,returned_quantity:0});
  const summary=blank(),daily=[],menus=new Map(),dining=new Map(['DINE_IN','TAKEOUT','UNKNOWN'].map(key=>[key,{type:key,...blank()}]));
  for(let t=Date.parse(range.from+'T00:00:00Z');t<=Date.parse(range.to+'T00:00:00Z');t+=DAY)daily.push({date:new Date(t).toISOString().slice(0,10),...blank()});
  const days=new Map(daily.map(d=>[d.date,d]));
  for(const order of rows)for(const [timestamp,cancel] of [[order.paid_at,false],[order.cancelled_at,true]]){
    if(!timestamp)continue;const day=dayOf(timestamp);if(!days.has(day))continue;
    const buckets=[summary,days.get(day),dining.get(order.dining_type)||dining.get('UNKNOWN')];
    for(const bucket of buckets){bucket[cancel?'cancelled':'approved']+=order.total;bucket[cancel?'cancellations':'orders']++;bucket.net=bucket.approved-bucket.cancelled;}
    for(const item of order.items){
      const revenue=item.quantity*(item.price+item.options.reduce((n,o)=>n+o.option_price,0));
      if(!menus.has(item.menu_id))menus.set(item.menu_id,{id:item.menu_id,name:item.name,...blank()});
      const menu=menus.get(item.menu_id);menu[cancel?'cancelled':'approved']+=revenue;menu.net=menu.approved-menu.cancelled;
      for(const bucket of [...buckets,menu])bucket[cancel?'returned_quantity':'quantity']+=item.quantity;
    }
  }
  return {from:range.from,to:range.to,timezone:'Asia/Seoul',basis:'payment-events',summary,daily,
    menus:[...menus.values()].sort((a,b)=>b.quantity-a.quantity||b.approved-a.approved||a.id-b.id),dining:[...dining.values()]};
}
export async function salesReport(db,params) {
  const range=dateRange(params.get('from'),params.get('to'));
  const {results}=await db.prepare(`SELECT o.id,o.total,o.dining_type,o.cancelled_at,p.created_at AS paid_at,
    (SELECT json_group_array(json_object('menu_id',i.menu_id,'name',i.name,'quantity',i.quantity,'price',i.price,
      'options',json((SELECT json_group_array(json_object('option_price',x.option_price)) FROM order_item_option x WHERE x.item_id=i.id)),
      'variants',json(i.choice_snapshot))) FROM order_item i WHERE i.order_id=o.id) AS items
    FROM orders o JOIN payment p ON p.order_id=o.id AND p.status='SUCCESS'
    WHERE o.store_id=${storeId(db)} AND ((p.created_at>=? AND p.created_at<?) OR (o.cancelled_at>=? AND o.cancelled_at<?)) ORDER BY p.created_at,o.id`)
    .bind(range.start,range.end,range.start,range.end).all();
  return summarizeSales(results.map(o=>({...o,items:JSON.parse(o.items).map(i=>({...i,options:[...i.options,...i.variants]}))})),range);
}
