const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({p,f,login,users,out,branch})=>{
 await p.locator('#tabs [data-tab=hqsales]').click();await p.getByRole('heading',{name:'통합 매출',exact:true}).waitFor();
 assert.equal(await p.locator('.metrics .metric').nth(1).locator('small').textContent(),'1건');
 assert.ok((await p.locator('.ranking').textContent()).includes('MENU-1'));
 for(const width of [320,390,768,1280]){await p.setViewportSize({width,height:1000});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'HQ sales overflow '+width);await p.screenshot({path:path.join(out,'sales-'+width+'.png'),fullPage:true});}
 await p.locator('#hq-sales-period [name=store]').selectOption('2');await p.locator('#hq-sales-period button').click();await p.getByText('이 기간에는 승인·취소 내역이 없습니다.',{exact:true}).waitFor();assert.equal(await p.locator('.metrics .metric').nth(1).locator('small').textContent(),'0건');
 await p.locator('#hq-sales-period [name=store]').selectOption(String(branch));await p.locator('#hq-sales-period button').click();await p.locator('.ranking').waitFor();
 await p.locator('#tabs [data-tab=franchise]').click();await p.locator('#create-store').waitFor();
 await p.locator('#create-store [name=address_pending]').check();assert.ok(await p.locator('#create-store .address-fields').isHidden());
 await p.locator('#create-store [name=owner_email]').fill('second@example.test');await p.locator('#create-store button').click();await p.waitForURL(u=>u.hash==='#accounts'&&u.searchParams.get('store')!==String(branch));await p.locator('[data-copy-invite]').waitFor();
 const second=Number(new URL(p.url()).searchParams.get('store'));users.set('second@example.test',f.identity('second-owner','second@example.test'));
 await p.locator('[data-act=logout]').click();await p.goto(new URL('admin.html?store=1#accounts',p.url()).href);await p.locator('#email-login').waitFor();await login('second@example.test');await p.locator('#store-profile').waitFor();
 assert.equal(await p.locator('#tabs [data-tab=hqsales]').count(),0);
 await p.locator('#store-profile [name=address]').fill('경기도 용인시 처인구 모현읍 외대로 81');await p.locator('#store-profile [name=address_detail]').fill('2층');await p.getByText('자동 점포명: 용인모현점',{exact:false}).waitFor();
 await p.locator('#store-profile button').click();await p.getByText('매장 주소와 점포명을 저장했습니다.',{exact:true}).waitFor();await p.getByRole('heading',{name:'용인모현2점',exact:true}).waitFor();
 assert.equal(f.sqlite.prepare('SELECT address_pending FROM store WHERE id=?').get(second).address_pending,0);
 for(const width of [320,390]){await p.setViewportSize({width,height:1000});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:path.join(out,'profile-'+width+'.png'),fullPage:true});}
 await p.locator('[data-act=logout]').click();await login('primary@example.test');await p.getByRole('heading',{name:'본사 관리',exact:true}).waitFor();
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM orders WHERE store_id=?').get(branch).n,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM orders WHERE store_id=?').get(second).n,0);
 fs.writeFileSync(path.join(out,'hq-browser-results.json'),JSON.stringify({date:new Date().toISOString(),hqAutoNaming:true,deferredOwnerAddress:true,collisionSuffix:true,salesFilter:true,productGrouping:true,isolatedStores:true,widths:[320,390,768,1280]},null,2));
};
