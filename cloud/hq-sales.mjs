import {check} from './problems.mjs';
import {dateRange} from './sales.mjs';
export async function hqSales(db,actor,params){
 check(!actor.legacy&&actor.platform_role==='HQ','본사 관리자만 통합 매출을 볼 수 있습니다.',403,'ROLE_FORBIDDEN');
 const range=dateRange(params.get('from'),params.get('to')),filter=params.get('store')??'all';
 check(filter==='all'||/^[1-9]\d*$/.test(filter),'매장을 확인해 주세요.');
 const id=filter==='all'?null:Number(filter);check(id===null||Number.isSafeInteger(id),'매장을 확인해 주세요.');
 if(id!==null)check(await db.prepare('SELECT id FROM store WHERE id=?').bind(id).first(),'매장을 찾을 수 없습니다.',404);
 const scope=id===null?'':' AND o.store_id=?',args=[range.start,range.end,...(id===null?[]:[id])];
 const events=`WITH events AS (
 SELECT o.id,o.store_id,o.total,p.created_at AS stamp,1 AS direction FROM orders o JOIN payment p ON p.order_id=o.id AND p.status='SUCCESS'
 WHERE p.mode IN ('demo','toss_test') AND p.created_at>=? AND p.created_at<?${scope}
 UNION ALL SELECT o.id,o.store_id,o.total,o.cancelled_at AS stamp,-1 AS direction FROM orders o JOIN payment p ON p.order_id=o.id AND p.status='SUCCESS'
 WHERE p.mode IN ('demo','toss_test') AND o.cancelled_at>=? AND o.cancelled_at<?${scope})`;
 const metrics=`coalesce(sum(CASE WHEN direction=1 THEN total ELSE 0 END),0) AS approved,
 coalesce(sum(CASE WHEN direction=-1 THEN total ELSE 0 END),0) AS cancelled,
 coalesce(sum(total*direction),0) AS net,coalesce(sum(direction=1),0) AS orders,coalesce(sum(direction=-1),0) AS cancellations`;
 const query=sql=>db.prepare(events+sql).bind(...args,...args);
 const result=await db.batch([
  query(` SELECT ${metrics} FROM events`),
  query(` SELECT date(stamp,'+9 hours') AS date,${metrics} FROM events GROUP BY date ORDER BY date`),
  query(` SELECT s.id,s.name,s.enabled,${metrics} FROM store s LEFT JOIN events e ON e.store_id=s.id ${id===null?'':'WHERE s.id='+id} GROUP BY s.id ORDER BY net DESC,s.id`),
  query(`, lines AS (SELECT coalesce(mi.product_code,'MENU-'||m.id) AS code,m.id AS menu_id,i.name,e.direction,i.quantity,
   i.quantity*(i.price+coalesce((SELECT sum(x.option_price) FROM order_item_option x WHERE x.item_id=i.id),0)+
    coalesce((SELECT sum(json_extract(j.value,'$.option_price')) FROM json_each(i.choice_snapshot) j),0)) AS amount
   FROM events e JOIN order_item i ON i.order_id=e.id JOIN menu m ON m.id=i.menu_id LEFT JOIN menu_identity mi ON mi.menu_id=m.id)
   SELECT code,min(menu_id) AS representative_id,coalesce(sum(CASE WHEN direction=1 THEN quantity ELSE 0 END),0) AS quantity,
   coalesce(sum(CASE WHEN direction=-1 THEN quantity ELSE 0 END),0) AS returned_quantity,sum(quantity*direction) AS net_quantity,
   sum(CASE WHEN direction=1 THEN amount ELSE 0 END) AS approved,sum(CASE WHEN direction=-1 THEN amount ELSE 0 END) AS cancelled,sum(amount*direction) AS net
   FROM lines GROUP BY code ORDER BY net_quantity DESC,net DESC,code`),
  db.prepare("SELECT m.id,m.name,coalesce(i.product_code,'MENU-'||m.id) AS code FROM menu m LEFT JOIN menu_identity i ON i.menu_id=m.id ORDER BY m.id")
 ]);
 const names=new Map();for(const m of result[4].results)if(!names.has(m.code))names.set(m.code,m.name);
 const summary=result[0].results[0],menus=result[3].results.map(m=>({...m,name:names.get(m.code)}));
 summary.quantity=menus.reduce((n,m)=>n+m.quantity,0);summary.returned_quantity=menus.reduce((n,m)=>n+m.returned_quantity,0);
 const byDate=new Map(result[1].results.map(d=>[d.date,d])),daily=[];
 for(let n=Date.parse(range.from+'T00:00:00Z');n<=Date.parse(range.to+'T00:00:00Z');n+=86400000){const date=new Date(n).toISOString().slice(0,10);daily.push(byDate.get(date)??{date,approved:0,cancelled:0,net:0,orders:0,cancellations:0});}
 return {from:range.from,to:range.to,mode:'test',timezone:'Asia/Seoul',store:filter,summary,daily,stores:result[2].results,menus};
}
