// Isolated browser checks: all network routes are fixtures, never production writes.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),manifest=JSON.parse(fs.readFileSync(path.join(root,'assets/menu/published/manifest.json'),'utf8'));
const output=path.join(root,'data/qa/photos-720x465');fs.mkdirSync(output,{recursive:true});
const checks=[],geometry=[];const pass=name=>{checks.push({name,result:'PASS'});console.log('PASS '+name);};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const archive=JSON.parse(fs.readFileSync(path.join(root,'assets/menu/originals/manifest.json'),'utf8'));
for(const file of archive.photos)assert.equal(sha(fs.readFileSync(path.join(root,'assets/menu/originals',file.file))),file.sha256);
const files=new Map(manifest.photos.map(p=>{const bytes=fs.readFileSync(path.join(root,'assets/menu/published',p.file));assert.equal(sha(bytes),p.sha256);return [p.sha256,bytes];}));
let menu=manifest.photos.map(p=>({id:p.menu_id,name:p.name,photo_key:p.sha256,category:[3,5,6].includes(p.menu_id)?'side':p.menu_id===4?'drink':'burger',kind:'custom',description:'화면 검증용 설명',base_price:2000,is_sold_out:0,version:1,options:[],choice_groups:[]})),lastPayload;
async function routes(page){await page.route('**/*',async route=>{
 const url=new URL(route.request().url()),p=url.pathname;
 if(p.startsWith('/api/')){
  const headers={'Access-Control-Allow-Origin':'https://photos.test','Access-Control-Allow-Headers':'Content-Type, X-Kiosk-Session, Authorization','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(p.startsWith('/api/admin/')&&p!=='/api/admin/login'&&!route.request().headers().authorization)
   return route.fulfill({status:401,headers,contentType:'application/json',body:JSON.stringify({error:'로그인이 필요합니다.'})});
  if(p.startsWith('/api/menu-photos/'))return route.fulfill({contentType:'image/jpeg',body:files.get(p.split('/').at(-1))});
  let data;
  if(p==='/api/menu')data={menu:menu.filter(m=>!m.is_sold_out),mode:'demo',clientKey:''};
  else if(p==='/api/ads')data={items:[],revision:0};
  else if(p==='/api/admin/login')data={token:'fixture-token'};
  else if(p==='/api/admin/logout')data={ok:true};
  else if(p==='/api/admin/orders')data={orders:[]};
  else if(p==='/api/admin/menu')data={menu,order_revision:0};
  else if(p.startsWith('/api/admin/menu/')){
   assert.equal(route.request().method(),'POST');lastPayload=route.request().postDataJSON();
   const id=Number(p.split('/').at(-1)),item=menu.find(m=>m.id===id);assert.ok(item);
   const photo=lastPayload.photo===undefined?item.photo_key:lastPayload.photo===null?null:sha(Buffer.from(lastPayload.photo,'base64'));
   if(lastPayload.photo)files.set(photo,Buffer.from(lastPayload.photo,'base64'));
   Object.assign(item,lastPayload,{photo_key:photo,version:item.version+1});delete item.photo;
   data={id};
  } else throw new Error('Unexpected fixture request '+p);
  return route.fulfill({contentType:'application/json',headers,body:JSON.stringify(data)});
 }
 if(url.origin!=='https://photos.test')throw new Error('Unexpected external request '+url.href);
 const file=path.join(root,'docs',p==='/'?'index.html':decodeURIComponent(p).slice(1));
 if(!fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
 const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';
 return route.fulfill({contentType:mime,body:fs.readFileSync(file)});
});}
async function decoded(page,data){return page.evaluate(async data=>{const img=new Image();img.src='data:image/jpeg;base64,'+data;await img.decode();return [img.naturalWidth,img.naturalHeight];},data);}
async function main(){
 const errors=[];const chrome=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
 let browser=await chromium.launch({headless:true,executablePath:chrome});
 try {
  const page=await browser.newPage({viewport:{width:1280,height:1000}});page.on('pageerror',e=>errors.push(e.message));await routes(page);
  await page.goto('https://photos.test/');await page.locator('[data-dining=DINE_IN]').click();await page.locator('.menu-card').first().waitFor();
  await page.locator('.menu-card img').evaluateAll(images=>Promise.all(images.map(i=>i.decode())));
  assert.deepEqual(await page.locator('.menu-card img').evaluateAll(images=>images.map(i=>[i.naturalWidth,i.naturalHeight])),manifest.photos.map(()=>[720,465]));
  pass('All seven publishing JPEGs decode to exactly 720x465; archived originals match their hashes');
  const conversion=await page.evaluate(async()=>{
   const {jpegForUpload}=await import('/assets/menu-photo.js');const results=[];
   for(const [w,h] of [[720,465],[720,468],[720,480],[720,489],[1600,900],[800,1200],[160,100]]){
    const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');
    ctx.fillStyle='#e5d6ba';ctx.fillRect(0,0,w,h);ctx.fillStyle='#145c49';ctx.fillRect(w*.4,h*.3,w*.2,h*.4);
    const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png')),data=await jpegForUpload(new File([blob],'fixture.png',{type:'image/png'}));
    const image=new Image();image.src='data:image/jpeg;base64,'+data;await image.decode();results.push([image.naturalWidth,image.naturalHeight,atob(data).length]);
   }
   let rejected=false;try{await jpegForUpload(new File(['broken'],'broken.jpg',{type:'image/jpeg'}));}catch{rejected=true;}
   return {results,rejected};
  });
  for(const [w,h,size] of conversion.results){assert.deepEqual([w,h],[720,465]);assert.ok(size<=192000);}assert.equal(conversion.rejected,true);
  pass('Portrait, landscape, small, and near-standard uploads export 720x465 within the server size limit; invalid JPEG rejected');
  const exact=files.get(manifest.photos[0].sha256).toString('base64');
  const copied=await page.evaluate(async data=>{const {jpegForUpload}=await import('/assets/menu-photo.js');return jpegForUpload(new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],'photo.jpg',{type:'image/jpeg'}));},exact);
  assert.equal(copied,exact);pass('Already compliant JPEG is preserved byte for byte');
  await page.goto('https://photos.test/admin.html');await page.locator('[name=password]').fill('fixture');await page.locator('#login button').click();await page.locator('#order-rows').waitFor();
  await page.locator('[data-tab=menu]').click();await page.locator('[data-edit-menu="4"]').click();
  const source=fs.readFileSync(path.join(root,'assets/menu/originals/soda.jpg'));
  await page.locator('[name=photo]').setInputFiles({name:'soda.jpg',mimeType:'image/jpeg',buffer:source});
  await page.waitForFunction(()=>document.querySelector('[data-photo-state]').textContent.includes('같은 사진'));
  const center=await page.locator('#photo-preview').getAttribute('src');
  await page.locator('[name=photo-y]').fill('0');
  await page.waitForFunction(center=>document.querySelector('#photo-preview').src!==center&&document.querySelector('[data-photo-state]').textContent.includes('같은 사진'),center);
  const adjusted=await page.locator('#photo-preview').getAttribute('src');assert.notEqual(adjusted,center);
  await page.locator('#menu-editor [type=submit]').click();await page.locator('.catalog-card').first().waitFor();
  assert.equal('data:image/jpeg;base64,'+lastPayload.photo,adjusted);assert.deepEqual(await decoded(page,lastPayload.photo),[720,465]);
  pass('Admin crop-position control changes the preview, and the saved JPEG exactly matches that preview');
  await page.locator('[data-edit-menu="4"]').click();await page.locator('[name=photo]').setInputFiles({name:'soda.jpg',mimeType:'image/jpeg',buffer:source});
  await page.waitForFunction(()=>document.querySelector('[data-photo-state]').textContent.includes('같은 사진'));
  await page.locator('[data-clear-photo]').click();assert.equal(await page.locator('.photo-crop').isHidden(),true);
  await page.locator('#menu-editor [type=submit]').click();await page.locator('.catalog-card').first().waitFor();assert.equal(lastPayload.photo,null);
  pass('Default-image action clears the selected upload and crop controls');
  // Restore fixture state before display checks.
  menu.find(m=>m.id===4).photo_key=manifest.photos.find(p=>p.menu_id===4).sha256;
 }finally{await browser.close();}
 for(const zoom of [1,1.25,1.5]){
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'kiosk-standard-'));fs.mkdirSync(path.join(profile,'Default'));
  fs.writeFileSync(path.join(profile,'Default/Preferences'),JSON.stringify({partition:{default_zoom_level:{x:Math.log(zoom)/Math.log(1.2)}}}));
  const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:chrome,viewport:null,args:['--force-device-scale-factor=1','--window-size=1440,1100']});
  try {
   const page=context.pages()[0];page.on('pageerror',e=>errors.push(e.message));await routes(page);await page.goto('https://photos.test/');await page.locator('[data-dining=DINE_IN]').click();await page.locator('.menu-card').first().waitFor();
   assert.ok(Math.abs(await page.evaluate(()=>devicePixelRatio)-zoom)<.001);
   for(const width of [320,390,540,768,1024,1280]){
    await page.setViewportSize({width:Math.round(width*zoom),height:Math.round(1000*zoom)});
    for(const category of ['all','burger','side','drink']){
     await page.locator(`[data-category=${category}]`).click();await page.locator('.menu-card img').evaluateAll(images=>Promise.all(images.map(i=>i.decode())));await page.mouse.move(0,0);
     const items=await page.locator('.menu-card').evaluateAll(cards=>cards.map(c=>{
      const i=c.querySelector('img'),a=c.querySelector('.art'),r=c.getBoundingClientRect(),ir=i.getBoundingClientRect(),ar=a.getBoundingClientRect();
      return {id:c.dataset.id,natural:[i.naturalWidth,i.naturalHeight],imageWidth:ir.width,imageHeight:ir.height,topGap:ar.top-r.top,border:getComputedStyle(c).borderWidth,wrapperGap:Math.max(Math.abs(ir.left-ar.left),Math.abs(ir.right-ar.right),Math.abs(ir.top-ar.top),Math.abs(ir.bottom-ar.bottom)),titleY:c.querySelector('.card-copy').getBoundingClientRect().top,cardY:r.top};
     }));
     for(const item of items){assert.deepEqual(item.natural,[720,465]);assert.ok(item.wrapperGap<.02);assert.ok(Math.abs(item.topGap)<.02);assert.equal(item.border,'0px');assert.ok(Math.abs(item.imageHeight-item.imageWidth*465/720)<.02);}
     if(items.length>1&&Math.abs(items[0].cardY-items[1].cardY)<.02)assert.ok(Math.abs(items[0].titleY-items[1].titleY)<.02);
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
     geometry.push({zoom,width,category,count:items.length,result:'PASS'});
    }
    if(zoom===1&&[390,1280].includes(width)){
     await page.locator('[data-category=all]').click();await page.locator('.menu-card img').evaluateAll(images=>Promise.all(images.map(i=>i.decode())));await page.mouse.move(0,0);
     await page.screenshot({path:path.join(output,`menu-${width}.png`),fullPage:true});
     const marker=await page.addStyleTag({content:'.art.with-photo{background:#ff00ff!important}'});
     const png=await page.screenshot({fullPage:true});fs.writeFileSync(path.join(output,`diagnostic-${width}.png`),png);
     const exposed=await page.evaluate(async b64=>{const i=new Image();i.src='data:image/png;base64,'+b64;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);const d=ctx.getImageData(0,0,c.width,c.height).data;let n=0;for(let x=0;x<d.length;x+=4)if(d[x]>220&&d[x+1]<70&&d[x+2]>220)n++;return n;},png.toString('base64'));
     assert.equal(exposed,0);await marker.evaluate(e=>e.remove());
    }
    await page.locator('[data-category=all]').click();await page.locator('.menu-card[data-id="3"]').click();
    await page.locator('#options img').evaluate(i=>i.decode());await page.waitForTimeout(240);
    const popup=await page.locator('#options').evaluate(d=>{const f=d.querySelector('.dialog-art').getBoundingClientRect(),h=d.querySelector('h2').getBoundingClientRect();return {border:getComputedStyle(d).borderWidth,height:f.height,overlap:h.top<f.bottom};});assert.equal(popup.border,'0px');assert.equal(popup.height,170);assert.equal(popup.overlap,false);
    await page.locator('#options [data-action=close]').click();
   }
   pass(`Photo alignment at browser zoom ${zoom*100}%: 6 widths × 4 filters; popup title never overlaps`);
  }finally{await context.close();}
 }
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({date:'2026-11-25',checks,geometry},null,2));
 console.log('RESULT_DIRECTORY '+output);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
