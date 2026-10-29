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
  if (frontendUrl) await page.addInitScript(base => { window.__SPIELBERG_API_URL__ = base; }, url);
  await page.goto(frontendUrl || url);
  await page.getByRole('menuitem',{name:'剧本管理',exact:true}).click();
  const input=page.getByLabel('导入剧本文件',{exact:true});
  const ready=()=>page.waitForFunction(()=>!document.querySelector('[aria-label="导入剧本文件"]').disabled);
  const list=async()=> (await fetch(url+'/api/v1/projects/'+project.id+'/screenplays').then(r=>r.json())).data;
  await input.setInputFiles([
   {name:'第一集.md',mimeType:'text/markdown',buffer:Buffer.from('\uFEFF# 第一集\n对白')},
   {name:'第二集.txt',mimeType:'text/plain',buffer:Buffer.from('第二集正文')},
   {name:'空文件.txt',mimeType:'text/plain',buffer:Buffer.from(' ')},
   {name:'不支持.pdf',mimeType:'application/pdf',buffer:Buffer.from('binary')},
  ]);
  await page.getByRole('status').getByText(/已导入并保存 2 份剧本/).waitFor();
  await ready();
  assert.equal((await list()).length,2);
  assert.equal(await page.getByLabel('Markdown 剧本内容').inputValue(),'# 第一集\n对白');
  await page.getByRole('status').getByText(/空文件.txt：剧本文件为空/).waitFor();
  await page.getByRole('status').getByText(/不支持.pdf：仅支持/).waitFor();
  await page.getByLabel('Markdown 剧本内容').fill('未保存的手动修改');
  // A stalled project refresh must not hold the editor or hide saved imports.
  let releaseRefresh;
  const refreshGate=new Promise(resolve=>{ releaseRefresh=resolve; });
  await page.route('**/api/v1/actions/project/changes',async route=>{ await refreshGate; await route.continue(); });
  const transfer=await page.evaluateHandle(()=>{
   const data=new DataTransfer();
   data.items.add(new File(['第三集正文'],'第三集.txt',{type:'text/plain'}));
   data.items.add(new File(['编号,景别,运镜,画面,描述\n1,中景,固定,,开场'],'分镜.csv',{type:'text/csv'}));
   data.items.add(new File(['坏表头'],'错误.csv',{type:'text/csv'}));
   return data;
  });
  const zone=page.getByRole('button',{name:'拖拽或选择剧本文件',exact:true});
  await zone.dispatchEvent('dragenter',{dataTransfer:transfer});
  assert((await zone.getAttribute('class')).includes('dragging'));
  await zone.dispatchEvent('dragover',{dataTransfer:transfer});
  // Drop below the dashed box, matching a real drop into the workspace.
  await page.locator('.screenplay-workspace').dispatchEvent('drop',{dataTransfer:transfer});
  await page.getByRole('status').getByText(/错误.csv：CSV 表头必须/).waitFor();
  await ready();
  assert(!(await zone.getAttribute('class')).includes('dragging'));
  assert.equal(await page.getByLabel('Markdown 剧本内容').inputValue(),'未保存的手动修改');
  assert.equal(await page.locator('.screenplay-item').count(),4);
  releaseRefresh();
  await page.unrouteAll({behavior:'wait'});
  const stored=await list();
  assert.equal(stored.length,4);
  assert.equal(stored.find(x=>x.title==='第三集').content,'第三集正文');
  assert.equal(stored.find(x=>x.title==='分镜').format,'csv');
  assert.equal(stored.find(x=>x.title==='第一集').content,'# 第一集\n对白');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await ready();
  await page.reload();
  await page.getByRole('menuitem',{name:'剧本管理',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.screenplay-item').length===4);
  assert.equal(await page.locator('.screenplay-item').count(),4);
  await page.setViewportSize({width:720,height:900});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.screenshot({path:'/tmp/spielberg-screenplay-import.png',fullPage:true});
  assert.deepEqual(failures,[]);
  console.log('PASS: multi-file selection, drag/drop mixed Markdown/TXT/CSV, partial failure details, automatic persistence, dirty draft preservation, reload and mobile layout');
 } finally {
  if(browser)await browser.close();server.kill('SIGTERM');
  await new Promise(resolve=>{if(server.exitCode!==null)resolve();else server.once('exit',resolve);});
  if(frontend){frontend.closeAllConnections();await new Promise(resolve=>frontend.close(resolve));}
  fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
