import {franchiseStores} from './franchise.mjs';
import {accountConfig,legacyEnabled,principal,accountInfo,authorizeStore,claimAccount,listMembers,inviteMember,changeMember,revokeInvitation,createStore} from './accounts.mjs';
import {storeId,storeDb,resolveStore} from './store-context.mjs';
import {validateGroups, evaluateGroups} from "../docs/assets/choice-rules.js";
import sodaGroups from "./drink-example.json" with {type:"json"};
import {Problem,check} from './problems.mjs';
import {categoryState,saveCategories,DEFAULT_CATEGORY_JSON,categoryExists} from './categories.mjs';
import {loginAdmin,requireAdmin,securityInfo,changePassword,issueRecovery,resetPassword} from './admin-auth.mjs';
import {adState,saveAds} from './advertising.mjs';
import {inventoryState,saveInventory,checkStock} from './inventory.mjs';
import {salesReport} from './sales.mjs';
import {promotionState,savePromotions,pricedMenu} from './promotions.mjs';

const FRONTEND = "https://9ardenx.github.io";
const NEXT = Object.freeze({PAID:"PREPARING", PREPARING:"READY", READY:"COMPLETED"});
const utf8 = new TextEncoder();

function validKey(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,80}$/.test(value);
}
async function digest(value) {
  const hash = await crypto.subtle.digest("SHA-256", utf8.encode(value));
  return Array.from(new Uint8Array(hash), byte=>byte.toString(16).padStart(2,"0")).join("");
}
const statement = (db, sql, ...args) => db.prepare(sql).bind(...args);
const all = async (db, sql, ...args) => (await statement(db,sql,...args).all()).results;

async function catalog(db, includeSold=false, publicView=false) {
  if (storeId(db)===1 && !await db.prepare("SELECT id FROM menu WHERE store_id=1 LIMIT 1").first()) {
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO menu(id,name,description,kind,base_price) VALUES
        (1,'클래식버거','그릴드 비프 패티, 토마토, 양상추','classic',5500),
        (2,'치킨버거','크리스피 치킨 패티, 양상추, 마요 소스','chicken',6000)`),
      db.prepare(`INSERT OR IGNORE INTO menu(name,description,kind,category,base_price,registration_key) VALUES
        ('감자튀김','바삭하게 튀긴 감자에 소금을 살짝 더했어요.','fries','side',2000,'starter-fries-v1'),
        ('탄산음료','음료 종류와 세부 옵션을 골라 주세요.','cola','drink',1500,'starter-cola-v1')`),
      statement(db,"UPDATE menu SET choice_groups=? WHERE registration_key='starter-cola-v1' AND version=0",JSON.stringify(sodaGroups)),
      db.prepare(`INSERT OR IGNORE INTO menu_option(id,menu_id,name,extra_price) VALUES
        (1,1,'치즈 추가',500),(2,1,'패티 추가',1800),(3,2,'치즈 추가',500),(4,2,'매콤 소스 추가',300),
        (5,1,'탄산음료 감자튀김',2000),(6,2,'탄산음료 감자튀김',2000)`),
      statement(db,"UPDATE menu SET choice_groups=? WHERE id IN (1,2) AND version=0",
        JSON.stringify(sodaGroups.map(g=>({...g,when_extra:'탄산음료 감자튀김'}))))
    ]);
  }
  const [menus,options,displayOrder,stock,quotes]=await db.batch([
    db.prepare("SELECT id,name,description,kind,base_price,is_sold_out,version,category,photo_key,choice_groups FROM menu WHERE store_id="+storeId(db)+(includeSold?" ":" AND is_sold_out=0 ") + "ORDER BY id"),
    db.prepare("SELECT id,menu_id,name,extra_price FROM menu_option WHERE active=1 AND menu_id IN (SELECT id FROM menu WHERE store_id="+storeId(db)+") ORDER BY id"),
    db.prepare("SELECT menu_ids,revision FROM menu_display_order WHERE id="+storeId(db)),
    db.prepare('SELECT menu_id FROM inventory WHERE enabled=1 AND quantity=0'),
    db.prepare(`SELECT q.* FROM menu_pricing q JOIN menu m ON m.id=q.id WHERE m.store_id=${storeId(db)}`)
  ]);
  const positions=new Map(JSON.parse(displayOrder.results[0]?.menu_ids??"[]").map((id,i)=>[id,i]));
  const exhausted=new Set(stock.results.map(s=>s.menu_id));
  return menus.results.map(menu=>({...menu,stock_sold_out:exhausted.has(menu.id),
    is_sold_out:publicView?Number(Boolean(menu.is_sold_out||exhausted.has(menu.id))):menu.is_sold_out,
    choice_groups:JSON.parse(menu.choice_groups), options:options.results.filter(o=>o.menu_id===menu.id)}))
    .map(m=>publicView?pricedMenu(m,quotes.results.find(q=>q.id===m.id)):m)
    .sort((a,b)=>(positions.get(a.id)??positions.size)-(positions.get(b.id)??positions.size)||a.id-b.id);
}

const orderSelect = `SELECT o.id,o.number,CASE WHEN o.cancelled_at IS NOT NULL THEN 'CANCELLED' ELSE o.status END AS status,o.total,o.created_at,
  o.cancelled_at,o.cancelled_by,o.cancel_reason,o.dining_type,o.restock_on_cancel,
  (SELECT json_group_array(json_object('name',i.name,'quantity',i.quantity,'price',i.price,'regular_price',i.regular_price,'promotion',json(i.promotion),'variants',json(i.choice_snapshot),
    'options',json((SELECT json_group_array(json_object('name',x.name,'option_price',x.option_price))
      FROM order_item_option x WHERE x.item_id=i.id)))) FROM order_item i WHERE i.order_id=o.id) AS items,
  (SELECT json_object('id',p.id,'status',p.status,'mode',p.mode) FROM payment p
     WHERE p.order_id=o.id ORDER BY p.rowid DESC LIMIT 1) AS payment FROM orders o`;
function toView(row) {
  return {...row,items:JSON.parse(row.items).map(({variants,options,...item})=>({...item,options:[...variants,...options]})),payment:row.payment?JSON.parse(row.payment):null};
}
async function readOrder(db,id,customer) {
  const row=await statement(db,orderSelect+" WHERE o.id=? AND o.customer=? AND o.store_id=?",id,customer,storeId(db)).first();
  check(row,"주문을 찾을 수 없습니다.",404);
  return toView(row);
}
async function createOrder(db,customer,body) {
  const diningType=body.dining_type??null;
  check([null,'DINE_IN','TAKEOUT'].includes(diningType),'매장 또는 포장을 선택해 주세요.');
  const cart=body.items;
  check(validKey(body.key) && Array.isArray(cart) && cart.length>=1 && cart.length<=50,"장바구니 구성을 확인해 주세요.");
  const id=(await digest((storeId(db)===1?"":storeId(db)+"/")+customer+"/"+body.key)).slice(0,32);
  const signature=await digest(JSON.stringify(cart));
  const previous=await statement(db,"SELECT signature,dining_type FROM orders WHERE id=?",id).first();
  if(previous){
    check(previous.signature===signature&&previous.dining_type===diningType,"이미 사용된 주문 요청입니다.",409);
    return readOrder(db,id,customer);
  }
  const menus=await catalog(db,true,true);
  let total=0;
  const lines=cart.map(line=>{
    check(line && Number.isInteger(line.quantity) && line.quantity>=1 && line.quantity<=99,"수량을 확인해 주세요.");
    const menu=menus.find(m=>m.id===line.menu_id);
    check(menu && !menu.is_sold_out,`${menu?.name || "메뉴"} 품절 · 장바구니를 수정해 주세요.`,409,"CART_CHANGED");
    check(Array.isArray(line.options) && line.options.length<=20 &&
          new Set(line.options).size===line.options.length,"옵션을 확인해 주세요.");
    const options=line.options.map(id=>menu.options.find(o=>o.id===id));
    check(options.every(Boolean),"옵션이 변경되었습니다. 장바구니에서 새 구성을 확인해 주세요.",409,"CART_CHANGED");
    const selection=evaluateGroups(menu.choice_groups,line.selections??[],options.map(o=>o.name));
    check(!selection.invalid && !selection.missing.length,"음료 종류 등 필수 구성을 다시 선택해 주세요.",409,"CART_CHANGED");
    const unit=menu.base_price+selection.amount+options.reduce((n,o)=>n+o.extra_price,0);
    check(line.expected_version==null || line.expected_version===menu.version,
      `${menu.name} 메뉴 정보가 변경되었습니다. 최신 구성을 확인해 주세요.`,409,"CART_CHANGED");
    check(line.expected_unit===unit,`${menu.name} 가격이 변경되었습니다. 새 금액을 확인해 주세요.`,409,"CART_CHANGED");
    total+=unit*line.quantity;
    return {menu,options,snapshot:selection.snapshot,quantity:line.quantity};
  });
  await checkStock(db,cart);
  const tag=crypto.randomUUID();
  const menuVersions=[...new Map(lines.map(l=>[l.menu.id,[l.menu.id,l.menu.version,l.menu.base_price,l.menu.promotion?.id??'']])).values()];
  const versionChecks=menuVersions.map(()=>"(m.id=? AND m.version=? AND q.sale_price=? AND coalesce(q.promotion_id,'')=?)").join(" OR ");
  const commands=[statement(db,`INSERT OR IGNORE INTO orders(id,customer,signature,total,creation_tag,dining_type,store_id)
    SELECT ?,?,?,?,?,?,${storeId(db)} WHERE (SELECT count(*) FROM menu m JOIN menu_pricing q ON q.id=m.id WHERE m.store_id=${storeId(db)} AND m.is_sold_out=0 AND (${versionChecks}))=?`,
    id,customer,signature,total,tag,diningType,...menuVersions.flat(),menuVersions.length)];
  // A retried or concurrent request can write items only if it created this order.
  const created="EXISTS(SELECT 1 FROM orders WHERE id=? AND creation_tag=?)";
  for(const line of lines){
    const itemId=crypto.randomUUID();
    commands.push(statement(db,`INSERT INTO order_item(id,order_id,menu_id,name,quantity,price,choice_snapshot,regular_price,promotion)
      SELECT ?,?,?,?,?,?,?,?,? WHERE ${created}`,itemId,id,line.menu.id,line.menu.name,line.quantity,line.menu.base_price,JSON.stringify(line.snapshot),line.menu.original_price,line.menu.promotion?JSON.stringify(line.menu.promotion):null,id,tag));
    for(const opt of line.options) commands.push(statement(db,`INSERT INTO order_item_option(id,item_id,option_id,name,option_price)
      SELECT ?,?,?,?,? WHERE ${created}`,crypto.randomUUID(),itemId,opt.id,opt.name,opt.extra_price,id,tag));
  }
  await db.batch(commands);
  const stored=await statement(db,"SELECT signature,dining_type FROM orders WHERE id=?",id).first();
  check(stored,"판매 정보가 변경되었습니다. 장바구니를 확인해 주세요.",409,"CART_CHANGED");
  check(stored.signature===signature&&stored.dining_type===diningType,"이미 사용된 주문 요청입니다.",409);
  return readOrder(db,id,customer);
}

async function attempt(db,customer,id,body) {
  await readOrder(db,id,customer);
  check(validKey(body.key) && ["success","failure"].includes(body.demo_result),"모의 승인 결과를 확인해 주세요.");
  const ticket=(await digest(id+"/"+body.key)).slice(0,32);
  const outcome=body.demo_result==="success"?"SUCCESS":"FAILED";
  // The approval and the visible pickup number are committed together.
  const changes=await db.batch([
    statement(db,`INSERT OR IGNORE INTO payment(id,order_id,amount,status)
      SELECT ?,o.id,o.total,? FROM orders o WHERE o.id=? AND o.customer=? AND o.status='PENDING_PAYMENT' AND o.cancelled_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM order_item i JOIN menu m ON m.id=i.menu_id WHERE i.order_id=o.id AND m.is_sold_out=1)`,
      ticket,outcome,id,customer),
    statement(db,`UPDATE orders SET status='PAID',number=(SELECT coalesce(max(number),0)+1 FROM orders WHERE store_id=${storeId(db)})
      WHERE id=? AND customer=? AND status='PENDING_PAYMENT' AND cancelled_at IS NULL
      AND EXISTS(SELECT 1 FROM payment WHERE order_id=? AND status='SUCCESS')`,id,customer,id)
  ]);
  const order=await readOrder(db,id,customer);
  check(order.status!=="CANCELLED","취소한 주문입니다. 메뉴를 다시 선택해 주세요.",409,"ORDER_CANCELLED");
  if(!changes[0].meta.changes && order.number===null) {
    const repeated=await statement(db,"SELECT id FROM payment WHERE id=?",ticket).first();
    check(repeated,"주문할 수 없는 품절 메뉴가 있습니다. 장바구니를 수정해 주세요.",409,"CART_CHANGED");
  }
  return order;
}

async function cancelUnpaid(db,customer,id) {
  await readOrder(db,id,customer);
  await statement(db,`UPDATE orders SET cancelled_at=CURRENT_TIMESTAMP,cancelled_by='customer' WHERE id=? AND customer=?
    AND status='PENDING_PAYMENT' AND cancelled_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM payment WHERE order_id=? AND status IN ('PENDING','SUCCESS'))`,id,customer,id).run();
  const order=await readOrder(db,id,customer);
  check(order.status==="CANCELLED","결제가 진행 중이거나 완료된 주문입니다. 결제 결과를 먼저 확인해 주세요.",409,"PAYMENT_IN_PROGRESS");
  return order;
}

async function cancelByAdmin(db,id,body) {
  const restock=Object.hasOwn(body,'restock')?body.restock:(body.expected==='PAID');
  check(typeof restock==='boolean','재고 복원 여부를 선택해 주세요.');
  check(typeof body.reason==='string' && body.reason.trim().length>=1 && body.reason.trim().length<=200,
    '취소 사유를 1~200자로 입력해 주세요.');
  check(Object.hasOwn(NEXT,body.expected),'수령 전 주문만 직권취소할 수 있습니다.',409,'ORDER_CHANGED');
  // One conditional write arbitrates cancel vs. kitchen progression; approval history remains intact.
  const result=await statement(db,`UPDATE orders SET cancelled_at=CURRENT_TIMESTAMP,cancelled_by='admin',cancel_reason=?,restock_on_cancel=?
    WHERE id=? AND store_id=${storeId(db)} AND status=? AND cancelled_at IS NULL
    AND EXISTS(SELECT 1 FROM payment WHERE order_id=? AND status='SUCCESS' AND mode='demo')
    AND NOT EXISTS(SELECT 1 FROM payment WHERE order_id=? AND (mode!='demo' OR status='PENDING'))`,
    body.reason.trim(),Number(restock),id,body.expected,id,id).run();
  const row=await statement(db,orderSelect+' WHERE o.id=? AND o.store_id=?',id,storeId(db)).first();
  check(row,'주문을 찾을 수 없습니다.',404);
  if(result.meta.changes || (row.cancelled_at && row.cancelled_by==='admin'))return {order:toView(row)};
  check(!row.cancelled_at && row.status===body.expected,'주문 상태가 변경되었습니다. 최신 상태를 확인해 주세요.',409,'ORDER_CHANGED');
  throw new Problem('PG 결제는 환불 연동 후 취소할 수 있습니다. 현재 직권취소는 모의 결제 주문만 지원합니다.',409,'REFUND_REQUIRED');
}

async function reorderMenu(db,body) {
  const ids=body.ids;
  check(Array.isArray(ids)&&ids.length>0&&ids.every(id=>Number.isInteger(id)&&id>0)&&new Set(ids).size===ids.length&&
    Number.isInteger(body.revision)&&body.revision>=0,"메뉴 순서를 확인해 주세요.");
  const encoded=JSON.stringify(ids);
  const results=await db.batch([
    db.prepare(`INSERT OR IGNORE INTO menu_display_order(id) VALUES(${storeId(db)})`),
    statement(db,`UPDATE menu_display_order SET menu_ids=?,revision=revision+1 WHERE id=${storeId(db)} AND revision=?
      AND (SELECT count(*) FROM menu WHERE store_id=${storeId(db)})=? AND NOT EXISTS(SELECT id FROM menu WHERE store_id=${storeId(db)} AND id NOT IN (SELECT value FROM json_each(?)))`,
      encoded,body.revision,ids.length,encoded)
  ]);
  check(results[1].meta.changes===1,"메뉴 목록 또는 순서가 변경되었습니다. 최신 목록에서 다시 정렬해 주세요.",409,"MENU_ORDER_CHANGED");
  return {revision:body.revision+1};
}
function menuDefinition(body) {
  const label=(value,max,required=true)=>{
    check(typeof value==="string" && [...value.trim()].length<=max && (!required||value.trim()),"메뉴명·설명·옵션명을 확인해 주세요.");
    return value.trim();
  };
  const price=value=>{
    check(Number.isInteger(value)&&value>=0&&value<=1_000_000,"가격을 확인해 주세요.");
    return value;
  };
  check(typeof body.category==='string' && typeof body.is_sold_out==="boolean","분류와 판매 상태를 선택해 주세요.");
  check(Array.isArray(body.options)&&body.options.length<=20,"옵션은 20개까지 등록할 수 있습니다.");
  const options=body.options.map(option=>{
    check(option && typeof option==="object","옵션을 확인해 주세요.");
    const id=option.id??null;
    check(id===null || (Number.isInteger(id)&&id>0),"옵션 번호를 확인해 주세요.");
    return {id,name:label(option.name,40),extra:price(option.extra_price)};
  });
  const ids=options.filter(o=>o.id!==null).map(o=>o.id);
  check(new Set(options.map(o=>o.name)).size===options.length && new Set(ids).size===ids.length,"같은 옵션을 두 번 등록할 수 없습니다.");
  return {name:label(body.name,50),description:label(body.description??"",140,false),
    category:body.category,price:price(body.base_price),sold:Number(body.is_sold_out),options};
}
async function storePhoto(bucket, photo) {
  if(photo==null)return null;
  check(typeof photo==="string" && photo.length<=256_000,"사진이 너무 큽니다.");
  let bytes;
  try {bytes=Uint8Array.from(atob(photo),c=>c.charCodeAt(0));} catch { throw new Problem("사진 형식이 올바르지 않습니다."); }
  check(bytes.length>=5 && bytes.length<=192_000 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255 &&
    bytes.at(-2)===255 && bytes.at(-1)===217,"JPEG 사진을 다시 선택해 주세요.");
  check(bucket,"사진 저장소를 사용할 수 없습니다.",503);
  const buffer=await crypto.subtle.digest("SHA-256",bytes);
  const key=Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,"0")).join("");
  await bucket.put("menu/"+key,bytes,{httpMetadata:{contentType:"image/jpeg"}});
  return key;
}
async function saveMenu(db,env,body,id=null) {
  const entry=menuDefinition(body);
  if(id===null&&storeId(db)!==1&&validKey(body.key))body={...body,key:await digest(storeId(db)+"/"+body.key)};
  check((await categoryState(db)).items.some(c=>c.id===entry.category),'메뉴 분류가 변경되었습니다. 다시 선택해 주세요.',409,'CATEGORIES_CHANGED');
  let groups=null;
  if(Object.hasOwn(body,"choice_groups")) {
    try{groups=JSON.stringify(validateGroups(body.choice_groups,entry.options.map(o=>o.name)));}
    catch(error){throw new Problem(error.message);}
  }
  const create=id===null;
  let parent, args, final, existingPhoto=null;
  const statements=[];
  if(create) {
    check(validKey(body.key) && entry.options.every(o=>o.id===null),"등록 정보와 옵션을 확인해 주세요.");
    const prev=await statement(db,"SELECT id FROM menu WHERE registration_key=? AND store_id=?",body.key,storeId(db)).first();
    if(prev)return {id:prev.id};
    parent=`SELECT id FROM menu WHERE registration_key=? AND version=-1 AND store_id=${storeId(db)}`;
    args=[body.key];
  } else {
    check(Number.isInteger(body.version)&&body.version>=0,"메뉴 버전을 확인해 주세요.");
    const old=await statement(db,"SELECT version,photo_key,choice_groups FROM menu WHERE id=? AND store_id=?",id,storeId(db)).first();
    check(old && old.version===body.version,"메뉴가 변경되었습니다. 다시 확인해 주세요.",409,"MENU_CHANGED");
    const allowed=new Set((await all(db,"SELECT id FROM menu_option WHERE menu_id=? AND active=1",id)).map(o=>o.id));
    check(entry.options.every(o=>o.id===null || allowed.has(o.id)),"해당 메뉴의 옵션만 수정할 수 있습니다.");
    if(groups===null)check(JSON.parse(old.choice_groups).every(g=>!g.when_extra || entry.options.some(o=>o.name===g.when_extra)),
      "선택 그룹을 편집하려면 관리자 화면을 새로고침해 주세요.",409,"MENU_CHANGED");
    existingPhoto=old.photo_key;
    parent="SELECT id FROM menu WHERE id=? AND version=? AND "+categoryExists(db);
    args=[id,body.version,DEFAULT_CATEGORY_JSON,entry.category];
  }
  const photo=Object.hasOwn(body,"photo")?await storePhoto(env.BUCKET,body.photo):existingPhoto;
  if(create) {
    statements.push(statement(db,`INSERT OR IGNORE INTO menu(name,description,category,kind,base_price,is_sold_out,
      photo_key,registration_key,choice_groups,version,store_id) SELECT ?,?,?,'custom',?,?,?,?,?,-1,${storeId(db)} WHERE ${categoryExists(db)}`,
      entry.name,entry.description,entry.category,entry.price,entry.sold,photo,body.key,groups??"[]",DEFAULT_CATEGORY_JSON,entry.category));
    final=statement(db,"UPDATE menu SET version=0 WHERE registration_key=? AND version=-1 AND store_id=?",body.key,storeId(db));
  } else {
    statements.push(statement(db,`UPDATE menu_option SET active=0 WHERE menu_id=(${parent}) AND active=1`,...args));
    final=statement(db,`UPDATE menu SET name=?,description=?,category=?,base_price=?,is_sold_out=?,photo_key=?,
      choice_groups=COALESCE(?,choice_groups),version=version+1 WHERE id=? AND version=? AND ${categoryExists(db)}`,entry.name,entry.description,entry.category,entry.price,entry.sold,photo,groups,...args);
  }
  for(const option of entry.options) {
    statements.push(option.id===null
      ? statement(db,`INSERT INTO menu_option(menu_id,name,extra_price) SELECT id,?,? FROM (${parent})`,option.name,option.extra,...args)
      : statement(db,`UPDATE menu_option SET name=?,extra_price=?,active=1 WHERE id=? AND menu_id=(${parent})`,
                  option.name,option.extra,option.id,...args));
  }
  const results=await db.batch([...statements,final]);
  if(!create) {
    check(results.at(-1).meta.changes===1,"메뉴가 변경되었습니다. 다시 확인해 주세요.",409,"MENU_CHANGED");
    return {id};
  }
  const saved=await statement(db,"SELECT id FROM menu WHERE registration_key=? AND store_id=?",body.key,storeId(db)).first();
  check(saved,'메뉴 분류가 변경되었습니다. 다시 선택해 주세요.',409,'CATEGORIES_CHANGED');return saved;
}

async function adminRoute(db,env,path,request,body) {
  if(['/api/admin/login','/api/admin/reset-password'].includes(path)){check(storeId(db)===1&&await legacyEnabled(db),'이메일 계정으로 로그인해 주세요.',401,'ACCOUNT_LOGIN_REQUIRED');}
  if(path==='/api/admin/login'&&body)return loginAdmin(db,env,request,body);
  if(path==='/api/admin/reset-password'&&body)return resetPassword(db,request,body);
  if(path==='/api/admin/claim-account'&&body)return claimAccount(db,env,request,body);
  const actor=await principal(db,env,request),role=await authorizeStore(db,actor);
  if(path==='/api/admin/logout'&&body){if(actor.legacy)await statement(db,'DELETE FROM admin_session WHERE digest=?',actor.digest).run();return {ok:true};}
  if(role==='STAFF')check(path==='/api/admin/orders'&&!body||/^\/api\/admin\/orders\/[a-f0-9]{32}$/.test(path)&&body,'점주 권한이 필요한 기능입니다.',403,'ROLE_FORBIDDEN');
  if(path.startsWith('/api/admin/accounts')){
    check(!actor.legacy,'이메일 계정을 먼저 연결해 주세요.',403,'ACCOUNT_LOGIN_REQUIRED');
    if(path==='/api/admin/accounts'&&!body)return listMembers(db);
    if(path==='/api/admin/accounts/invite'&&body)return inviteMember(db,actor,body);
    if(path==='/api/admin/accounts/member'&&body)return changeMember(db,actor,body);
    if(path==='/api/admin/accounts/revoke'&&body)return revokeInvitation(db,actor,body);
  }
  if(['/api/admin/security','/api/admin/password','/api/admin/recovery-code'].includes(path))check(actor.legacy,'이메일 계정의 비밀번호 복구를 이용해 주세요.',403,'ACCOUNT_LOGIN_REQUIRED');
  if(path==='/api/admin/promotions')return body?savePromotions(db,body):promotionState(db);
  if(path==='/api/admin/sales'&&!body)return salesReport(db,new URL(request.url).searchParams);
  if(path==='/api/admin/inventory'&&!body)return inventoryState(db);
  const inventoryMatch=path.match(/^\/api\/admin\/inventory\/(\d+)$/);
  if(inventoryMatch&&body)return saveInventory(db,Number(inventoryMatch[1]),body);
  if(path==='/api/admin/ads')return body?saveAds(db,env.BUCKET,body):adState(db);
  if(path==='/api/admin/security'&&!body)return securityInfo(db);
  if(path==='/api/admin/password'&&body)return changePassword(db,env,request,body);
  if(path==='/api/admin/recovery-code'&&body)return issueRecovery(db,env,request,body);
  if(path==='/api/admin/categories')return body?saveCategories(db,body):categoryState(db);
  if(path==="/api/admin/logout" && body){
    return {ok:true};
  }
  if(path==="/api/admin/menu" && body)return saveMenu(db,env,body);
  if(path==="/api/admin/menu-order" && body)return reorderMenu(db,body);
  if(path==="/api/admin/menu" && !body){
    // A revision read before the catalog makes a concurrent reorder a safe conflict.
    const sequence=await db.prepare("SELECT revision FROM menu_display_order WHERE id="+storeId(db)).first();
    return {menu:await catalog(db,true),order_revision:sequence?.revision??0,categories:(await categoryState(db)).items};
  }
  if(path==="/api/admin/orders" && !body)
    return {orders:(await all(db,orderSelect+" WHERE o.store_id="+storeId(db)+" AND o.number IS NOT NULL ORDER BY o.number DESC")).map(toView)};
  let match=path.match(/^\/api\/admin\/menu\/(\d+)$/);
  if(match && body){
    if(Object.hasOwn(body,"name"))return saveMenu(db,env,body,Number(match[1]));
    check(Number.isInteger(body.base_price) && body.base_price>=0 && body.base_price<=1_000_000 &&
      typeof body.is_sold_out==="boolean" && Number.isInteger(body.version),"가격과 판매 상태를 확인해 주세요.");
    const r=await statement(db,"UPDATE menu SET base_price=?,is_sold_out=?,version=version+1 WHERE id=? AND version=? AND store_id=?",
      body.base_price,Number(body.is_sold_out),Number(match[1]),body.version,storeId(db)).run();
    check(r.meta.changes===1,"메뉴가 변경되었습니다. 다시 확인해 주세요.",409,"MENU_CHANGED");return {ok:true};
  }
  match=path.match(/^\/api\/admin\/orders\/([a-f0-9]{32})\/cancel$/);
  if(match && body)return cancelByAdmin(db,match[1],body);
  match=path.match(/^\/api\/admin\/orders\/([a-f0-9]{32})$/);
  if(match && body){
    check(Object.hasOwn(NEXT,body.expected),"변경할 수 없는 주문 상태입니다.",409);
    const r=await statement(db,"UPDATE orders SET status=? WHERE id=? AND status=? AND cancelled_at IS NULL AND store_id=?",NEXT[body.expected],match[1],body.expected,storeId(db)).run();
    check(r.meta.changes===1,"주문 상태가 변경되었습니다.",409,"ORDER_CHANGED");
    return {order:toView(await statement(db,orderSelect+" WHERE o.id=? AND o.store_id=?",match[1],storeId(db)).first())};
  }
  throw new Problem("경로를 찾을 수 없습니다.",404);
}
async function dispatch(request,env,path) {
  let db=env.DB;
  check(db,"매장 DB 연결을 확인해 주세요.",503);
  let body;
  if(request.method==="POST"){
    check(request.headers.get("Content-Type")?.startsWith("application/json"),"JSON 요청이 필요합니다.",415);
    const limit=path.startsWith("/api/admin/menu")||path==='/api/admin/ads'?285_000:32_000;
    check(Number(request.headers.get("Content-Length")||0)<=limit,"너무 큰 요청입니다.",413);
    const raw=await request.text();
    check(raw.length<=limit,"너무 큰 요청입니다.",413);
    try {body=JSON.parse(raw);}catch{throw new Problem("입력값을 읽을 수 없습니다.");}
    check(body && typeof body==="object" && !Array.isArray(body),"입력값을 확인해 주세요.");
  } else check(request.method==="GET","허용하지 않는 요청입니다.",405);
  if(path==='/api/auth/config'&&!body)return accountConfig(db,env);
  if(path==='/api/account'&&!body)return accountInfo(db,await principal(db,env,request));
  if(path==='/api/account/stores'){const actor=await principal(db,env,request);return body?createStore(db,actor,body):franchiseStores(db,actor);}
  const store=await resolveStore(db,request);db=storeDb(db,store.id);
  if(path.startsWith("/api/admin/"))return adminRoute(db,env,path,request,body);
  if(path==='/api/ads'&&!body)return adState(db,true);
  if(path==="/api/menu" && !body)return {store,menu:await catalog(db,true,true),categories:(await categoryState(db)).items,mode:"demo",clientKey:"",server_time:(await db.prepare("SELECT unixepoch('now')*1000 AS now").first()).now};
  const token=request.headers.get("X-Kiosk-Session");
  check(validKey(token),"고객 세션을 확인해 주세요.",401);
  const customer=await digest(token);
  if(path==="/api/orders" && body)return createOrder(db,customer,body);
  const m=path.match(/^\/api\/orders\/([a-f0-9]{32})(\/attempts|\/cancel)?$/);
  if(m && m[2]==="/cancel" && body)return cancelUnpaid(db,customer,m[1]);
  if(m && m[2]==="/attempts" && body)return attempt(db,customer,m[1],body);
  if(m && !m[2] && !body)return readOrder(db,m[1],customer);
  throw new Problem("경로를 찾을 수 없습니다.",404);
}
async function handleKiosk(request,env) {
  const origin=request.headers.get("Origin");
  const headers={"Cache-Control":"no-store","Vary":"Origin","Content-Type":"application/json; charset=utf-8"};
  if(origin && origin!==FRONTEND && origin!==new URL(request.url).origin)
    return Response.json({error:"허용되지 않은 출처입니다."},{status:403,headers});
  if(origin)headers["Access-Control-Allow-Origin"]=origin;
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{...headers,
    "Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization,X-Kiosk-Session,X-Kiosk-Store",
    "Access-Control-Max-Age":"600"}});
  try{
    const path=new URL(request.url).pathname;
    const photo=path.match(/^\/api\/(menu|ad)-photos\/([a-f0-9]{64})$/);
    if(photo && request.method==="GET"){
      const stored=await env.BUCKET.get((photo[1]==='ad'?'ads/':'menu/')+photo[2]);
      check(stored,"사진을 찾을 수 없습니다.",404);
      return new Response(stored.body,{headers:{...headers,"Content-Type":"image/jpeg",
        "Cache-Control":"public, max-age=31536000, immutable","X-Content-Type-Options":"nosniff"}});
    }
    return Response.json(await dispatch(request,env,path),{headers});
  }
  catch(e){
    if((String(e?.message)+' '+String(e?.cause?.message)).includes('PROMOTION_CHANGED'))
      return Response.json({error:'할인 시간이 지났거나 가격이 변경되었습니다. 새 금액을 확인해 주세요.',code:'CART_CHANGED'},{status:409,headers});
    if((String(e?.message)+' '+String(e?.cause?.message)).includes('STOCK_UNAVAILABLE'))
      return Response.json({error:'판매 가능 수량이 부족합니다. 최신 메뉴를 확인하고 장바구니 수량을 줄여 주세요.',code:'CART_CHANGED'},{status:409,headers});
    if(e instanceof Problem)return Response.json({error:e.message,code:e.code},{status:e.status,headers});
    console.error("Kiosk API database request failed",e?.name);
    return Response.json({error:"매장 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."},{status:503,headers});
  }
}
export {handleKiosk};
