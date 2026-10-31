// Real browser + real HTTP backend + local model fixture; no real projects or model charges.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const tool = (name, args, id) => ({id,type:'function',function:{name,arguments:JSON.stringify(args)}});

(async () => {
 const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spielberg-agent-ui-'));
 const screenshots = path.join(temp, 'screenshots'); fs.mkdirSync(screenshots);
 const model = http.createServer(async (req,res) => {
  const chunks=[];for await(const chunk of req) chunks.push(chunk);
  const body=JSON.parse(Buffer.concat(chunks).toString());
  const lastUser=body.messages.findLastIndex(m=>m.role==='user');
  const prompt=body.messages[lastUser].content;
  const results=body.messages.slice(lastUser+1).filter(m=>m.role==='tool');
  let message;
  if(body.tool_choice==='none') {
   message={role:'assistant',content:'本轮执行已暂停，已完成的操作已保留。'};
  } else if(prompt.includes('预算测试')) {
   message={role:'assistant',content:null,tool_calls:[tool('get_project',{},'budget-first'),tool('get_project',{},'budget-skipped')]};
  } else if(prompt.includes('SVG 测试')) {
   message=results.length ? {role:'assistant',content:'SVG 已保存到素材库。'} : {role:'assistant',content:null,tool_calls:[tool('app_action',{operation:'media/create-svg',data:{name:'Agent 矢量图',svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140"><rect width="240" height="140" rx="20" fill="#315efb"/><circle cx="120" cy="70" r="40" fill="gold"/><text x="120" y="78" text-anchor="middle" font-size="20">SVG</text></svg>'}},'svg-create')]};
  } else if(prompt.includes('停止测试')) {
   await new Promise(resolve=>setTimeout(resolve,1800));
   message={role:'assistant',content:null,tool_calls:[tool('app_request',{method:'POST',resource:'roles',data:{name:'不应创建'}},'cancel-write')]};
  } else if(!results.length) {
   message={role:'assistant',content:null,tool_calls:[
    tool('update_plan',{plan:[{step:'创建雨夜故事的角色与剧本',status:'in_progress'},{step:'检查创建结果',status:'pending'}]},'plan'),
    tool('app_request',{method:'POST',resource:'roles',data:{name:'Agent 主角',description:'雨夜车站的旅人'}},'role'),
    tool('app_request',{method:'POST',resource:'episodes',data:{title:'雨夜车站'}},'episode'),
   ]};
  } else if(results.length===3) {
   const episodeResult=JSON.parse(results.find(item=>item.tool_call_id==='episode').content);
   const episode=episodeResult.data || episodeResult;
   message={role:'assistant',content:null,tool_calls:[tool('app_request',{method:'POST',resource:'screenplays',episode_id:episode.id,data:{title:'Agent 测试剧本',content:'# 雨夜\n\n旅人走进车站。'}},'script')]};
  } else if(results.length===4) {
   message={role:'assistant',content:null,tool_calls:[tool('app_request',{method:'GET',resource:'screenplays'},'verify')]};
  } else if(results.length===5) {
   message={role:'assistant',content:null,tool_calls:[tool('update_plan',{plan:[{step:'创建雨夜故事的角色与剧本',status:'completed'},{step:'检查创建结果',status:'completed'}]},'plan-done')]};
  } else message={role:'assistant',content:'已创建 **Agent 主角** 和剧本。\n\n[参考资料](https://example.com/reference)'};
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}]}));
 });
 await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
 const binary=process.env.SPIELBERG_TEST_BINARY || path.resolve(__dirname,'../../backend/target/debug/spielberg-backend');
 const server=spawn(binary,[],{env:{...process.env,SPIELBERG_DATA_DIR:path.join(temp,'data'),SPIELBERG_BIND:'127.0.0.1:0'},stdio:['ignore','pipe','pipe']});
 let browser;
 try {
  const base=await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('Backend startup timed out')),15000);
   server.stdout.on('data',data=>{const match=String(data).match(/Spielberg listening at (http:\/\/\S+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});
   server.on('error',reject);server.on('exit',code=>{clearTimeout(timeout);reject(Error(`Backend exited ${code}`));});
  });
  const api=async(route,data,method='POST')=>{
   const response=await fetch(base+'/api/v1'+route,{method,headers:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
   const result=await response.json();assert(response.ok,JSON.stringify(result));return result.data;
  };
  const project=await api('/projects',{name:'Agent 浏览器验证'});
  await api('/actions/settings',{project_id:project.id,settings:{llm:{base_url:`http://127.0.0.1:${model.address().port}/v1`,model:'qa-tool-model',api_key:'ui-test-private-key'}}});
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const failures=[];page.on('pageerror',error=>failures.push(error.message));
  await page.goto(base);
  await page.getByRole('menuitem',{name:'Agent 助手',exact:true}).click();
  await page.getByTestId('agent-workspace').waitFor();
  await page.getByTestId('agent-composer').fill('请创建雨夜故事的主角和剧本');
  await page.getByTestId('agent-send').click();
  await page.getByRole('link',{name:'参考资料',exact:true}).waitFor({timeout:15000});
  await page.getByTestId('agent-plan').getByText('2/2',{exact:true}).waitFor();
  const originalSession=(await api('/actions/agent/sessions',{project_id:project.id})).items[0];
  assert.equal(await page.getByRole('link',{name:'参考资料',exact:true}).getAttribute('href'),'https://example.com/reference');
  const roles=await api(`/projects/${project.id}/roles`,undefined,'GET');assert.equal(roles.length,1);assert.equal(roles[0].name,'Agent 主角');
  const scripts=await api(`/projects/${project.id}/screenplays`,undefined,'GET');assert.equal(scripts.length,1);
  await page.screenshot({path:path.join(screenshots,'desktop.png'),fullPage:true});
  // Reproduce an already migrated history: the asset exists on this machine,
  // while its original generation result still contains a Windows path.
  const upload=await fetch(`${base}/api/v1/projects/${project.id}/assets/upload?name=migrated.png`,{
   method:'POST',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII=','base64')
  });
  assert(upload.ok);const migrated=(await upload.json()).data;
  const seed=spawnSync('python3',['-c',`
import json,sqlite3,sys
c=sqlite3.connect(sys.argv[1])
messages=json.loads(c.execute('SELECT messages FROM agent_sessions WHERE id=?',(sys.argv[2],)).fetchone()[0])
media=json.loads(sys.argv[3]);media['path']=r'C:\\Users\\Administrator\\old-project\\assets\\migrated.png'
arguments={'operation':'generations/image','data':{'prompt':'test'}}
messages.extend([
 {'role':'assistant','content':'','tool_calls':[{'id':'migrated-output','type':'function','function':{'name':'app_action','arguments':json.dumps(arguments)}}]},
 {'role':'tool','tool_call_id':'migrated-output','tool_name':'app_action','status':'completed','arguments':arguments,'content':json.dumps({'data':{'media':media}})}
])
c.execute('UPDATE agent_sessions SET messages=? WHERE id=?',(json.dumps(messages),sys.argv[2]));c.commit()
`,path.join(project.path,'spielberg.sqlite'),originalSession.id,JSON.stringify(migrated)],{encoding:'utf8'});
  assert.equal(seed.status,0,seed.stderr);
  await page.reload();await page.getByRole('menuitem',{name:'Agent 助手',exact:true}).click();
  await page.getByRole('link',{name:'参考资料',exact:true}).waitFor();
  await page.getByTestId('agent-plan').getByText('2/2',{exact:true}).waitFor();
  const thumbnail=page.locator('.agent-generated-images img');
  await thumbnail.waitFor();
  await page.waitForFunction(()=>document.querySelector('.agent-generated-images img')?.naturalWidth>0);
  assert.equal(new URL(await thumbnail.getAttribute('src'),base).searchParams.get('path'),migrated.path);
  await page.getByRole('button',{name:'预览 migrated.png',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.image-preview-full img')?.naturalWidth>0);
  await page.screenshot({path:path.join(screenshots,'migrated-image.png'),fullPage:true});
  await page.keyboard.press('Escape');
  await page.getByTestId('agent-settings').click();
  await page.getByRole('dialog').getByText('Agent 设置',{exact:true}).waitFor();
  await page.getByRole('switch',{name:'沿用项目 LLM 配置',exact:true}).click();
  assert.equal(await page.getByRole('dialog').locator('input[type=password]').first().inputValue(),'');
  await page.screenshot({path:path.join(screenshots,'settings.png'),fullPage:true});
  await page.keyboard.press('Escape');
  // A saved conversation remains usable after visiting the app's normal editors.
  await page.getByRole('menuitem',{name:'资产库',exact:true}).click();
  await page.locator('.role-card').getByText('Agent 主角',{exact:true}).waitFor();
  await page.getByRole('menuitem',{name:'Agent 助手',exact:true}).click();
  await page.getByTestId('agent-new-session').click();
  await page.getByTestId('agent-composer').fill('停止测试');
  await page.getByTestId('agent-send').click();
  await page.getByTestId('agent-stop').click();
  await page.waitForTimeout(2100);
  assert.equal((await api(`/projects/${project.id}/roles`,undefined,'GET')).length,1);
  await api('/actions/agent/config/save',{project_id:project.id,config:{max_steps:1}});
  await page.getByTestId('agent-new-session').click();
  await page.getByTestId('agent-composer').fill('预算测试');
  await page.getByTestId('agent-send').click();
  await page.locator('.agent-limit-notice').waitFor();
  assert.equal(await page.locator('.agent-tool-status.skipped').textContent(),'未执行');
  const sessionOrder=()=>page.locator('.agent-session-select').evaluateAll(items=>items.map(item=>item.dataset.testid));
  const beforeSelection=await sessionOrder();
  assert.notEqual(beforeSelection[0],`agent-session-${originalSession.id}`);
  await page.getByTestId(`agent-session-${originalSession.id}`).click();
  await page.getByTestId('agent-plan').waitFor();
  assert.deepEqual(await sessionOrder(),beforeSelection,'Selecting an older session moved it');
  await page.reload();await page.getByRole('menuitem',{name:'Agent 助手',exact:true}).click();
  await page.getByTestId('agent-plan').waitFor();
  assert.deepEqual(await sessionOrder(),beforeSelection,'Reload changed session order');
  // Narrow and dark themes must retain usable controls without horizontal overflow.
  for(const width of [1024,768,390]) {
   await page.setViewportSize({width,height:900});
   await page.getByTestId('agent-composer').waitFor({state:'visible'});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`overflow at ${width}`);
   const bounds=await page.getByTestId('agent-send').boundingBox();assert(bounds && bounds.x>=0 && bounds.x+bounds.width<=width+1);
   assert(bounds.y>=0 && bounds.y+bounds.height<=900,`composer outside viewport at ${width}`);
   assert(await page.getByTestId('agent-send').evaluate(button=>{const rect=button.getBoundingClientRect();const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);return hit===button || button.contains(hit);}),`composer covered at ${width}`);
   await page.screenshot({path:path.join(screenshots,`width-${width}.png`),fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('menuitem',{name:'资产库',exact:true}).click();
  await page.getByRole('button',{name:'切换到暗夜模式',exact:true}).click();
  await page.getByRole('menuitem',{name:'Agent 助手',exact:true}).click();
  await page.getByTestId('agent-plan').waitFor();
  await page.screenshot({path:path.join(screenshots,'dark.png'),fullPage:true,animations:'disabled'});
  // The LLM writes SVG source directly; no image generation provider is configured.
  await api('/actions/agent/config/save',{project_id:project.id,config:{max_steps:8}});
  await page.getByTestId('agent-new-session').click();
  await page.getByTestId('agent-composer').fill('SVG 测试：画一个矢量标志并保存');
  await page.getByTestId('agent-send').click();
  await page.getByText('SVG 已保存到素材库。',{exact:true}).waitFor({timeout:15000});
  const svgImage=page.locator('.agent-generated-images img[alt="Agent 矢量图.svg"]');
  await svgImage.waitFor();
  await svgImage.evaluate(img=>img.decode());
  assert(await svgImage.evaluate(img=>img.complete && img.naturalWidth>0 && img.naturalHeight>0),'SVG failed to render');
  const svgAsset=(await api(`/projects/${project.id}/assets?kind=image`,undefined,'GET')).items.find(item=>item.name==='Agent 矢量图.svg');
  assert(svgAsset && svgAsset.kind==='image');
  const svgResponse=await fetch(`${base}/api/v1/projects/${project.id}/assets/${svgAsset.id}/content`);
  assert.match(svgResponse.headers.get('content-type'),/image\/svg\+xml/);
  assert.match(svgResponse.headers.get('content-security-policy'),/sandbox/);
  const source=await svgResponse.text();assert(source.includes('<circle'));
  await page.getByRole('button',{name:'预览 Agent 矢量图.svg',exact:true}).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('dialog').locator('img').first().evaluate(img=>img.decode());
  await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:base});
  await page.getByRole('button',{name:'复制图片',exact:true}).click();
  await page.getByText('已复制图片',{exact:true}).waitFor();
  assert(await page.evaluate(async()=> (await navigator.clipboard.read()).some(item=>item.types.includes('image/png'))));
  await page.screenshot({path:path.join(screenshots,'svg-preview.png'),fullPage:true});
  await page.keyboard.press('Escape');
  await page.reload();await page.getByRole('menuitem',{name:'Agent 助手',exact:true}).click();
  await page.locator('.agent-generated-images img[alt="Agent 矢量图.svg"]').waitFor();
  assert.deepEqual(failures,[]);
  console.log('PASS: Agent SVG creation/inline preview/modal/reload without image provider; migrated image thumbnail/preview; fixed session order after selection/reload; Agent tools, durable plans, limited/skipped states, Markdown/source links, credential hiding, editor refresh, cancellation and desktop/mobile/dark themes');
  console.log('Screenshots: '+screenshots);
 } finally {
  if(browser)await browser.close();
  server.kill('SIGTERM');await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));
  model.closeAllConnections();await new Promise(resolve=>model.close(resolve));
  // Preserve screenshots only; remove all disposable project data.
  fs.rmSync(path.join(temp,'data'),{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
