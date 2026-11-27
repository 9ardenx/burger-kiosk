import {check} from './problems.mjs';
import {DEFAULT_CATEGORY_JSON} from './categories.mjs';
import {addressInput,uniqueNameSql,nameArgs} from './store-profile.mjs';
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const hq=actor=>check(!actor.legacy&&actor.platform_role==='HQ','본사 관리자만 가맹점을 관리할 수 있습니다.',403,'ROLE_FORBIDDEN');
export async function franchiseStores(db,actor){
 hq(actor);
 const {results}=await stmt(db,`SELECT s.id,s.name,s.template_store_id,s.address,s.address_detail,s.locality,s.address_pending,s.profile_revision,
  (SELECT count(*) FROM menu WHERE store_id=s.id) AS menu_count,
  (SELECT count(*) FROM store_member m JOIN staff_account a ON a.uid=m.uid WHERE m.store_id=s.id AND m.role='OWNER' AND m.enabled=1 AND a.enabled=1) AS owner_count,
  (SELECT count(*) FROM store_invitation i WHERE i.store_id=s.id AND i.role='OWNER' AND i.accepted_uid IS NULL AND i.revoked=0 AND i.expires>?) AS pending_owners
  FROM store s WHERE s.enabled=1 ORDER BY s.id`,Date.now()).all();
 return {stores:results};
}
export async function openFranchise(db,actor,body){
 hq(actor);
 const loc=body.address?addressInput(body):null,defer=body.address_pending===true;
 check(body.address_pending===undefined||typeof body.address_pending==='boolean','주소 등록 방법을 확인해 주세요.');
 const name=loc?(typeof body.name==='string'&&body.name.trim()||loc.suggestion):defer?'가입대기점':typeof body.name==='string'?body.name.trim():'',address=typeof body.owner_email==='string'?body.owner_email.trim().toLowerCase():'';
 check(name&&name.length<=50,'매장 이름을 1~50자로 입력해 주세요.');
 check(address.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address),'점주 이메일을 입력해 주세요.');
 check(Number.isSafeInteger(body.source_store_id)&&body.source_store_id>0,'기본 구성을 가져올 매장을 선택해 주세요.');
 check(typeof body.key==='string'&&/^[A-Za-z0-9_-]{16,80}$/.test(body.key),'가맹점 개설 화면을 새로고침해 주세요.');
 const signature=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([name,address,body.source_store_id,...(loc||defer?[loc,defer]:[])])))),b=>b.toString(16).padStart(2,'0')).join('');
 const existing=await stmt(db,'SELECT id,name,opening_signature FROM store WHERE opening_key=?',body.key).first();
 if(existing){check(existing.opening_signature===signature,'같은 요청의 개설 정보가 변경되었습니다. 목록을 확인해 주세요.',409,'OPENING_CHANGED');return {store:{id:existing.id,name:existing.name},replayed:true};}
 const source=await stmt(db,'SELECT id FROM store WHERE id=? AND enabled=1 AND EXISTS(SELECT 1 FROM menu WHERE store_id=store.id)',body.source_store_id).first();
 check(source,'메뉴가 있는 기준 매장을 선택해 주세요.',409,'TEMPLATE_UNAVAILABLE');
 const tag=crypto.randomUUID(),invitation=crypto.randomUUID(),expires=Date.now()+7*86400000;
 // Every dependent INSERT is gated by this invocation's unique tag. A racing retry
 // cannot copy a second catalog or issue a second invitation. D1 batch is atomic.
 const target='SELECT * FROM store WHERE opening_key=? AND opening_tag=?';
 const args=[body.key,tag],prefix='franchise:'+tag+':';
 await db.batch([
  stmt(db,`INSERT OR IGNORE INTO store(name,opening_key,opening_signature,opening_tag,template_store_id,address,address_detail,locality,address_pending)
   SELECT ${uniqueNameSql()},?,?,?,id,?,?,?,? FROM store WHERE id=? AND enabled=1 AND EXISTS(SELECT 1 FROM menu WHERE store_id=store.id)`,...nameArgs(name),body.key,signature,tag,loc?.address??null,loc?.detail??null,loc?.locality??null,Number(defer&&!loc),body.source_store_id),
  stmt(db,`INSERT INTO menu(name,description,kind,base_price,category,photo_key,choice_groups,registration_key,store_id)
   SELECT m.name,m.description,m.kind,m.base_price,m.category,m.photo_key,m.choice_groups,?||m.id,t.id
   FROM menu m JOIN (${target}) t ON m.store_id=t.template_store_id ORDER BY m.id`,prefix,...args),
  stmt(db,`INSERT INTO menu_identity(menu_id,product_code)
   SELECT n.id,coalesce(i.product_code,'MENU-'||m.id) FROM menu m JOIN (${target}) t ON m.store_id=t.template_store_id
   JOIN menu n ON n.store_id=t.id AND n.registration_key=?||m.id LEFT JOIN menu_identity i ON i.menu_id=m.id`,...args,prefix),
  stmt(db,`INSERT INTO menu_option(menu_id,name,extra_price,active)
   SELECT n.id,o.name,o.extra_price,1 FROM menu_option o JOIN menu m ON m.id=o.menu_id
   JOIN (${target}) t ON m.store_id=t.template_store_id
   JOIN menu n ON n.store_id=t.id AND n.registration_key=?||m.id WHERE o.active=1 ORDER BY o.id`,...args,prefix),
  stmt(db,`INSERT INTO category_catalog(id,items) SELECT t.id,coalesce(c.items,?) FROM (${target}) t LEFT JOIN category_catalog c ON c.id=t.template_store_id`,DEFAULT_CATEGORY_JSON,...args),
  stmt(db,`INSERT INTO ad_catalog(id,items) SELECT t.id,coalesce(a.items,'[]') FROM (${target}) t LEFT JOIN ad_catalog a ON a.id=t.template_store_id`,...args),
  stmt(db,`INSERT INTO menu_display_order(id,menu_ids)
   SELECT t.id,(SELECT json_group_array(id) FROM (
    SELECT n.id FROM menu m JOIN menu n ON n.store_id=t.id AND n.registration_key=?||m.id
    LEFT JOIN menu_display_order d ON d.id=t.template_store_id
    LEFT JOIN json_each(coalesce(d.menu_ids,'[]')) j ON CAST(j.value AS INTEGER)=m.id
    WHERE m.store_id=t.template_store_id ORDER BY coalesce(CAST(j.key AS INTEGER),2147483647),m.id
   )) FROM (${target}) t`,prefix,...args),
  stmt(db,`INSERT INTO store_invitation(id,store_id,email,role,created_by,expires) SELECT ?,id,?,'OWNER',?,? FROM (${target})`,invitation,address,actor.uid,expires,...args),
  stmt(db,`INSERT INTO account_audit(store_id,actor,action,target) SELECT id,?,'FRANCHISE_OPEN',? FROM (${target})`,actor.uid,JSON.stringify({source_store_id:body.source_store_id}),...args)
 ]);
 const saved=await stmt(db,'SELECT id,name,opening_signature FROM store WHERE opening_key=?',body.key).first();
 check(saved,'기준 매장이 변경되었습니다. 다시 확인해 주세요.',409,'TEMPLATE_UNAVAILABLE');
 check(saved.opening_signature===signature,'같은 요청의 개설 정보가 변경되었습니다. 목록을 확인해 주세요.',409,'OPENING_CHANGED');
 return {store:{id:saved.id,name:saved.name},replayed:false};
}
