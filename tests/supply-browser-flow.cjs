const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
module.exports=async({p,f,login,out,branch})=>{
 await p.locator('[data-tab=hqsupply]').click();await p.getByRole('heading',{name:'본사 발주 취합',exact:true}).waitFor();
 for(const [name,size,unit]of [['소고기 패티',100,'장'],['버거 번',50,'개']]){
  await p.locator('[data-ingredient-new]').click();await p.locator('#ingredient-editor [name=name]').fill(name);await p.locator('#ingredient-editor [name=pack_size]').fill(String(size));await p.locator('#ingredient-editor [name=unit]').selectOption(unit);await p.locator('#ingredient-editor button').click();await p.getByText('공급 재료를 저장했습니다.',{exact:true}).waitFor();
 }
 const [patty,bun]=f.sqlite.prepare('SELECT * FROM ingredient ORDER BY id').all();
 await p.locator('[data-act=logout]').click();await login('shop@example.test');await p.locator('[data-tab=materials]').click();await p.locator('[data-material-edit="'+patty.id+'"]').click();await p.locator('#material-stock [name=quantity]').fill('10');await p.locator('#material-stock [name=low_threshold]').fill('20');await p.locator('#material-stock [name=reason]').fill('초기 실사');await p.locator('#material-stock button').click();await p.getByText('재료 수량과 조정 이력을 저장했습니다.',{exact:true}).waitFor();
 await p.locator('#tabs [data-tab=supplies]').click();await p.locator('[name="packs:'+patty.id+'"]').fill('2');await p.locator('[name="packs:'+bun.id+'"]').fill('1');await p.locator('#supply-create [name=note]').fill('행사 대비');await p.locator('#supply-create button').click();await p.locator('.supply-detail').waitFor();
 const order=f.sqlite.prepare('SELECT * FROM supply_order WHERE store_id=?').get(branch);
 const quantity=()=>f.sqlite.prepare('SELECT quantity FROM ingredient_stock WHERE store_id=? AND ingredient_id=?').get(branch,patty.id).quantity;assert.equal(quantity(),10);
 const other=await f.callTenant(f.b,2,'/api/admin/supply',{key:randomUUID(),lines:[{ingredient_id:patty.id,packs:3,revision:0}]});assert.equal(other.status,200);
 await p.locator('[data-act=logout]').click();await login('primary@example.test');await p.locator('[data-tab=hqsupply]').click();await p.getByText('5박스',{exact:true}).waitFor();
 for(const width of [320,390,768,1280]){await p.setViewportSize({width,height:1100});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'HQ supply overflow '+width);await p.screenshot({path:path.join(out,'supply-hq-'+width+'.png'),fullPage:true});}
 await p.locator('[data-supply-detail="'+order.id+'"]').click();await p.getByRole('button',{name:'발주 승인',exact:true}).click();await p.getByRole('button',{name:'출고 완료 처리',exact:true}).waitFor();assert.equal(quantity(),10);await p.getByRole('button',{name:'출고 완료 처리',exact:true}).click();await p.locator('.mode-tag').filter({hasText:'출고 완료'}).waitFor();assert.equal(quantity(),10);
 await p.locator('[data-act=logout]').click();await login('shop@example.test');await p.locator('#account-store').waitFor();assert.equal(await p.locator('[data-tab=hqsupply]').count(),0);await p.locator('#tabs [data-tab=supplies]').click();await p.locator('[data-supply-detail="'+order.id+'"]').click();
 const lines=f.sqlite.prepare('SELECT * FROM supply_line WHERE order_id=? ORDER BY ingredient_id').all(order.id);assert.equal(lines.length,2);
 await p.locator('[name="receive:'+lines[0].id+'"]').fill('180');await p.locator('[name="receive:'+lines[1].id+'"]').fill('50');await p.locator('#supply-receive [name=note]').fill('패티 20장 다음 배송');await p.locator('#supply-receive button').click();await p.locator('.mode-tag').filter({hasText:'일부 입고'}).waitFor();assert.equal(quantity(),190);
 for(const width of [320,390]){await p.setViewportSize({width,height:1000});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:path.join(out,'supply-receive-'+width+'.png'),fullPage:true});}
 await p.locator('[name="receive:'+lines[0].id+'"]').fill('20');await p.locator('#supply-receive button').click();await p.locator('.mode-tag').filter({hasText:'입고 완료'}).waitFor();assert.equal(quantity(),210);assert.equal(await p.locator('#supply-receive').count(),0);
 await p.locator('[data-tab=materials]').click();await p.getByRole('heading',{name:'재료 재고',exact:true}).waitFor();assert.equal(await p.locator('.inventory-list img').count(),0);await p.screenshot({path:path.join(out,'materials-390.png'),fullPage:true});
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM supply_receipt WHERE order_id=?').get(order.id).n,2);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM orders WHERE store_id=?').get(branch).n,1);
 await p.locator('[data-act=logout]').click();await login('primary@example.test');await p.getByRole('heading',{name:'본사 관리',exact:true}).waitFor();
 fs.writeFileSync(path.join(out,'supply-browser-results.json'),JSON.stringify({date:new Date().toISOString(),registerIngredients:true,storeStockAdjustment:true,storeRequest:true,hqAggregationTwoStores:true,approveShipNoStockChange:true,partialAndFinalReceipt:true,stock210:true,customerOrderPreserved:true,widths:[320,390,768,1280]},null,2));
};
