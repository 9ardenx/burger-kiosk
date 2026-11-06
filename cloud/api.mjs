const FRONTEND = "https://9ardenx.github.io";
const NEXT = Object.freeze({PAID:"PREPARING", PREPARING:"READY", READY:"COMPLETED"});
const utf8 = new TextEncoder();

class Problem extends Error {
  constructor(message, status=400, code="INVALID_INPUT") {
    super(message);
    this.status=status;
    this.code=code;
  }
}
function check(condition, message, status=400, code="INVALID_INPUT") {
  if (!condition) throw new Problem(message, status, code);
}
function validKey(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,80}$/.test(value);
}
async function digest(value) {
  const hash = await crypto.subtle.digest("SHA-256", utf8.encode(value));
  return Array.from(new Uint8Array(hash), byte=>byte.toString(16).padStart(2,"0")).join("");
}
const statement = (db, sql, ...args) => db.prepare(sql).bind(...args);
const all = async (db, sql, ...args) => (await statement(db,sql,...args).all()).results;

async function catalog(db, includeSold=false) {
  if (!await db.prepare("SELECT id FROM menu LIMIT 1").first()) {
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO menu(id,name,description,kind,base_price) VALUES
        (1,'클래식버거','그릴드 비프 패티, 토마토, 양상추','classic',5500),
        (2,'치킨버거','크리스피 치킨 패티, 양상추, 마요 소스','chicken',6000)`),
      db.prepare(`INSERT OR IGNORE INTO menu_option(id,menu_id,name,extra_price) VALUES
        (1,1,'치즈 추가',500),(2,1,'패티 추가',1800),(3,2,'치즈 추가',500),(4,2,'매콤 소스 추가',300)`)
    ]);
  }
  const [menus,options]=await db.batch([
    db.prepare("SELECT * FROM menu " + (includeSold?"":"WHERE is_sold_out=0 ") + "ORDER BY id"),
    db.prepare("SELECT * FROM menu_option ORDER BY id")
  ]);
  return menus.results.map(menu=>({...menu, options:options.results.filter(o=>o.menu_id===menu.id)}));
}

const orderSelect = `SELECT o.id,o.number,o.status,o.total,o.created_at,
  (SELECT json_group_array(json_object('name',i.name,'quantity',i.quantity,'price',i.price,
    'options',json((SELECT json_group_array(json_object('name',x.name,'option_price',x.option_price))
      FROM order_item_option x WHERE x.item_id=i.id)))) FROM order_item i WHERE i.order_id=o.id) AS items,
  (SELECT json_object('id',p.id,'status',p.status,'mode',p.mode) FROM payment p
     WHERE p.order_id=o.id ORDER BY p.rowid DESC LIMIT 1) AS payment FROM orders o`;
function toView(row) {
  return {...row,items:JSON.parse(row.items),payment:row.payment?JSON.parse(row.payment):null};
}
async function readOrder(db,id,customer) {
  const row=await statement(db,orderSelect+" WHERE o.id=? AND o.customer=?",id,customer).first();
  check(row,"주문을 찾을 수 없습니다.",404);
  return toView(row);
}
async function createOrder(db,customer,body) {
  const cart=body.items;
  check(validKey(body.key) && Array.isArray(cart) && cart.length>=1 && cart.length<=50,"장바구니 구성을 확인해 주세요.");
  const id=(await digest(customer+"/"+body.key)).slice(0,32);
  const signature=await digest(JSON.stringify(cart));
  const previous=await statement(db,"SELECT signature FROM orders WHERE id=?",id).first();
  if(previous){
    check(previous.signature===signature,"이미 사용된 주문 요청입니다.",409);
    return readOrder(db,id,customer);
  }
  const menus=await catalog(db,true);
  let total=0;
  const lines=cart.map(line=>{
    check(line && Number.isInteger(line.quantity) && line.quantity>=1 && line.quantity<=99,"수량을 확인해 주세요.");
    const menu=menus.find(m=>m.id===line.menu_id);
    check(menu && !menu.is_sold_out,`${menu?.name || "메뉴"} 품절 · 장바구니를 수정해 주세요.`,409,"CART_CHANGED");
    check(Array.isArray(line.options) && line.options.length<=20 &&
          new Set(line.options).size===line.options.length,"옵션을 확인해 주세요.");
    const options=line.options.map(id=>menu.options.find(o=>o.id===id));
    check(options.every(Boolean),"해당 메뉴의 옵션을 선택해 주세요.");
    const unit=menu.base_price+options.reduce((n,o)=>n+o.extra_price,0);
    check(line.expected_unit===unit,`${menu.name} 가격이 변경되었습니다. 새 금액을 확인해 주세요.`,409,"CART_CHANGED");
    total+=unit*line.quantity;
    return {menu,options,quantity:line.quantity};
  });
  const tag=crypto.randomUUID();
  const menuVersions=[...new Map(lines.map(l=>[l.menu.id,l.menu.version]))];
  const versionChecks=menuVersions.map(()=>"(id=? AND version=?)").join(" OR ");
  const commands=[statement(db,`INSERT OR IGNORE INTO orders(id,customer,signature,total,creation_tag)
    SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM menu WHERE is_sold_out=0 AND (${versionChecks}))=?`,
    id,customer,signature,total,tag,...menuVersions.flat(),menuVersions.length)];
  // A retried or concurrent request can write items only if it created this order.
  const created="EXISTS(SELECT 1 FROM orders WHERE id=? AND creation_tag=?)";
  for(const line of lines){
    const itemId=crypto.randomUUID();
    commands.push(statement(db,`INSERT INTO order_item(id,order_id,menu_id,name,quantity,price)
      SELECT ?,?,?,?,?,? WHERE ${created}`,itemId,id,line.menu.id,line.menu.name,line.quantity,line.menu.base_price,id,tag));
    for(const opt of line.options) commands.push(statement(db,`INSERT INTO order_item_option(id,item_id,option_id,name,option_price)
      SELECT ?,?,?,?,? WHERE ${created}`,crypto.randomUUID(),itemId,opt.id,opt.name,opt.extra_price,id,tag));
  }
  await db.batch(commands);
  const stored=await statement(db,"SELECT signature FROM orders WHERE id=?",id).first();
  check(stored,"판매 정보가 변경되었습니다. 장바구니를 확인해 주세요.",409,"CART_CHANGED");
  check(stored.signature===signature,"이미 사용된 주문 요청입니다.",409);
  return readOrder(db,id,customer);
}

async function attempt(db,customer,id,body) {
  check(validKey(body.key) && ["success","failure"].includes(body.demo_result),"모의 승인 결과를 확인해 주세요.");
  const ticket=(await digest(id+"/"+body.key)).slice(0,32);
  const outcome=body.demo_result==="success"?"SUCCESS":"FAILED";
  // The approval and the visible pickup number are committed together.
  const changes=await db.batch([
    statement(db,`INSERT OR IGNORE INTO payment(id,order_id,amount,status)
      SELECT ?,o.id,o.total,? FROM orders o WHERE o.id=? AND o.customer=? AND o.status='PENDING_PAYMENT'
      AND NOT EXISTS(SELECT 1 FROM order_item i JOIN menu m ON m.id=i.menu_id WHERE i.order_id=o.id AND m.is_sold_out=1)`,
      ticket,outcome,id,customer),
    statement(db,`UPDATE orders SET status='PAID',number=(SELECT coalesce(max(number),0)+1 FROM orders)
      WHERE id=? AND customer=? AND status='PENDING_PAYMENT'
      AND EXISTS(SELECT 1 FROM payment WHERE order_id=? AND status='SUCCESS')`,id,customer,id)
  ]);
  const order=await readOrder(db,id,customer);
  if(!changes[0].meta.changes && order.number===null) {
    const repeated=await statement(db,"SELECT id FROM payment WHERE id=?",ticket).first();
    check(repeated,"주문할 수 없는 품절 메뉴가 있습니다. 장바구니를 수정해 주세요.",409,"CART_CHANGED");
  }
  return order;
}
async function adminRoute(db,env,path,request,body) {
  if(path==="/api/admin/login" && body) {
    const password=body.password;
    check(env.KIOSK_ADMIN_HASH,"관리자 인증 설정을 확인해 주세요.",503);
    check(typeof password==="string" && password.length<150 &&
      await digest(password)===env.KIOSK_ADMIN_HASH,"관리자 암호를 확인해 주세요.",401);
    const token=crypto.randomUUID()+crypto.randomUUID();
    await db.batch([
      statement(db,"DELETE FROM admin_session WHERE expires<=?",Date.now()),
      statement(db,"INSERT INTO admin_session(digest,expires) VALUES(?,?)",await digest(token),Date.now()+8*60*60*1000)
    ]);
    return {ok:true,token};
  }
  const bearer=(request.headers.get("Authorization")||"").replace(/^Bearer /,"");
  check(validKey(bearer),"관리자 로그인이 필요합니다.",401);
  const hash=await digest(bearer);
  check(await statement(db,"SELECT 1 FROM admin_session WHERE digest=? AND expires>?",hash,Date.now()).first(),
    "관리자 로그인이 필요합니다.",401);
  if(path==="/api/admin/logout" && body){
    await statement(db,"DELETE FROM admin_session WHERE digest=?",hash).run();return {ok:true};
  }
  if(path==="/api/admin/menu" && !body)return {menu:await catalog(db,true)};
  if(path==="/api/admin/orders" && !body)
    return {orders:(await all(db,orderSelect+" WHERE o.number IS NOT NULL ORDER BY o.number DESC")).map(toView)};
  let match=path.match(/^\/api\/admin\/menu\/(\d+)$/);
  if(match && body){
    check(Number.isInteger(body.base_price) && body.base_price>=0 && body.base_price<=1_000_000 &&
      typeof body.is_sold_out==="boolean" && Number.isInteger(body.version),"가격과 판매 상태를 확인해 주세요.");
    const r=await statement(db,"UPDATE menu SET base_price=?,is_sold_out=?,version=version+1 WHERE id=? AND version=?",
      body.base_price,Number(body.is_sold_out),Number(match[1]),body.version).run();
    check(r.meta.changes===1,"메뉴가 변경되었습니다. 다시 확인해 주세요.",409,"MENU_CHANGED");return {ok:true};
  }
  match=path.match(/^\/api\/admin\/orders\/([a-f0-9]{32})$/);
  if(match && body){
    check(Object.hasOwn(NEXT,body.expected),"변경할 수 없는 주문 상태입니다.",409);
    const r=await statement(db,"UPDATE orders SET status=? WHERE id=? AND status=?",NEXT[body.expected],match[1],body.expected).run();
    check(r.meta.changes===1,"주문 상태가 변경되었습니다.",409,"ORDER_CHANGED");return {ok:true};
  }
  throw new Problem("경로를 찾을 수 없습니다.",404);
}
async function dispatch(request,env,path) {
  const db=env.DB;
  check(db,"매장 DB 연결을 확인해 주세요.",503);
  let body;
  if(request.method==="POST"){
    check(request.headers.get("Content-Type")?.startsWith("application/json"),"JSON 요청이 필요합니다.",415);
    check(Number(request.headers.get("Content-Length")||0)<=32000,"너무 큰 요청입니다.",413);
    const raw=await request.text();
    check(raw.length<=32000,"너무 큰 요청입니다.",413);
    try {body=JSON.parse(raw);}catch{throw new Problem("입력값을 읽을 수 없습니다.");}
    check(body && typeof body==="object" && !Array.isArray(body),"입력값을 확인해 주세요.");
  } else check(request.method==="GET","허용하지 않는 요청입니다.",405);
  if(path.startsWith("/api/admin/"))return adminRoute(db,env,path,request,body);
  if(path==="/api/menu" && !body)return {menu:await catalog(db),mode:"demo",clientKey:""};
  const token=request.headers.get("X-Kiosk-Session");
  check(validKey(token),"고객 세션을 확인해 주세요.",401);
  const customer=await digest(token);
  if(path==="/api/orders" && body)return createOrder(db,customer,body);
  const m=path.match(/^\/api\/orders\/([a-f0-9]{32})(\/attempts)?$/);
  if(m && m[2] && body)return attempt(db,customer,m[1],body);
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
    "Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization,X-Kiosk-Session",
    "Access-Control-Max-Age":"600"}});
  try{return Response.json(await dispatch(request,env,new URL(request.url).pathname),{headers});}
  catch(e){
    if(e instanceof Problem)return Response.json({error:e.message,code:e.code},{status:e.status,headers});
    console.error("Kiosk API database request failed",e?.name);
    return Response.json({error:"매장 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."},{status:503,headers});
  }
}
export {handleKiosk};
