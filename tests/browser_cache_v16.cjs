// Real HTTP caching regression: retain the old browser cache across deployments.
// Requires the v1.6 Git tag, Playwright and Chrome. No production requests/writes.
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
async function main(){
 const root=path.resolve(__dirname,'../docs'),out=path.resolve(__dirname,'../data/qa/v1.6');fs.mkdirSync(out,{recursive:true});
 const files=['admin.html','assets/admin.js','assets/insights-ui.js','assets/style.css'];
 const old=Object.fromEntries(files.map(file=>[file,execFileSync('git',['show','v1.6:docs/'+file],{encoding:'utf8',windowsHide:true})]));
 const inventory={items:[{id:1,name:'클래식버거',kind:'classic',category:'burger',photo_key:null,enabled:1,quantity:10,low_threshold:2,revision:1,is_sold_out:0}],history:[]};
 let phase='old',base;const requests=[],errors=[];
 const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost'),file=url.pathname.slice(1)||'admin.html';requests.push({phase,url:req.url});
  if(file.startsWith('api/')){res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(file==='api/admin/inventory'?inventory:{orders:[]}));return;}
  try{let body=phase==='old'&&old[file]!==undefined?old[file]:fs.readFileSync(path.join(root,file));
    if(phase==='removal'&&(file==='admin.html'||file==='assets/admin.js'))body=old[file];
    if(file==='assets/backend.js')body=body.toString().replace('https://burger-kiosk-9ardenx-api.epicowl12.chatgpt.site',base);
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');res.setHeader('Cache-Control','public, max-age=600');res.end(body);
  }catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{const page=await browser.newPage({viewport:{width:390,height:900}});page.on('pageerror',e=>errors.push(e.message));
  const visit=async(query,direct=false)=>{await page.goto(base+'/admin.html?'+query+(direct?'#inventory':''));if(!direct)await page.locator('[data-tab=inventory]').click();await page.locator('.inventory-row').first().waitFor();return page.locator('.inventory-row img').count();};
  assert.equal(await visit('old'),1);
  phase='removal';assert.equal(await visit('removal'),1);assert.equal(requests.filter(r=>r.phase==='removal'&&r.url.includes('.js')).length,0);
  await page.screenshot({path:path.join(out,'cache-before-fix.png'),fullPage:true});
  phase='fixed';assert.equal(await visit('fixed',true),0);assert.ok(requests.some(r=>r.phase==='fixed'&&r.url.includes('insights-ui.js?v=')));
  assert.equal(await page.locator('[data-tab=inventory]').getAttribute('aria-pressed'),'true');await page.locator('[data-inventory-edit]').click();await page.locator('#inventory-editor').waitFor();assert.equal(await page.locator('[name=quantity]').inputValue(),'10');await page.locator('[data-inventory-back]').first().click();
  await page.screenshot({path:path.join(out,'cache-after-fix.png'),fullPage:true});assert.deepEqual(errors,[]);
  const result={date:new Date().toISOString(),oldImages:1,afterRemovalWithCache:1,afterVersionFix:0,directInventory:true,editorWorks:true,requests,errors};fs.writeFileSync(path.join(out,'cache-regression-results.json'),JSON.stringify(result,null,2));console.log('PASS V16-CACHE-01: cached photo remains after unversioned deployment; versioned assets remove it in the same browser; direct inventory and editor work');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
}main().catch(e=>{console.error(e);process.exitCode=1;});
