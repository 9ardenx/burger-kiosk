import assert from 'node:assert/strict';
import {createECDH,hkdfSync,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
export function pushFixture(f){
 const vapid=createECDH('prime256v1');vapid.generateKeys();f.env.WEB_PUSH_PUBLIC_KEY=vapid.getPublicKey().toString('base64url');f.env.WEB_PUSH_PRIVATE_KEY=vapid.getPrivateKey().toString('base64url');
 const devices=new Map(),sent=[],responses=[];
 const device=(provider='fcm.googleapis.com/fcm/send')=>{const ecdh=createECDH('prime256v1');ecdh.generateKeys();const auth=randomBytes(16);const subscription={endpoint:'https://'+provider+'/'+randomUUID(),keys:{p256dh:ecdh.getPublicKey().toString('base64url'),auth:auth.toString('base64url')}};devices.set(subscription.endpoint,{ecdh,auth});return subscription;};
 f.env.PUSH_FETCH=async(endpoint,request)=>{
  assert.equal(request.redirect,'error');assert.ok(request.signal);assert.equal(request.headers['content-encoding'],'aes128gcm');
  const {ecdh,auth}=devices.get(endpoint),data=Buffer.from(request.body),salt=data.subarray(0,16),length=data[20],server=data.subarray(21,21+length),encrypted=data.subarray(21+length);
  assert.equal(data.readUInt32BE(16),4096);assert.equal(length,65);
  const shared=ecdh.computeSecret(server),ikm=hkdfSync('sha256',shared,auth,Buffer.concat([Buffer.from('WebPush: info\0'),ecdh.getPublicKey(),server]),32);
  const key=hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16),nonce=hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12);
  const decipher=createDecipheriv('aes-128-gcm',key,nonce);decipher.setAuthTag(encrypted.subarray(-16));const padded=Buffer.concat([decipher.update(encrypted.subarray(0,-16)),decipher.final()]);let end=padded.length;while(padded[end-1]===0)end--;assert.equal(padded[end-1],2);
  const message=JSON.parse(padded.subarray(0,end-1).toString());sent.push({endpoint,message,headers:request.headers});
  const status=responses.shift()??201;return new Response(null,{status});
 };
 const register=async(token,store,subscription=device())=>{const r=await f.callTenant(token,store,'/api/admin/notifications/subscribe',{subscription});assert.equal(r.status,200,JSON.stringify(r.data));return {subscription,binding:r.data};};
 const order=async(token=f.a,store=1,paid=true)=>{const r=await f.callTenant(token,store,'/api/orders',{key:randomUUID(),items:[{menu_id:store===1?1:f.bMenu,quantity:1,options:[],expected_unit:store===1?5500:7000}]});assert.equal(r.status,200);if(paid){const p=await f.callTenant(token,store,'/api/orders/'+r.data.id+'/attempts',{key:randomUUID(),demo_result:'success'});assert.equal(p.status,200,JSON.stringify(p.data));return p.data;}return r.data;};
 return {device,register,order,sent,responses};
}
