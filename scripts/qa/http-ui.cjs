// Production frontend + real HTTP backend; isolated disposable project directory.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
 const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spielberg-http-ui-'));
 const binary = process.env.SPIELBERG_TEST_BINARY || path.resolve(__dirname, '../../backend/target/debug/spielberg-backend');
 let frontend;
 let frontendUrl;
 if (process.env.SPIELBERG_UI_SEPARATE === '1') {
  const http = require('node:http');
  const dist = path.resolve(__dirname,'../../dist');
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
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1420,height:1000}});
  const failures=[];const requests=[];
  page.on('pageerror',e=>failures.push(e.message));
  page.on('request',r=>{if(r.url().includes('/api/'))requests.push({url:r.url(),method:r.method()});});
  page.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=400)failures.push(`${r.status()} ${r.url()}`);});
  await page.addInitScript(() => Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true }));
  if(frontendUrl)await page.addInitScript(apiUrl=>{window.__SPIELBERG_API_URL__=apiUrl;},url);
  await page.goto(frontendUrl || url);
  assert.equal(await page.evaluate(()=>typeof window.__TAURI_INTERNALS__), 'undefined');
  await page.getByRole('button',{name:'创建漫剧项目',exact:true}).click();
  await page.getByPlaceholder('为你的故事起个名字').fill('浏览器 HTTP 项目');
  await page.locator('.arco-modal').getByRole('button',{name:'创建项目',exact:true}).click();
  await page.locator('.nav').waitFor();
  await page.getByRole('menuitem',{name:'角色设定',exact:true}).click();
  await page.getByRole('button',{name:'创建角色',exact:true}).first().click();
  await page.locator('.arco-drawer input').first().fill('HTTP 角色');
  await page.getByRole('button',{name:'保存角色',exact:true}).click();
  await page.locator('.role-card').getByText('HTTP 角色',{exact:true}).waitFor();
  await page.getByRole('menuitem',{name:'资产库',exact:true}).click();
  const chooser=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'导入资产',exact:true}).click();
  await (await chooser).setFiles({name:'browser-upload.png',mimeType:'image/png',buffer:fs.readFileSync(path.resolve(__dirname,'../../public/spielberg-logo-s.png'))});
  await page.getByRole('button',{name:'预览 browser-upload.png',exact:true}).waitFor();
  await page.getByRole('menuitem',{name:'Prompt 库',exact:true}).click();
  await page.getByRole('button',{name:'新建 Prompt',exact:true}).click();
  await page.locator('.arco-modal input').first().fill('HTTP Prompt');
  await page.locator('.arco-modal').getByRole('button',{name:'确定',exact:true}).click();
  await page.locator('.prompt-card').getByText('HTTP Prompt',{exact:true}).waitFor();
  await page.getByRole('button',{name:'项目备份',exact:true}).click();
  await page.getByRole('menuitem',{name:'备份当前项目',exact:true}).click();
  const downloading=page.waitForEvent('download');
  await page.getByRole('button',{name:'选择位置并备份',exact:true}).click();
  const backup=await downloading;const backupPath=path.join(temp,'backup.spielberg-backup');await backup.saveAs(backupPath);
  assert(fs.statSync(backupPath).size>0);
  await page.getByRole('button',{name:'项目备份',exact:true}).click();
  const restoring=page.waitForEvent('filechooser');
  await page.getByRole('menuitem',{name:'从备份恢复',exact:true}).click();
  await (await restoring).setFiles(backupPath);
  await page.locator('.project-switch').getByText('浏览器 HTTP 项目 · 恢复',{exact:true}).waitFor();
  assert(requests.some(r=>r.method==='PATCH'&&/\/roles\/\d+$/.test(r.url)));
  assert(requests.some(r=>r.method==='PATCH'&&/\/prompts\/\d+$/.test(r.url)));
  assert(requests.some(r=>r.method==='POST'&&r.url.includes('/assets/upload')));
  assert(requests.every(r=>r.url.includes('/api/v1/')));
  assert.deepEqual(failures,[]);
  console.log((frontendUrl ? 'CROSS-ORIGIN ' : 'SAME-ORIGIN ') + 'PASS: real browser creates project and role, updates Prompt, uploads asset, downloads backup and restores over HTTP; no business IPC');
 } finally {
  if(browser)await browser.close();server.kill('SIGTERM');
  await new Promise(resolve=>{if(server.exitCode!==null)resolve();else server.once('exit',resolve);});
  if(frontend){frontend.closeAllConnections();await new Promise(resolve=>frontend.close(resolve));}
  fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
