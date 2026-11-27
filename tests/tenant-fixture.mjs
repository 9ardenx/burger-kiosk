import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup} from './cloud-fixture.mjs';
export async function tenantFixture(t){
 const f=await setup(t),{env,sqlite}=f,registry=new Map();
 env.FIREBASE_WEB_API_KEY='test-only-key';env.FIREBASE_PROJECT_ID='isolated-test';env.KIOSK_OWNER_EMAIL='primary@example.test';
 env.AUTH_FETCH=async(url,options)=>{assert.ok(url.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='));const token=JSON.parse(options.body).idToken,user=registry.get(token);return Response.json(user?{users:[user]}:{error:{message:'INVALID_ID_TOKEN'}},{status:user?200:400});};
 const identity=(uid,address,claims={},provider={})=>{
  const payload={sub:uid,aud:env.FIREBASE_PROJECT_ID,iss:'https://securetoken.google.com/'+env.FIREBASE_PROJECT_ID,auth_time:Math.floor(Date.now()/1000)-10,exp:Math.floor(Date.now()/1000)+3600,...claims};
  const token=Buffer.from('{"alg":"RS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.'+randomUUID();
  registry.set(token,{localId:uid,email:address,emailVerified:true,validSince:'0',disabled:false,...provider});return token;
 };
 sqlite.exec("INSERT INTO store(id,name) VALUES(2,'임시 B매장')");
 const add=(uid,email,store,role='OWNER',hq=false)=>{sqlite.prepare('INSERT INTO staff_account(uid,email,platform_role) VALUES(?,?,?)').run(uid,email,hq?'HQ':'USER');sqlite.prepare('INSERT INTO store_member(store_id,uid,role) VALUES(?,?,?)').run(store,uid,role);return identity(uid,email);};
 const a=add('owner-a','a@example.test',1),b=add('owner-b','b@example.test',2),staff=add('staff-b','staff@example.test',2,'STAFF'),hq=add('head','head@example.test',1,'OWNER',true);
 const call=(token,store,path,body,customer='test-shared-customer-0001')=>f.call(path,body,customer,true,store,token);
 const entry={key:randomUUID(),name:'B매장 버거',description:'B 전용',category:'burger',base_price:7000,is_sold_out:false,options:[],choice_groups:[]};
 const created=await call(b,2,'/api/admin/menu',entry);assert.equal(created.status,200,JSON.stringify(created.data));
 return {...f,identity,registry,a,b,staff,hq,callTenant:call,bMenu:created.data.id};
}
