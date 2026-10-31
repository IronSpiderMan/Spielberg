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
  const scope=url+'/api/v1/projects/'+project.id;
  const create=async(resource,body)=>{
   const response=await fetch(scope+'/'+resource,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   assert.equal(response.status,201); return (await response.json()).data;
  };
  const episode=await create('episodes',{title:'第一集',storyboard:{scenes:[{title:'雨夜',duration:4,shots:[{duration:4,description:'少年走进车站',camera:'大特写 · 推近',sound:'你好。'}]}]}});
  await create('assets',{name:'林舟'});
  await create('assets',{name:'苏晓'});
  let episodeTitle='第一集';
  const openEpisode=async()=>{
   await page.getByRole('menuitem',{name:'剧集',exact:true}).click();
   await page.locator('.episode-card').filter({has:page.getByRole('heading',{name:episodeTitle,exact:true})}).getByRole('button',{name:'编辑',exact:true}).first().click();
  };
  const tab=name=>page.getByRole('tab',{name,exact:true});
  const stored=async()=> (await fetch(scope+'/episodes/'+episode.id+'/screenplays').then(r=>r.json())).data;
  const save=async(shortcut=false)=>{
   const response=page.waitForResponse(r=>r.url().endsWith('/episodes/'+episode.id)&&r.request().method()==='PATCH');
   if(shortcut)await page.keyboard.press('ControlOrMeta+s');else await page.getByRole('button',{name:'保存',exact:true}).click();
   assert.equal((await response).status(),200);
   await page.waitForFunction(()=>!document.querySelector('.episode-editor-toolbar .arco-btn-loading'));
  };
  if(frontendUrl)await page.addInitScript(base=>{window.__SPIELBERG_API_URL__=base;},url);
  await page.goto(frontendUrl||url); await openEpisode();
  assert.equal(await page.getByRole('button',{name:'保存',exact:true}).count(),1);
  for(const name of ['新建剧本','导入剧本','新建分镜头剧本','保存全部','打开生图模态框'])assert.equal(await page.getByRole('button',{name,exact:true}).count(),0);
  assert.equal(await page.locator('.screenplay-library,.screenplay-titlebar').count(),0);
  const markdown='# 雨夜\n\n**林舟**\n> 你终于来了。\n\n<script>window.markdownInjected=true</script>';
  await page.getByLabel('Markdown 剧本内容').fill(markdown);
  await page.getByRole('article',{name:'剧本实时预览'}).getByRole('heading',{name:'雨夜',exact:true}).waitFor();
  assert.equal(await page.locator('.screenplay-markdown script').count(),0);
  await tab('分镜头剧本').click();
  await page.getByRole('button',{name:'添加镜头',exact:true}).click();
  await page.getByLabel('镜头 1 编号',{exact:true}).fill('001');
  await page.getByLabel('镜头 1 描述',{exact:true}).fill('雨夜走进车站');
  await tab('剧集信息与场景').click();
  episodeTitle='第一集 · 雨夜';
  await page.getByLabel('剧集标题',{exact:true}).fill(episodeTitle);
  await page.getByLabel('剧集简介',{exact:true}).fill('独立简介');
  await save(true);
  let documents=await stored(); assert.equal(documents.length,2);
  assert.equal(documents.find(d=>d.format==='markdown').content,markdown);
  assert(documents.find(d=>d.format==='csv').content.includes('雨夜走进车站'));
  await page.reload(); await openEpisode();
  assert.equal(await page.getByLabel('Markdown 剧本内容').inputValue(),markdown);
  assert.equal(await page.getByLabel('插入剧本引用',{exact:true}).count(),0);
  assert.equal(await page.getByText('支持标题、粗体、对白引用、列表和表格',{exact:true}).count(),0);
  const input=page.getByLabel('Markdown 剧本内容');
  const suggestions=page.getByRole('listbox',{name:'剧本引用',exact:true});
  await input.fill('前文 @ 后文');
  for(let i=0;i<3;i++) await page.keyboard.press('ArrowLeft');
  await suggestions.waitFor();
  await page.getByRole('option').filter({hasText:'@林舟'}).click();
  assert.equal(await input.inputValue(),'前文 @林舟  后文');
  await suggestions.waitFor({state:'hidden'});
  await input.fill('@');
  await suggestions.waitFor();
  const secondMention=await suggestions.getByRole('option').nth(1).locator('b').innerText();
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  assert.equal(await input.inputValue(),secondMention+' ');
  await input.fill('@林');
  assert.equal(await suggestions.getByRole('option').count(),1);
  await page.keyboard.press('Tab');assert.equal(await input.inputValue(),'@林舟 ');
  await input.fill('@不存在');await suggestions.waitFor({state:'hidden'});
  await page.keyboard.press('Enter');assert.equal(await input.inputValue(),'@不存在\n');
  await input.fill('mail@example');await suggestions.waitFor({state:'hidden'});
  await input.fill('@');await suggestions.waitFor();await page.keyboard.press('Escape');
  await suggestions.waitFor({state:'hidden'});assert.equal(await input.inputValue(),'@');
  await input.fill('@林');await suggestions.waitFor();
  await input.dispatchEvent('compositionstart');await suggestions.waitFor({state:'hidden'});
  await input.dispatchEvent('compositionend');await suggestions.waitFor();
  await page.keyboard.press('Enter');assert.equal(await input.inputValue(),'@林舟 ');
  // Keep the popup within the editor near the end of a long, scrolled document.
  await input.fill(Array.from({length:80},(_,i)=>`第 ${i+1} 行正文`).join('\n')+'\n@');
  await suggestions.waitFor();
  await input.evaluate(el=>{el.scrollTop=el.scrollHeight;});
  const popup=await suggestions.boundingBox(),source=await input.boundingBox();
  assert(popup.y>=source.y && popup.y+popup.height<=source.y+source.height+1,JSON.stringify({popup,source}));
  assert(source.y+source.height-popup.y-popup.height<100,'The popup stays beside the last-line caret');
  await page.screenshot({path:'/tmp/spielberg-screenplay-mentions.png',fullPage:true});
  await page.getByRole('button',{name:'标题',exact:true}).click();await suggestions.waitFor({state:'hidden'});
  await input.fill(markdown+'\n\n@林');await suggestions.waitFor();await page.keyboard.press('Enter');
  const withReference=await page.getByLabel('Markdown 剧本内容').inputValue();
  assert(withReference.includes('@林舟 '));
  await tab('分镜头剧本').click();
  assert.equal(await page.getByLabel('镜头 1 编号',{exact:true}).inputValue(),'001');
  await page.getByText('AI 分镜与场景制作 · 1 个场景',{exact:true}).click();
  assert((await page.locator('.storyboard-script-preview').innerText()).includes('@林舟'));
  await page.getByRole('button',{name:'转为分镜表',exact:true}).click();
  await page.getByText('替换当前分镜表？',{exact:true}).waitFor();
  await page.locator('.arco-modal').getByRole('button',{name:'替换',exact:true}).click();
  assert((await page.getByLabel('镜头 1 描述',{exact:true}).inputValue()).includes('你好。'));
  await save();
  documents=await stored();assert.equal(documents.length,2);
  assert(documents.find(d=>d.format==='csv').content.includes('001,大特写,推近,'));
  await page.getByText('AI 分镜与场景制作 · 1 个场景',{exact:true}).click();
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=','base64');
  await page.getByLabel('镜头 1 本地画面文件',{exact:true}).setInputFiles({name:'shot.png',mimeType:'image/png',buffer:png});
  await page.getByLabel('镜头 1 画面路径',{exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('[aria-label="镜头 1 上传本地画面"]').disabled);
  await save(true);
  const csvDownload=page.waitForEvent('download');await page.getByRole('button',{name:'导出 CSV',exact:true}).click();
  assert.equal((await csvDownload).suggestedFilename(),episodeTitle+' · 分镜头剧本.csv');
  await page.getByRole('button',{name:'添加镜头',exact:true}).click();
  await page.getByLabel('镜头 2 编号',{exact:true}).fill('001');
  await page.getByLabel('镜头 2 描述',{exact:true}).fill('重复编号');
  await tab('剧本').click();
  await page.getByLabel('Markdown 剧本内容').fill('等待一起保存的新正文');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.getByText(/第 3 行编号为空或重复/).waitFor();
  assert.equal((await stored()).find(d=>d.format==='markdown').content,withReference);
  await tab('分镜头剧本').click();await page.getByRole('button',{name:'删除镜头 2',exact:true}).click();
  await save();assert.equal((await stored()).find(d=>d.format==='markdown').content,'等待一起保存的新正文');
  await tab('剧本').click();await page.getByLabel('Markdown 剧本内容').fill('尚未保存的正文');
  await page.getByRole('menuitem',{name:'工作台',exact:true}).click();
  await page.getByText('放弃未保存的修改？',{exact:true}).waitFor();await page.getByRole('button',{name:'继续编辑',exact:true}).click();
  assert.equal(await page.getByLabel('Markdown 剧本内容').inputValue(),'尚未保存的正文');
  await page.waitForResponse(r=>r.url().includes('/project/changes'));
  assert.equal(await page.getByLabel('Markdown 剧本内容').inputValue(),'尚未保存的正文');
  await save();await save();assert.equal((await stored()).length,2);
  const duplicate=await fetch(scope+'/episodes/'+episode.id+'/screenplays',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'重复剧本',content:'不应覆盖'})});
  assert.equal(duplicate.status,409);
  assert.equal((await stored()).find(d=>d.format==='markdown').content,'尚未保存的正文');
  await page.screenshot({path:'/tmp/spielberg-single-screenplay.png',fullPage:true});
  for(const viewport of [{width:1280,height:720},{width:720,height:900}]){
   await page.setViewportSize(viewport);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  assert.deepEqual(failures,[]);
  console.log('PASS: inline @ search, mouse and keyboard insertion, caret preservation, IME, Escape, empty results, email exclusion and scrolled popup positioning; one save and shortcut persist both documents plus episode information; draft-preserving tabs, safe Markdown, AI table replacement, picture upload, export, validation, unsaved guard, polling, uniqueness and responsive layout');
 } finally {
  if(browser)await browser.close();server.kill('SIGTERM');
  await new Promise(resolve=>{if(server.exitCode!==null)resolve();else server.once('exit',resolve);});
  if(frontend){frontend.closeAllConnections();await new Promise(resolve=>frontend.close(resolve));}
  fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
