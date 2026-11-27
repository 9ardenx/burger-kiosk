const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({p,f,login,out})=>{
 const hqTabs=['hqhome','hqsales','hqsupply','franchise','hqaccounts'];
 const tabs=()=>p.locator('#tabs [data-tab]').evaluateAll(bs=>bs.map(b=>b.dataset.tab));
 const preserved=()=>JSON.stringify(['menu','menu_option','orders','payment','store_member'].map(t=>f.sqlite.prepare('SELECT * FROM '+t).all()));
 const before=preserved();assert.deepEqual(await tabs(),hqTabs);assert.equal(await p.locator('#account-store').count(),0);
 for(const width of [320,390,768,1280]){await p.setViewportSize({width,height:1000});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'workspace HQ width '+width);await p.screenshot({path:path.join(out,'workspace-hq-'+width+'.png'),fullPage:true});}
 await p.locator('[data-workspace-store]').click();await p.locator('#account-store').waitFor();assert.equal(new URL(p.url()).searchParams.get('store'),'1');assert.equal(new URL(p.url()).searchParams.get('workspace'),'store');
 assert.ok((await p.locator('.workspace-banner').textContent()).includes('직영점 운영'));assert.ok(!(await tabs()).includes('hqsales'));await p.locator('#tabs [data-tab=menu]').click();await p.getByRole('heading',{name:'메뉴 관리',exact:true}).waitFor();await p.reload();await p.getByRole('heading',{name:'메뉴 관리',exact:true}).waitFor();
 for(const width of [320,390,768,1280]){await p.setViewportSize({width,height:1000});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'workspace store width '+width);await p.screenshot({path:path.join(out,'workspace-store-'+width+'.png'),fullPage:true});}
 await p.locator('[data-workspace-hq]').click();await p.getByRole('heading',{name:'본사 관리',exact:true}).waitFor();assert.deepEqual(await tabs(),hqTabs);
 await p.locator('#tabs [data-tab=hqaccounts]').click();await p.getByRole('heading',{name:'내 본사 계정',exact:true}).waitFor();await p.locator('[data-store-accounts="2"]').click();await p.locator('#invite-account').waitFor();assert.deepEqual(await tabs(),hqTabs);assert.ok((await p.locator('.hq-store-context').textContent()).includes('임시 B매장'));assert.equal(await p.locator('#account-store').count(),0);
 await p.locator('.hq-store-context [data-tab=hqaccounts]').click();await p.getByRole('heading',{name:'내 본사 계정',exact:true}).waitFor();
 await p.locator('#tabs [data-tab=franchise]').click();await p.locator('[data-store-profile="2"]').click();await p.locator('#store-profile').waitFor();assert.ok((await p.locator('.hq-store-context').textContent()).includes('임시 B매장'));assert.deepEqual(await tabs(),hqTabs);
 await p.locator('.hq-store-context [data-tab=franchise]').click();await p.locator('[data-open-store="2"]').click();await p.locator('#account-store').waitFor();assert.ok((await p.locator('.workspace-banner').textContent()).includes('가맹점 운영 지원'));
 await p.locator('[data-act=logout]').click();await login('primary@example.test');await p.getByRole('heading',{name:'본사 관리',exact:true}).waitFor();assert.deepEqual(await tabs(),hqTabs);assert.equal(new URL(p.url()).searchParams.get('workspace'),'hq');
 await p.locator('[data-act=logout]').click();await login('a@example.test');await p.locator('#account-store').waitFor();
 const forged=new URL(p.url());forged.searchParams.set('workspace','hq');forged.searchParams.set('store','2');forged.hash='hqsales';await p.goto(forged.href);await p.locator('#account-store').waitFor();assert.equal(new URL(p.url()).searchParams.get('store'),'1');assert.ok(!(await tabs()).includes('hqsales'));assert.equal(await p.locator('[data-workspace-hq]').count(),0);
 await p.locator('[data-act=logout]').click();await login('primary@example.test');await p.getByRole('heading',{name:'본사 관리',exact:true}).waitFor();
 assert.equal(preserved(),before);
 fs.writeFileSync(path.join(out,'workspace-results.json'),JSON.stringify({date:new Date().toISOString(),hqDefault:true,directSwitch:true,reloadMode:true,returnHQ:true,scopedHQMembers:true,scopedHQProfile:true,supportStoreLabel:true,freshLoginHQ:true,forgedOwnerRouteBlocked:true,preserved:true,widths:[320,390,768,1280]},null,2));
};
