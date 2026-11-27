import {check} from './problems.mjs';
import {requireAdmin} from './admin-auth.mjs';
import {storeId} from './store-context.mjs';
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const email=value=>typeof value==='string'?value.trim().toLowerCase():'';
const validEmail=value=>value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const firebaseReady=env=>Boolean(env.FIREBASE_WEB_API_KEY&&env.FIREBASE_PROJECT_ID);
export async function legacyEnabled(db){return !(await db.prepare('SELECT legacy_disabled FROM account_policy WHERE id=1').first())?.legacy_disabled;}
export async function accountConfig(db,env){return {enabled:firebaseReady(env),legacy_enabled:await legacyEnabled(db),...(firebaseReady(env)?{apiKey:env.FIREBASE_WEB_API_KEY,projectId:env.FIREBASE_PROJECT_ID}:{})};}

// Firebase validates the token signature; lookup also gives current revocation/disabled state.
// Never authorize a decoded browser token without this successful provider request.
export async function verifyIdentity(env,token){
 check(firebaseReady(env),'이메일 로그인 연결을 준비 중입니다.',503,'AUTH_NOT_CONFIGURED');
 check(typeof token==='string'&&token.length<8192&&token.split('.').length===3,'다시 로그인해 주세요.',401,'AUTH_REQUIRED');
 let response,body;
 try{response=await (env.AUTH_FETCH??fetch)('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+encodeURIComponent(env.FIREBASE_WEB_API_KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:token}),signal:AbortSignal.timeout(10000)});body=await response.json();}
 catch{check(false,'인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',503,'AUTH_UNAVAILABLE');}
 check(response.ok&&body.users?.length===1,'로그인이 만료되었거나 계정이 변경되었습니다. 다시 로그인해 주세요.',401,'AUTH_REQUIRED');
 const user=body.users[0];let claims;
 try{claims=JSON.parse(atob(token.split('.')[1].replaceAll('-','+').replaceAll('_','/')));}catch{check(false,'다시 로그인해 주세요.',401,'AUTH_REQUIRED');}
 check(claims.aud===env.FIREBASE_PROJECT_ID&&claims.iss==='https://securetoken.google.com/'+env.FIREBASE_PROJECT_ID&&claims.sub===user.localId&&Number.isFinite(claims.exp)&&claims.exp>Date.now()/1000&&Number.isFinite(claims.auth_time)&&claims.auth_time>=Number(user.validSince??0)&&!user.disabled,'로그인이 만료되었거나 계정이 변경되었습니다.',401,'AUTH_REQUIRED');
 check(user.emailVerified===true&&validEmail(email(user.email)),'이메일 인증 후 다시 로그인해 주세요.',403,'EMAIL_UNVERIFIED');
 return {uid:user.localId,email:email(user.email)};
}
export function bearer(request){return (request.headers.get('Authorization')??'').replace(/^Bearer /,'');}
async function accountIdentity(db,env,request){
 const identity=await verifyIdentity(env,bearer(request));
 let account=await stmt(db,'SELECT * FROM staff_account WHERE uid=?',identity.uid).first();
 const pending=await stmt(db,'SELECT id FROM store_invitation WHERE email=? AND revoked=0 AND accepted_uid IS NULL AND expires>?',identity.email,Date.now()).first();
 check(account||pending,'연결된 매장이 없습니다. 점주 또는 본사에 계정 등록을 요청해 주세요.',403,'NO_MEMBERSHIP');
 check(!account||account.enabled===1,'사용이 중지된 계정입니다.',403,'ACCOUNT_DISABLED');
 await db.batch([
  stmt(db,'INSERT OR IGNORE INTO staff_account(uid,email) VALUES(?,?)',identity.uid,identity.email),
  stmt(db,'UPDATE staff_account SET email=? WHERE uid=?',identity.email,identity.uid),
  stmt(db,`INSERT OR IGNORE INTO store_member(store_id,uid,role)
   SELECT store_id,?,role FROM store_invitation WHERE email=? AND revoked=0 AND accepted_uid IS NULL AND expires>? ORDER BY created_at`,identity.uid,identity.email,Date.now()),
  stmt(db,'UPDATE store_invitation SET accepted_uid=? WHERE email=? AND revoked=0 AND accepted_uid IS NULL AND expires>?',identity.uid,identity.email,Date.now())
 ]);
 account=await stmt(db,'SELECT * FROM staff_account WHERE uid=?',identity.uid).first();return {...account,legacy:false};
}
export async function principal(db,env,request){
 if(bearer(request).split('.').length===3)return accountIdentity(db,env,request);
 check(await legacyEnabled(db),'이메일 계정으로 로그인해 주세요.',401,'ACCOUNT_LOGIN_REQUIRED');
 const digest=await requireAdmin(db,request);return {uid:'legacy',legacy:true,digest,platform_role:'USER'};
}
export async function accountInfo(db,actor){
 const stores=actor.legacy?{results:[{id:1,name:(await db.prepare('SELECT name FROM store WHERE id=1').first()).name,role:'OWNER'}]}:
  actor.platform_role==='HQ'?await db.prepare("SELECT id,name,address_pending,'HQ' AS role FROM store WHERE enabled=1 ORDER BY id").all():
  await stmt(db,`SELECT s.id,s.name,s.address_pending,m.role FROM store s JOIN store_member m ON m.store_id=s.id WHERE m.uid=? AND m.enabled=1 AND s.enabled=1 ORDER BY s.id`,actor.uid).all();
 return {uid:actor.uid,email:actor.email??null,legacy:actor.legacy,platform_role:actor.platform_role,stores:stores.results};
}
export async function authorizeStore(db,actor){
 if(actor.legacy){check(storeId(db)===1,'이 매장에 접근할 권한이 없습니다.',403,'STORE_FORBIDDEN');return 'OWNER';}
 if(actor.platform_role==='HQ')return 'OWNER';
 const member=await stmt(db,'SELECT role FROM store_member WHERE store_id=? AND uid=? AND enabled=1',storeId(db),actor.uid).first();
 check(member,'이 매장에 접근할 권한이 없습니다.',403,'STORE_FORBIDDEN');return member.role;
}
export async function claimAccount(db,env,request,body){
 check(storeId(db)===1&&await legacyEnabled(db),'이미 이메일 계정으로 전환한 매장입니다.',409,'ALREADY_CLAIMED');
 await requireAdmin(db,request);
 const user=await verifyIdentity(env,body.id_token);
 check(validEmail(email(env.KIOSK_OWNER_EMAIL))&&user.email===email(env.KIOSK_OWNER_EMAIL),'지정된 최초 점주 이메일로 로그인해 주세요.',403,'OWNER_EMAIL_REQUIRED');
 const enabled='(SELECT legacy_disabled FROM account_policy WHERE id=1)=0';
 const result=await db.batch([
  stmt(db,`INSERT INTO staff_account(uid,email,platform_role) SELECT ?,?,'HQ' WHERE ${enabled} ON CONFLICT(uid) DO UPDATE SET email=excluded.email,platform_role='HQ',enabled=1`,user.uid,user.email),
  stmt(db,`INSERT INTO store_member(store_id,uid,role) SELECT 1,?,'OWNER' WHERE ${enabled} ON CONFLICT(store_id,uid) DO UPDATE SET role='OWNER',enabled=1,revision=revision+1`,user.uid),
  stmt(db,`INSERT INTO account_audit(store_id,actor,action,target) SELECT 1,?,'CLAIM',? WHERE ${enabled}`,user.uid,user.uid),
  db.prepare('UPDATE account_policy SET legacy_disabled=1 WHERE id=1 AND legacy_disabled=0'),
  db.prepare('DELETE FROM admin_session WHERE (SELECT legacy_disabled FROM account_policy WHERE id=1)=1')
 ]);
 check(result[3].meta.changes===1,'이미 다른 계정에서 연결했습니다.',409,'ALREADY_CLAIMED');return {ok:true};
}
export async function listMembers(db){
 const [members,invitations]=await db.batch([
  stmt(db,`SELECT a.uid,a.email,m.role,m.enabled,m.revision FROM store_member m JOIN staff_account a ON a.uid=m.uid WHERE m.store_id=? ORDER BY a.email`,storeId(db)),
  stmt(db,`SELECT id,email,role,expires FROM store_invitation WHERE store_id=? AND accepted_uid IS NULL AND revoked=0 AND expires>? ORDER BY created_at`,storeId(db),Date.now())
 ]);return {members:members.results,invitations:invitations.results};
}
export async function inviteMember(db,actor,body){
 const address=email(body.email);check(validEmail(address)&&['OWNER','STAFF'].includes(body.role),'이메일과 권한을 확인해 주세요.');
 const existing=await stmt(db,`SELECT 1 FROM store_member m JOIN staff_account a ON a.uid=m.uid WHERE m.store_id=? AND lower(a.email)=?`,storeId(db),address).first();
 check(!existing,'이미 등록된 계정입니다. 목록에서 권한과 사용 상태를 변경해 주세요.',409,'MEMBER_EXISTS');
 const id=crypto.randomUUID(),expires=Date.now()+7*86400000;
 await db.batch([
  stmt(db,'UPDATE store_invitation SET revoked=1 WHERE store_id=? AND email=? AND accepted_uid IS NULL',storeId(db),address),
  stmt(db,'INSERT INTO store_invitation(id,store_id,email,role,created_by,expires) VALUES(?,?,?,?,?,?)',id,storeId(db),address,body.role,actor.uid,expires),
  stmt(db,"INSERT INTO account_audit(store_id,actor,action,target) VALUES(?,?,'INVITE',?)",storeId(db),actor.uid,address)
 ]);return {ok:true};
}
export async function changeMember(db,actor,body){
 check(typeof body.uid==='string'&&['OWNER','STAFF'].includes(body.role)&&typeof body.enabled==='boolean'&&Number.isSafeInteger(body.revision),'계정과 권한을 확인해 주세요.');
 const result=await stmt(db,`UPDATE store_member SET role=?,enabled=?,revision=revision+1 WHERE store_id=? AND uid=? AND revision=?
  AND (role!='OWNER' OR enabled=0 OR (?='OWNER' AND ?=1) OR EXISTS(SELECT 1 FROM store_member other WHERE other.store_id=store_member.store_id AND other.uid!=store_member.uid AND other.role='OWNER' AND other.enabled=1))`,body.role,Number(body.enabled),storeId(db),body.uid,body.revision,body.role,Number(body.enabled)).run();
 check(result.meta.changes===1,'마지막 점주는 해제할 수 없거나 계정 상태가 변경되었습니다. 목록을 새로 확인해 주세요.',409,'MEMBER_CHANGED');
 await stmt(db,"INSERT INTO account_audit(store_id,actor,action,target) VALUES(?,?,'MEMBER_CHANGE',?)",storeId(db),actor.uid,body.uid).run();return {ok:true};
}
export async function revokeInvitation(db,actor,body){
 check(typeof body.id==='string','등록 정보를 확인해 주세요.');
 await stmt(db,'UPDATE store_invitation SET revoked=1 WHERE id=? AND store_id=? AND accepted_uid IS NULL',body.id,storeId(db)).run();return {ok:true};
}
export {openFranchise as createStore} from './franchise.mjs';
