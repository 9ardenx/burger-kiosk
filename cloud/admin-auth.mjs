import {check} from './problems.mjs';
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args),utf8=new TextEncoder();
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
export const sha=async value=>hex(await crypto.subtle.digest('SHA-256',utf8.encode(value)));
const randomHex=length=>hex(crypto.getRandomValues(new Uint8Array(length)));
function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
const defaults={password_hash:null,salt:null,iterations:100000,revision:0,recovery_hash:null,changed_at:null};
export async function authState(db){return await db.prepare('SELECT * FROM admin_auth WHERE id=1').first()||defaults;}
async function derive(password,salt,iterations=100000){
  const key=await crypto.subtle.importKey('raw',utf8.encode(password),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:utf8.encode(salt),iterations},key,256));
}
async function matches(state,password,bootstrap){
  if(typeof password!=='string'||password.length>256)return false;
  if(state.password_hash)return equal(await derive(password.normalize('NFC'),state.salt,state.iterations),state.password_hash);
  return equal(await sha(password),bootstrap);
}
function newPassword(body){
  const password=body.new_password;
  check(typeof password==='string'&&[...password].length>=12&&[...password].length<=128&&password.trim(),'새 암호를 12~128자로 입력해 주세요.');
  check(typeof body.confirm_password==='string'&&password.normalize('NFC')===body.confirm_password.normalize('NFC'),'새 암호와 확인 값이 일치하지 않습니다.');
  return password.normalize('NFC');
}
async function limit(db,request,group){
  const key=await sha(group+'/'+(request.headers.get('CF-Connecting-IP')||'unknown')),now=Date.now(),until=now+600000;
  const results=await db.batch([
    stmt(db,'DELETE FROM auth_attempt WHERE expires<?',now),
    stmt(db,'INSERT OR IGNORE INTO auth_attempt(key,count,expires) VALUES(?,0,?)',key,until),
    stmt(db,'UPDATE auth_attempt SET count=count+1 WHERE key=?',key),
    stmt(db,'SELECT count FROM auth_attempt WHERE key=?',key)
  ]);
  check(results[3].results[0].count<=10,'인증 시도가 너무 많습니다. 10분 후 다시 시도해 주세요.',429,'AUTH_RATE_LIMIT');
  return key;
}
async function clearLimit(db,key){await stmt(db,'DELETE FROM auth_attempt WHERE key=?',key).run();}
async function ensureRow(db){await db.prepare('INSERT OR IGNORE INTO admin_auth(id) VALUES(1)').run();}
export async function loginAdmin(db,env,request,body){
  const key=await limit(db,request,'login'),state=await authState(db);
  check(state.password_hash||env.KIOSK_ADMIN_HASH,'관리자 인증 설정을 확인해 주세요.',503);
  check(await matches(state,body.password,env.KIOSK_ADMIN_HASH),'관리자 암호를 확인해 주세요.',401,'WRONG_PASSWORD');
  const token=randomHex(32);
  const results=await db.batch([
    stmt(db,'DELETE FROM admin_session WHERE expires<=?',Date.now()),
    stmt(db,`INSERT INTO admin_session(digest,expires,auth_revision) SELECT ?,?,? WHERE
      COALESCE((SELECT revision FROM admin_auth WHERE id=1),0)=?`,await sha(token),Date.now()+8*3600000,state.revision,state.revision)
  ]);
  check(results[1].meta.changes===1,'암호가 변경되었습니다. 다시 로그인해 주세요.',401);
  await clearLimit(db,key);return {ok:true,token};
}
export async function requireAdmin(db,request){
  const token=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');
  check(/^[A-Za-z0-9_-]{16,80}$/.test(token),'관리자 로그인이 필요합니다.',401);
  const hash=await sha(token);
  check(await stmt(db,`SELECT 1 FROM admin_session WHERE digest=? AND expires>? AND auth_revision=
    COALESCE((SELECT revision FROM admin_auth WHERE id=1),0)`,hash,Date.now()).first(),'관리자 로그인이 필요합니다.',401);
  return hash;
}
export async function securityInfo(db){const state=await authState(db);return {recovery_ready:Boolean(state.recovery_hash),changed_at:state.changed_at};}
export async function changePassword(db,env,request,body){
  const key=await limit(db,request,'security'),password=newPassword(body),state=await authState(db);
  check(await matches(state,body.current_password,env.KIOSK_ADMIN_HASH),'현재 암호를 확인해 주세요.',400,'WRONG_PASSWORD');
  check(!await matches(state,password,env.KIOSK_ADMIN_HASH),'현재 암호와 다른 새 암호를 입력해 주세요.');
  const salt=randomHex(16),hash=await derive(password,salt);await ensureRow(db);
  const results=await db.batch([
    stmt(db,`UPDATE admin_auth SET password_hash=?,salt=?,iterations=100000,revision=revision+1,recovery_hash=NULL,changed_at=CURRENT_TIMESTAMP
      WHERE id=1 AND revision=?`,hash,salt,state.revision),
    db.prepare('DELETE FROM admin_session WHERE auth_revision!=(SELECT revision FROM admin_auth WHERE id=1)')
  ]);
  check(results[0].meta.changes===1,'암호 설정이 변경되었습니다. 다시 로그인해 주세요.',409,'AUTH_CHANGED');
  await clearLimit(db,key);return {ok:true};
}
export async function issueRecovery(db,env,request,body){
  const key=await limit(db,request,'security'),state=await authState(db);
  check(await matches(state,body.current_password,env.KIOSK_ADMIN_HASH),'현재 암호를 확인해 주세요.',400,'WRONG_PASSWORD');
  const code=randomHex(32),hash=await sha(code);await ensureRow(db);
  const result=await stmt(db,'UPDATE admin_auth SET recovery_hash=? WHERE id=1 AND revision=? AND recovery_hash IS ?',hash,state.revision,state.recovery_hash).run();
  check(result.meta.changes===1,'인증 설정이 변경되었습니다. 다시 확인해 주세요.',409,'AUTH_CHANGED');
  await clearLimit(db,key);return {code:code.match(/.{1,8}/g).join('-')};
}
export async function resetPassword(db,request,body){
  const key=await limit(db,request,'reset'),password=newPassword(body),state=await authState(db);
  const code=typeof body.recovery_code==='string'?body.recovery_code.replace(/[\s-]/g,'').toLowerCase():'';
  check(/^[a-f0-9]{64}$/.test(code)&&equal(await sha(code),state.recovery_hash),'복구 코드를 확인해 주세요.',400,'WRONG_RECOVERY');
  const salt=randomHex(16),hash=await derive(password,salt);
  const results=await db.batch([
    stmt(db,`UPDATE admin_auth SET password_hash=?,salt=?,iterations=100000,revision=revision+1,recovery_hash=NULL,changed_at=CURRENT_TIMESTAMP
      WHERE id=1 AND revision=? AND recovery_hash=?`,hash,salt,state.revision,state.recovery_hash),
    db.prepare('DELETE FROM admin_session WHERE auth_revision!=(SELECT revision FROM admin_auth WHERE id=1)')
  ]);
  check(results[0].meta.changes===1,'복구 코드가 이미 사용되었거나 변경되었습니다.',409,'RECOVERY_USED');
  await clearLimit(db,key);return {ok:true};
}
