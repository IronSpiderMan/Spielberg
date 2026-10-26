// Real browser + real HTTP backend + local model fixture; no real projects or model charges.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { spawn } = require('node:child_process');
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
  if(prompt.includes('停止测试')) {
   await new Promise(resolve=>setTimeout(resolve,1800));
   message={role:'assistant',content:null,tool_calls:[tool('app_request',{method:'POST',resource:'roles',data:{name:'不应创建'}},'cancel-write')]};
  } else if(!results.length) {
   message={role:'assistant',content:null,tool_calls:[
    tool('app_request',{method:'POST',resource:'roles',data:{name:'Agent 主角',description:'雨夜车站的旅人'}},'role'),
    tool('app_request',{method:'POST',resource:'screenplays',data:{title:'Agent 测试剧本',content:'# 雨夜\n\n旅人走进车站。'}},'script'),
   ]};
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
  assert.equal(await page.getByRole('link',{name:'参考资料',exact:true}).getAttribute('href'),'https://example.com/reference');
  const roles=await api(`/projects/${project.id}/roles`,undefined,'GET');assert.equal(roles.length,1);assert.equal(roles[0].name,'Agent 主角');
  const scripts=await api(`/projects/${project.id}/screenplays`,undefined,'GET');assert.equal(scripts.length,1);
  await page.screenshot({path:path.join(screenshots,'desktop.png'),fullPage:true});
  await page.reload();await page.getByRole('menuitem',{name:'Agent 助手',exact:true}).click();
  await page.getByRole('link',{name:'参考资料',exact:true}).waitFor();
  await page.getByTestId('agent-settings').click();
  await page.getByRole('dialog').getByText('Agent 设置',{exact:true}).waitFor();
  await page.getByRole('switch',{name:'沿用项目 LLM 配置',exact:true}).click();
  assert.equal(await page.getByRole('dialog').locator('input[type=password]').first().inputValue(),'');
  await page.screenshot({path:path.join(screenshots,'settings.png'),fullPage:true});
  await page.keyboard.press('Escape');
  // A saved conversation remains usable after visiting the app's normal editors.
  await page.getByRole('menuitem',{name:'角色设定',exact:true}).click();
  await page.locator('.role-card').getByText('Agent 主角',{exact:true}).waitFor();
  await page.getByRole('menuitem',{name:'Agent 助手',exact:true}).click();
  await page.getByTestId('agent-new-session').click();
  await page.getByTestId('agent-composer').fill('停止测试');
  await page.getByTestId('agent-send').click();
  await page.getByTestId('agent-stop').click();
  await page.waitForTimeout(2100);
  assert.equal((await api(`/projects/${project.id}/roles`,undefined,'GET')).length,1);
  // Narrow and dark themes must retain usable controls without horizontal overflow.
  for(const width of [1024,768,390]) {
   await page.setViewportSize({width,height:900});
   await page.getByTestId('agent-composer').waitFor({state:'visible'});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`overflow at ${width}`);
   const bounds=await page.getByTestId('agent-send').boundingBox();assert(bounds && bounds.x>=0 && bounds.x+bounds.width<=width+1);
   if(width<=600){const nav=await page.locator('.side').boundingBox();assert(bounds.y+bounds.height<nav.y,`composer hidden by bottom navigation at ${width}`);}
   await page.screenshot({path:path.join(screenshots,`width-${width}.png`),fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'切换到暗夜模式',exact:true}).click();
  await page.screenshot({path:path.join(screenshots,'dark.png'),fullPage:true});
  assert.deepEqual(failures,[]);
  console.log('PASS: real browser Agent sends, executes app tools, renders Markdown/source links, persists sessions, hides credentials, refreshes normal editors, cancels and fits desktop/mobile/dark themes');
  console.log('Screenshots: '+screenshots);
 } finally {
  if(browser)await browser.close();
  server.kill('SIGTERM');await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));
  model.closeAllConnections();await new Promise(resolve=>model.close(resolve));
  // Preserve screenshots only; remove all disposable project data.
  fs.rmSync(path.join(temp,'data'),{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
