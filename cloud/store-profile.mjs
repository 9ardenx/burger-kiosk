import {check} from './problems.mjs';
import {storeId} from './store-context.mjs';
import {suggestStoreName} from '../docs/assets/store-naming.js';
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const clean=(value,max)=>{check(typeof value==='string'&&value.length<=max&&!/[\x00-\x1f]/.test(value),'주소 입력값을 확인해 주세요.');return value.normalize('NFC').trim();};
export function addressInput(body){
 const address=clean(body.address??'',200),detail=clean(body.address_detail??'',100),locality=clean(body.locality??'',31);
 check(address.length>=8,'시·군·구와 도로명 또는 지번을 포함한 매장 주소를 입력해 주세요.');
 const suggestion=suggestStoreName(address,locality);
 check(suggestion&&suggestion.length<=45,'점포명 생성을 위해 주소의 시·구와 읍·면·동을 확인해 주세요. 도로명 주소에 동 이름이 없으면 읍·면·동 칸에 입력해 주세요.');
 return {address,detail,locality,suggestion};
}
// Executed inside the writing SQL statement/transaction, including racing requests.
// Existing names (even pre-migration duplicates) are reserved without renaming them.
export function uniqueNameSql(){return `(WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<=(SELECT count(*)+1 FROM store)),
 candidates AS (SELECT n,CASE WHEN n=1 THEN ? ELSE ?||n||'점' END AS value FROM seq)
 SELECT value FROM candidates WHERE NOT EXISTS(SELECT 1 FROM store WHERE name=value AND id!=?) ORDER BY n LIMIT 1)`;}
export const nameArgs=(name,except=0)=>[name,name.replace(/점$/,''),except];
export async function storeProfile(db){return {store:await stmt(db,'SELECT id,name,address,address_detail,locality,address_pending,profile_revision FROM store WHERE id=?',storeId(db)).first()};}
export async function saveStoreProfile(db,actor,body){
 const old=(await storeProfile(db)).store,loc=addressInput(body);
 check(Number.isSafeInteger(body.revision)&&body.revision>=0,'매장 정보를 다시 불러와 주세요.');
 check(body.auto_name===undefined||typeof body.auto_name==='boolean','이름 생성 설정을 확인해 주세요.');
 const manual=typeof body.name==='string'?body.name.trim():'';
 check(!manual||actor.platform_role==='HQ','점포명 직접 변경은 본사에서 할 수 있습니다.',403);
 check(manual.length<=45,'점포명은 45자 이내로 입력해 주세요.');
 const rename=!!old.address_pending||body.auto_name===true||!!manual,name=manual||loc.suggestion;
 const result=await stmt(db,`UPDATE store SET name=${rename?uniqueNameSql():'name'},address=?,address_detail=?,locality=?,address_pending=0,profile_revision=profile_revision+1 WHERE id=? AND profile_revision=?`,
  ...(rename?nameArgs(name,old.id):[]),loc.address,loc.detail,loc.locality,old.id,body.revision).run();
 check(result.meta.changes===1,'다른 관리자가 매장 정보를 변경했습니다. 최신 내용을 불러온 뒤 다시 저장해 주세요.',409,'STORE_PROFILE_CHANGED');
 return storeProfile(db);
}
