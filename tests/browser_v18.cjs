// Isolated SQLite API + mocked Firebase transport. No production writes or real mail.
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
async function main(){
 const {tenantFixture}=await import('./tenant-fixture.mjs'),{handleKiosk}=await import('../cloud/api.mjs');
 let cleanup;const f=await tenantFixture({after(fn){cleanup=fn;}}),root=path.resolve(__dirname,'..');
 const users=new Map([['a@example.test',f.a],['b@example.test',f.b],['staff@example.test',f.staff],['primary@example.test',f.identity('primary','primary@example.test')]]),mail=[],errors=[];
 let base,phase='old';const requests=[];
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');requests.push({phase,path:url.pathname,query:url.search});
   if(url.pathname.startsWith('/api/')){let bytes=[];for await(const b of req)bytes.push(b);const response=await handleKiosk(new Request(base+req.url,{method:req.method,headers:req.headers,...(req.method==='GET'?{}:{body:Buffer.concat(bytes)})}),f.env);res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(Buffer.from(await response.arrayBuffer()));}
   const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
   let content;if(phase==='old'&&/\.(js|css|html)$/.test(file)){try{content=require('node:child_process').execFileSync('git',['show','v1.7.3:docs/'+file],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']});}catch{content=fs.readFileSync(path.join(root,'docs',file));}}else content=fs.readFileSync(path.join(root,'docs',file));
   if(file==='assets/backend.js')content=content.toString().replace('https://burger-kiosk-9ardenx-api.epicowl12.chatgpt.site',base);
   res.setHeader('Cache-Control','public,max-age=600');res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(content);
  }catch(e){res.writeHead(404).end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const context=await browser.newContext();
  await context.route('https://identitytoolkit.googleapis.com/**',async route=>{
   const request=route.request(),body=request.postDataJSON(),action=new URL(request.url()).pathname.split(':')[1];
   let value,status=200;
   if(action==='sendOobCode'){mail.push(body.requestType);value={email:body.email??'test@example.test'};}
   else if(action==='signUp'){const token=f.identity('new-user',body.email,{}, {emailVerified:false});users.set(body.email,token);value={idToken:token,refreshToken:'test-refresh',expiresIn:'3600'};}
   else if(users.has(body.email)&&body.password==='test-password-long'){value={idToken:users.get(body.email),refreshToken:'test-refresh',expiresIn:'3600'};}
   else{status=400;value={error:{message:'INVALID_LOGIN_CREDENTIALS'}};}
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  });
  await context.route('https://securetoken.googleapis.com/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id_token:f.a,refresh_token:'test-refresh',expires_in:'3600'})}));
  const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(6000);
  await p.goto(base+'/admin.html?old');await p.locator('#login').waitFor();
  phase='new';await p.goto(base+'/admin.html?new');await p.locator('#email-login').waitFor();assert.ok(requests.some(r=>r.phase==='new'&&r.query==='?v=20261127-v18'&&r.path.endsWith('admin.js')));
  await p.getByRole('button',{name:'비밀번호를 잊으셨나요?'}).click();await p.locator('#email-reset [name=email]').fill('nobody@example.test');await p.locator('#email-reset button').click();await p.getByText('가입된 이메일이면 재설정 안내가 발송됩니다.',{exact:false}).waitFor();assert.deepEqual(mail,['PASSWORD_RESET']);
  await p.getByRole('button',{name:'로그인으로',exact:true}).click();await p.getByRole('button',{name:'초대받은 계정 가입'}).click();await p.locator('[name=email]').fill('new@example.test');await p.locator('[name=password]').fill('test-password-long');await p.locator('#email-signup button').click();await p.locator('#email-login').waitFor();assert.equal(mail.at(-1),'VERIFY_EMAIL');
  const login=async email=>{await p.locator('#email-login [name=email]').fill(email);await p.locator('#email-login [name=password]').fill('test-password-long');await p.locator('#email-login button').click();};
  await login('new@example.test');await p.getByText('이메일 인증 후 다시 로그인해 주세요.',{exact:true}).waitFor();await p.reload();await p.locator('#email-login').waitFor();
  await p.getByRole('button',{name:'기존 관리자 암호로 로그인'}).click();await p.locator('#login [name=password]').fill(f.password);await p.locator('#login button').click();await p.locator('[data-tab=accounts]').click();await p.locator('#claim-account [name=email]').fill('primary@example.test');await p.locator('#claim-account [name=password]').fill('test-password-long');await p.locator('#claim-account button.primary').click();await p.getByText('기존 매장을 이메일 계정에 연결했습니다.',{exact:false}).waitFor();assert.equal(f.sqlite.prepare('SELECT legacy_disabled FROM account_policy').get().legacy_disabled,1);
  await p.locator('#account-store').selectOption('2');await p.waitForURL('**store=2');await p.locator('#account-store').waitFor();assert.ok((await p.locator('.header-link').getAttribute('href')).includes('store=2'));await p.locator('[data-tab=menu]').click();await p.getByRole('heading',{name:'메뉴 관리',exact:true}).waitFor();assert.ok((await p.locator('#app').textContent()).includes('B매장 버거'));assert.ok(!(await p.locator('#app').textContent()).includes('클래식버거'));
  await p.locator('[data-tab=accounts]').click();await p.locator('#invite-account [name=email]').fill('invite@example.test');await p.locator('#invite-account button').click();await p.locator('[data-revoke-invite]').waitFor();await p.locator('[data-revoke-invite]').click();await p.locator('[data-revoke-invite]').waitFor({state:'detached'});
  for(const width of [320,390,768,1280]){await p.setViewportSize({width,height:1000});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${width}`);await p.screenshot({path:`data/qa/v1.8/accounts-${width}.png`,fullPage:true});}
  await p.locator('[data-act=logout]').click();await p.locator('#email-login').waitFor();assert.equal(await p.locator('[data-legacy-login]').count(),0);
  const order=await f.callTenant(f.b,2,'/api/orders',{key:crypto.randomUUID(),items:[{menu_id:f.bMenu,quantity:1,options:[],expected_unit:7000}]});
  await f.callTenant(f.b,2,'/api/orders/'+order.data.id+'/attempts',{key:crypto.randomUUID(),demo_result:'success'});
  await login('staff@example.test');await p.locator('#account-store').waitFor();assert.deepEqual(await p.locator('#tabs [data-tab]').evaluateAll(bs=>bs.map(b=>b.dataset.tab)),['orders']);await p.locator('[data-next]').waitFor();assert.equal(await p.locator('[data-cancel-order]').count(),0,'staff must not see an unauthorized cancellation action');await p.locator('[data-next]').click();await p.getByRole('button',{name:'준비 완료',exact:true}).waitFor();await p.locator('[data-act=logout]').click();
  // Store mismatch redirects to the account's own store. Expired browser token refreshes.
  await login('a@example.test');await p.waitForURL('**store=1');await p.locator('#account-store').waitFor();await p.evaluate(()=>{const k='burger-kiosk.account.v18',s=JSON.parse(sessionStorage.getItem(k));s.expiresAt=0;sessionStorage.setItem(k,JSON.stringify(s));});await p.reload();await p.locator('#account-store').waitFor();
  assert.deepEqual(errors,[]);fs.writeFileSync('data/qa/v1.8/browser-results.json',JSON.stringify({date:new Date().toISOString(),cacheUpgrade:true,signupVerification:true,passwordResetRequest:true,unverifiedReload:true,ownerClaim:true,storeSwitch:true,memberInviteRevoke:true,staffTabs:true,tokenRefresh:true,widths:[320,390,768,1280],errors,provider:'mock; no real mail sent'},null,2));console.log('PASS v1.8 browser: cached upgrade, signup, recovery, claim, tenants, roles, refresh, four widths');
 }finally{await browser.close();await new Promise(r=>server.close(r));cleanup();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
