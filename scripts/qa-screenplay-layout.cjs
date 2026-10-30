// Production frontend + real HTTP backend; isolated disposable project directory.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
 const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spielberg-http-ui-'));
 const binary = process.env.SPIELBERG_TEST_BINARY || path.resolve(__dirname, '../backend/target/debug/spielberg-backend');
 let frontend;
 let frontendUrl;
 if (process.env.SPIELBERG_UI_SEPARATE === '1') {
  const http = require('node:http');
  const dist = path.resolve(__dirname,'../dist');
  frontend = http.createServer((req,res) => {
   const file = path.join(dist,new URL(req.url,'http://localhost').pathname === '/' ? 'index.html' : new URL(req.url,'http://localhost').pathname);
   if (!file.startsWith(dist + path.sep) || !fs.existsSync(file)) {res.writeHead(404);res.end();return;}
   const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
   res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>frontend.listen(0,'127.0.0.1',resolve));
  frontendUrl=`http://127.0.0.1:${frontend.address().port}`;
 }
 const server = spawn(binary, [], {env:{...process.env,SPIELBERG_DATA_DIR:path.join(temp,'data'),SPIELBERG_BIND:'127.0.0.1:0',...(frontendUrl?{SPIELBERG_ALLOWED_ORIGINS:frontendUrl}:{})},stdio:['ignore','pipe','pipe']});
 let browser;
 try {
  const url=await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('Backend startup timed out')),15000);
   server.stdout.on('data', data=>{const match=String(data).match(/Spielberg listening at (http:\/\/\S+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});
   server.on('error', reject);server.on('exit', code=>{clearTimeout(timeout);reject(Error(`Backend exited ${code}`));});
  });
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {})});
  const page=await browser.newPage({viewport:{width:1420,height:1000}});
  const failures=[];
  page.on('pageerror', error=>failures.push(error.message));
  const projectResponse=await fetch(url+'/api/v1/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'剧本测试项目'})});
  assert.equal(projectResponse.status,201);
  const {data:project}=await projectResponse.json();
  const episodeResponse=await fetch(url+'/api/v1/projects/'+project.id+'/episodes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'剧本测试第一集'})});
  assert.equal(episodeResponse.status,201);
  const {data:episode}=await episodeResponse.json();
  let lastFormat='markdown';
  const openScripts=async()=>{
   await page.getByRole('menuitem',{name:'剧集',exact:true}).click();
   await page.locator('.episode-card').filter({has:page.getByRole('heading',{name:'剧本测试第一集',exact:true})}).getByRole('button',{name:'编辑',exact:true}).click();
   if(lastFormat==='csv') await page.getByRole('tab',{name:'分镜头剧本',exact:true}).click();
  };
  if (frontendUrl) await page.addInitScript(base => { window.__SPIELBERG_API_URL__ = base; }, url);
  await page.goto(frontendUrl || url);
  await openScripts();
  // A long storyboard must scroll inside the document, never the desktop page.
  await page.setViewportSize({width:1600,height:1000});
  const longCsv='编号,景别,运镜,画面,描述\n'+Array.from({length:72},(_,i)=>`${i+1},中景,固定,,第 ${i+1} 个镜头：少年查看日志，然后打开终端。`).join('\n');
  const response=await fetch(url+'/api/v1/projects/'+project.id+'/episodes/'+episode.id+'/screenplays',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'72 镜分镜',format:'csv',content:longCsv})});
  assert.equal(response.status,201);
  await page.reload();lastFormat='csv';await openScripts();
  await page.getByLabel('镜头 72 描述',{exact:true}).waitFor();
  for (const viewport of [{width:1600,height:1000},{width:1280,height:720},{width:1024,height:768}]) {
   await page.setViewportSize(viewport);
   await page.waitForTimeout(150);
   const layout=await page.evaluate(()=>{
    const content=document.querySelector('.content'),table=document.querySelector('.shot-script-table');
    const footer=document.querySelector('.screenplay-footer').getBoundingClientRect();
    return {outerOverflow:content.scrollHeight-content.clientHeight,tableOverflow:table.scrollHeight-table.clientHeight,footerBottom:footer.bottom,viewport:innerHeight};
   });
   assert(layout.outerOverflow<=1,JSON.stringify({viewport,layout}));
   assert(layout.tableOverflow>0,JSON.stringify({viewport,layout}));
   assert(layout.footerBottom<=layout.viewport,JSON.stringify({viewport,layout}));
   await page.locator('.shot-script-table').evaluate(el=>{el.scrollTop=el.scrollHeight;});
   const header=await page.locator('.shot-script-table th').first().boundingBox();
   const scroller=await page.locator('.shot-script-table').boundingBox();
   assert(Math.abs(header.y-scroller.y)<2,'Table headings remain visible while scrolling');
  }
  await page.setViewportSize({width:1600,height:1000});
  await page.locator('.shot-script-table').evaluate(el=>{el.scrollTop=0;});
  await page.locator('.arco-message').waitFor({state:'hidden'});
  await page.screenshot({path:'/tmp/spielberg-screenplay-redesign.png',fullPage:true});
  await page.locator('.theme-toggle').click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await page.waitForTimeout(300);
  await page.screenshot({path:'/tmp/spielberg-screenplay-redesign-dark.png',fullPage:true});
  await page.setViewportSize({width:720,height:900});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert(await page.evaluate(()=>{const table=document.querySelector('.shot-script-table');return table.scrollHeight<=table.clientHeight+1;}),'Narrow layouts have no nested vertical table scroll');
  assert.deepEqual(failures,[]);
  console.log('PASS: 72-shot table at 1600×1000, 1280×720 and 1024×768; no outer scroll, visible footer and sticky headings; 720px responsive layout; single-document full-width editing');
 } finally {
  if(browser)await browser.close();server.kill('SIGTERM');
  await new Promise(resolve=>{if(server.exitCode!==null)resolve();else server.once('exit',resolve);});
  if(frontend){frontend.closeAllConnections();await new Promise(resolve=>frontend.close(resolve));}
  fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
