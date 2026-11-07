// Real browser + HTTP regression; isolated projects and a local model, no model charges.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const tool = (name, args, id) => ({id, type:'function', function:{name, arguments:JSON.stringify(args)}});
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'spielberg-user-input-'));
 const screenshots=path.join(temp,'screenshots');fs.mkdirSync(screenshots);
 const model=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const body=JSON.parse(Buffer.concat(chunks).toString());
  const last=body.messages.findLastIndex(item=>item.role==='user');
  const prompt=body.messages[last].content;
  const results=body.messages.slice(last+1).filter(item=>item.role==='tool');
  let message={role:'assistant',content:'已根据回答继续处理。'};
  if(!results.length){
   const args=prompt==='表单测试'?{questions:[
    {id:'ok',question:'是否继续创作？',type:'confirmation'},
    {id:'brief',question:'补充故事要求',type:'text'},
    {id:'one',question:'选择一种画风',type:'single_select',options:[{id:'film',label:'电影',description:'写实镜头'},{id:'comic',label:'漫画'}]},
    {id:'many',question:'选择场景元素',type:'multi_select',options:[{id:'rain',label:'雨夜'},{id:'station',label:'车站'},{id:'street',label:'街道'}]},
   ]}:{questions:[{id:'approve',question:'是否执行这个创建操作？',type:'confirmation'}],tool:{name:'app_request',arguments:{resource:'assets',method:'POST',data:{name:prompt}}}};
   assert(body.tools.some(item=>item.function.name==='request_user_input'));
   message={role:'assistant',content:null,tool_calls:[tool('request_user_input',args,'decision')]};
  }
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}]}));
 });
 await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
 const binary=process.env.SPIELBERG_TEST_BINARY||path.resolve(__dirname,'../../backend/target/debug/spielberg-backend');
 const backend=spawn(binary,[],{env:{...process.env,SPIELBERG_DATA_DIR:path.join(temp,'data'),SPIELBERG_BIND:'127.0.0.1:0'},stdio:['ignore','pipe','pipe']});
 let browser,page;
 try{
  const base=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Backend startup timed out')),15000);
   backend.stdout.on('data',data=>{const match=String(data).match(/Spielberg listening at (http:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
   backend.on('error',reject);
  });
  const api=async(route,data,method='POST')=>{
   const response=await fetch(base+'/api/v1'+route,{method,headers:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
   const result=await response.json();assert(response.ok,JSON.stringify(result));return result.data;
  };
  const project=await api('/projects',{name:'用户交互验证'});
  const agent=(action,data={})=>api('/actions/agent/'+action,{project_id:project.id,...data});
  await api('/actions/settings',{project_id:project.id,settings:{llm:{base_url:`http://127.0.0.1:${model.address().port}/v1`,model:'input-fixture',api_key:'local-fixture-only'}}});
  browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route(base+'/**',async route=>{
   const pathname=new URL(route.request().url()).pathname;
   if(pathname!=='/'&&!pathname.startsWith('/assets/'))return route.continue();
   const file=path.resolve(__dirname,'../../dist',pathname==='/'?'index.html':pathname.slice(1));
   if(!fs.existsSync(file))return route.continue();return route.fulfill({path:file});
  });
  const settled=async id=>{
   for(let i=0;i<150;i++){const session=await agent('session',{session_id:id});if(!session.execution.active&&session.status!=='running')return session;await sleep(40);}
   throw Error('Run did not finish');
  };
  const select=async id=>{
   await page.evaluate(({pid,id})=>localStorage.setItem(`spielberg-agent-session-${pid}`,id),{pid:project.id,id});
   await page.reload();await page.getByRole('menuitem',{name:'Agent 助手',exact:true}).click();
  };
  await page.goto(base);await page.getByRole('menuitem',{name:'Agent 助手',exact:true}).click();
  await page.getByTestId('agent-composer').fill('表单测试');await page.getByTestId('agent-send').click();
  let card=page.getByTestId('agent-workspace').getByTestId('agent-user-input');await card.waitFor();
  assert.equal(await card.locator('input:checked').count(),0,'Answer was preselected');
  assert(await card.getByRole('button',{name:'提交回答'}).isDisabled());
  await page.screenshot({path:path.join(screenshots,'desktop.png'),fullPage:true});
  const session=(await agent('sessions')).items[0];
  await page.reload();await page.getByRole('menuitem',{name:'Agent 助手',exact:true}).click();await card.waitFor();
  await card.getByRole('radio',{name:'是',exact:true}).check();
  await card.getByRole('textbox',{name:'补充故事要求'}).fill('保持雨夜车站');
  await card.getByRole('radio',{name:'电影'}).check();
  await card.getByRole('checkbox',{name:'雨夜',exact:true}).check();
  await card.getByRole('checkbox',{name:'车站',exact:true}).check();
  await card.getByRole('checkbox',{name:'街道',exact:true}).check();
  await card.getByRole('checkbox',{name:'街道',exact:true}).uncheck();
  assert.equal(await card.locator('input:checked').count(),4);
  await page.setViewportSize({width:390,height:844});
  await card.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(screenshots,'mobile.png'),fullPage:true});
  assert(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Form overflows mobile width');
  await card.getByRole('button',{name:'提交回答'}).click();
  const completed=await settled(session.id);assert.equal(completed.status,'completed');
  const result=JSON.parse(completed.messages.find(item=>item.tool_name==='request_user_input').content);
  assert.deepEqual(result.answers,{ok:true,brief:'保持雨夜车站',one:'film',many:['rain','station']});
  await card.waitFor({state:'detached'});
  await page.setViewportSize({width:1440,height:1000});
  // Confirmation cards show the exact bound action. Retrying a failed submit retains choices.
  for(const approved of [false,true]){
   const item=await agent('create',{title:approved?'批准执行':'拒绝执行'});
   await agent('run',{session_id:item.id,message:approved?'批准后创建':'拒绝后不创建'});await select(item.id);await card.waitFor();
   assert((await card.locator('pre').textContent()).includes(approved?'批准后创建':'拒绝后不创建'));
   assert.equal((await api(`/projects/${project.id}/assets`,undefined,'GET')).length,0);
   await card.getByRole('radio',{name:approved?'允许执行':'拒绝执行',exact:true}).check();
   if(!approved){
    await page.route('**/api/v1/actions/agent/respond',route=>route.fulfill({status:503,json:{error:'请重试提交'}}),{times:1});
    await card.getByRole('button',{name:'提交回答'}).click();await card.getByRole('alert').waitFor();
    assert(await card.getByRole('radio',{name:'拒绝执行',exact:true}).isChecked());
   }
   await card.getByRole('button',{name:'提交回答'}).click();assert.equal((await settled(item.id)).status,'completed');await card.waitFor({state:'detached'});
   assert.equal((await api(`/projects/${project.id}/assets`,undefined,'GET')).length,approved?1:0);
  }
  // The floating assistant can submit the same form from another page.
  const floating=await agent('create',{title:'浮动表单'});await agent('run',{session_id:floating.id,message:'表单测试'});
  await page.evaluate(({pid,id})=>{
   localStorage.setItem(`spielberg-agent-float-session-${pid}`,id);
   localStorage.setItem(`spielberg-agent-float-speech-${pid}`,JSON.stringify({autoRead:false}));
  },{pid:project.id,id:floating.id});
  await page.reload();await page.getByRole('menuitem',{name:'素材库',exact:true}).click();
  await page.getByTestId('agent-float-button').click();
  card=page.getByTestId('agent-float-panel').getByTestId('agent-user-input');await card.waitFor();
  await card.getByRole('radio',{name:'否',exact:true}).check();
  await card.getByRole('textbox',{name:'补充故事要求'}).fill('从浮动窗口补充');
  await card.getByRole('radio',{name:'漫画',exact:true}).check();
  await card.getByRole('checkbox',{name:'车站',exact:true}).check();
  await page.screenshot({path:path.join(screenshots,'float.png'),fullPage:true});
  await card.getByRole('button',{name:'提交回答'}).click();assert.equal((await settled(floating.id)).status,'completed');
  await card.waitFor({state:'detached'});assert.deepEqual(errors,[]);
  console.log('PASS: four input modes, no defaults, reload, mobile, exact-action approve/reject, submit retry, floating assistant');
  console.log('Screenshots: '+screenshots);
 }catch(error){if(page)await page.screenshot({path:path.join(screenshots,'failure.png'),fullPage:true}).catch(()=>{});console.error('Screenshots: '+screenshots);throw error;}
 finally{if(browser)await browser.close();backend.kill('SIGTERM');await new Promise(resolve=>backend.exitCode!==null?resolve():backend.once('exit',resolve));model.closeAllConnections();await new Promise(resolve=>model.close(resolve));fs.rmSync(path.join(temp,'data'),{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
