import test from 'node:test';
import assert from 'node:assert/strict';
test('a late refresh cannot restore a logged-out session or overwrite a different signed-in account',async()=>{
 const oldFetch=globalThis.fetch,oldStorage=globalThis.sessionStorage,values=new Map();
 globalThis.sessionStorage={getItem:key=>values.get(key)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const account=await import('../docs/assets/account-client.js');account.configureAccountAuth({enabled:true,apiKey:'mock'});
 try{for(const newLogin of [false,true]){
  account.rememberAccount({idToken:'expired',refreshToken:'mock',expiresIn:-1});let resolve;globalThis.fetch=()=>new Promise(r=>{resolve=r;});const refreshing=account.accountToken();account.clearAccount();
  if(newLogin)account.rememberAccount({idToken:'different-account',refreshToken:'different',expiresIn:3600});
  resolve(Response.json({id_token:'old-refreshed-account',refresh_token:'mock',expires_in:3600}));await assert.rejects(refreshing,{status:401});
  assert.equal(await account.accountToken(),newLogin?'different-account':null);
 }}finally{account.clearAccount();globalThis.fetch=oldFetch;if(oldStorage===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=oldStorage;}
});
