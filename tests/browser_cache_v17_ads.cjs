const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
async function main(){
 const root=path.resolve(__dirname,'..'),files=execFileSync('git',['ls-tree','-r','--name-only','v1.7','docs'],{cwd:root,encoding:'utf8',windowsHide:true}).trim().split('\n').filter(f=>/\.(?:html|css|js)$/.test(f));
 const old=Object.fromEntries(files.map(f=>[f.slice(5),execFileSync('git',['show','v1.7:'+f],{cwd:root,windowsHide:true})]));
 let phase='old',base;const requests=[],errors=[],hash='0'.repeat(64),menu=[{id:1,name:'이전 메뉴',description:'설명',photo_key:hash,base_price:5000,is_sold_out:0},{id:2,name:'최근 등록 메뉴',description:'새 설명',photo_key:hash,base_price:6000,is_sold_out:0}];
 const server=http.createServer((req,res)=>{const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';requests.push({phase,url:req.url});
 try{if(file.startsWith('api/')){res.setHeader('Cache-Control','no-store');if(file.includes('-photos/')){res.setHeader('Content-Type','image/jpeg');return res.end(fs.readFileSync(path.join(root,'assets/menu/published/classic-burger.jpg')));}res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(file==='api/ads'?{items:[{id:'v17-new-products-banner',title:'첫 소식',description:'설명',placement:'INTRO',photo_key:hash,enabled:true}],revision:1}:{menu,categories:[],mode:'demo',clientKey:''}));}
 let content=phase==='old'&&old[file]?old[file]:fs.readFileSync(path.join(root,'docs',file));if(file==='assets/backend.js')content=content.toString().replace('https://burger-kiosk-9ardenx-api.epicowl12.chatgpt.site',base);
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.jpg')?'image/jpeg':'text/html');res.setHeader('Cache-Control','public,max-age=600');res.end(content);
 }catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/?old');await p.getByRole('heading',{name:'첫 소식',exact:true}).waitFor();assert.equal(await p.locator('.ad-navigation').isHidden(),true);
 phase='new';await p.goto(base+'/?new');await p.locator('#ad-position').getByText('1 / 3',{exact:true}).waitFor({state:'attached'});await p.locator('[data-action=ad-next]').click();await p.getByRole('heading',{name:'최근 등록 메뉴',exact:true}).waitFor();assert.ok(requests.some(r=>r.phase==='new'&&r.url.includes('ad-slides.js?v=20261127-v173')));assert.deepEqual(errors,[]);
 fs.mkdirSync(path.join(root,'data/qa/v1.7-ads'),{recursive:true});fs.writeFileSync(path.join(root,'data/qa/v1.7-ads/cache-results.json'),JSON.stringify({date:new Date().toISOString(),sameBrowser:true,oldOnlyOneAd:true,newAutomaticMenus:true,requests,errors},null,2));console.log('PASS V17-ADS-CACHE same browser keeps v1.7 cache and fetches versioned new carousel modules');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
