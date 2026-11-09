// Real browser + real HTTP backend + local model fixture; no real projects or model charges.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const tool = (name, args, id) => ({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const deferred = () => { let resolve; const promise=new Promise(done=>{resolve=done;}); return {promise,resolve}; };

(async () => {
 const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spielberg-agent-ui-'));
 const screenshots = path.join(temp, 'screenshots'); fs.mkdirSync(screenshots);
 let speechAudio;
 const speechRequests=[];
 const modelSelections=[];
 const streamGates=new Map();
 const model = http.createServer(async (req,res) => {
  const chunks=[];for await(const chunk of req) chunks.push(chunk);
  const body=JSON.parse(Buffer.concat(chunks).toString());
  if(req.url.endsWith('/audio/speech')) {
   speechRequests.push({url:req.url,body});
   res.writeHead(200,{'Content-Type':'audio/wav'});res.end(speechAudio);return;
  }
  const lastUser=body.messages.findLastIndex(m=>m.role==='user');
  const prompt=body.messages[lastUser].content;
  const results=body.messages.slice(lastUser+1).filter(m=>m.role==='tool');
  if(prompt.includes('流式回复测试')) {
   assert.equal(body.stream,true,'Agent did not request streamed model output');
   const gate=deferred();streamGates.set(prompt,gate);
   res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
   const event=delta=>res.write(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:null}]})}\n\n`);
   event({role:'assistant',content:'正在逐步整理雨夜故事。'});
   await gate.promise;
   event({content:'故事已整理完成。'});
   res.write(`data: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:8,total_tokens:18}})}\n\n`);
   res.end('data: [DONE]\n\n');return;
  }
  let message;
  if(body.tool_choice==='none') {
   message={role:'assistant',content:'本轮执行已暂停，已完成的操作已保留。'};
  } else if(prompt.includes('导航后台执行测试')) {
   message={role:'assistant',content:'导航后的后台执行已完成。'};
  } else if(prompt.includes('渠道切换测试')) {
   modelSelections.push({url:req.url,model:body.model,authorization:req.headers.authorization});
   message={role:'assistant',content:`渠道切换测试完成：${body.model}`};
  } else if(prompt.includes('TTS 测试')) {
   assert(body.tools.find(item=>item.function.name==='app_action').function.parameters.properties.operation.enum.includes('generations/tts'));
   const selected=prompt.includes('指定');
   const calls=[tool('app_describe',{operation:'generations/tts'},'tts-describe'),tool('app_action',{operation:'settings/read'},'tts-settings'),
    tool('app_action',{operation:'generations/tts',data:{text:'雨停了，故事才刚刚开始。',format:'wav',...(selected?{channel_id:'speech-selected',model:'custom-narrator',voice:'nova',speed:1.25,instructions:'平静地讲述'}:{})}},'tts-generate')];
   message=results.length<calls.length?{role:'assistant',content:null,tool_calls:[calls[results.length]]}:{role:'assistant',content:'配音已生成，可直接试听。'};
  } else if(prompt.includes('预算测试')) {
   message={role:'assistant',content:null,tool_calls:[tool('get_project',{},'budget-first'),tool('get_project',{},'budget-skipped')]};
  } else if(prompt.includes('SVG 测试')) {
   message=results.length ? {role:'assistant',content:'SVG 已保存到素材库。'} : {role:'assistant',content:null,tool_calls:[tool('app_action',{operation:'media/create-svg',data:{name:'Agent 矢量图',svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140"><rect width="240" height="140" rx="20" fill="#315efb"/><circle cx="120" cy="70" r="40" fill="gold"/><text x="120" y="78" text-anchor="middle" font-size="20">SVG</text></svg>'}},'svg-create')]};
  } else if(prompt.includes('停止测试')) {
   await new Promise(resolve=>setTimeout(resolve,1800));
   message={role:'assistant',content:null,tool_calls:[tool('app_request',{method:'POST',resource:'assets',data:{name:'不应创建'}},'cancel-write')]};
  } else if(!results.length) {
   message={role:'assistant',content:null,tool_calls:[
    tool('update_plan',{plan:[{step:'创建雨夜故事的角色与剧本',status:'in_progress'},{step:'检查创建结果',status:'pending'}]},'plan'),
    tool('app_request',{method:'POST',resource:'assets',data:{name:'Agent 主角',description:'雨夜车站的旅人'}},'role'),
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
 let browser,page;
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
  page=await browser.newPage({viewport:{width:1440,height:1000}});
  // Exercise the current frontend build even when the backend embeds older assets.
  await page.route(base+'/**', async route => {
   const pathname = new URL(route.request().url()).pathname;
   if (pathname !== '/' && !pathname.startsWith('/assets/')) return route.continue();
   const file = path.resolve(__dirname, '../../dist', pathname === '/' ? 'index.html' : pathname.slice(1));
   if (!fs.existsSync(file)) return route.continue();
   await route.fulfill({path:file});
  });
  const failures=[];page.on('pageerror',error=>failures.push(error.message));
  // A failed initial read must be retryable without losing the composer's draft.
  let failInitialRead=true;
  await page.route('**/api/v1/actions/agent/sessions',async route=>{
   if(failInitialRead){failInitialRead=false;await route.fulfill({status:503,json:{error:'会话读取暂时不可用'}});}
   else await route.continue();
  });
  await page.goto(base);
  await page.getByRole('menuitem',{name:'Agent 助手',exact:true}).click();
  await page.getByTestId('agent-workspace').waitFor();
  await page.getByTestId('agent-reload').waitFor();
  await page.getByTestId('agent-composer').fill('恢复后保留的草稿');
  assert(await page.getByTestId('agent-send').isDisabled());
  await page.screenshot({path:path.join(screenshots,'load-retry.png'),fullPage:true});
  await page.getByTestId('agent-reload').click();
  await page.waitForFunction(()=>!document.querySelector('[data-testid="agent-send"]')?.disabled);
  assert.equal(await page.getByTestId('agent-composer').inputValue(),'恢复后保留的草稿');
  await page.unroute('**/api/v1/actions/agent/sessions');
  // A rejected first run must retain the newly created session and its draft.
  let firstSendCreates=0;
  const firstSendSessionIds=[];
  const countFirstCreate=async route=>{firstSendCreates++;await route.continue();};
  const rejectFirstRun=async route=>{
   firstSendSessionIds.push(route.request().postDataJSON().session_id);
   if(firstSendSessionIds.length===1)return route.fulfill({status:503,json:{error:'首次启动暂时失败，请重试'}});
   return route.continue();
  };
  await page.route('**/api/v1/actions/agent/create',countFirstCreate);
  await page.route('**/api/v1/actions/agent/run',rejectFirstRun);
  await page.getByTestId('agent-composer').fill('请创建雨夜故事的主角和剧本');
  await page.getByTestId('agent-send').click();
  await page.getByRole('alert').getByText('Error: 首次启动暂时失败，请重试',{exact:true}).waitFor();
  assert.equal(await page.getByTestId('agent-composer').inputValue(),'请创建雨夜故事的主角和剧本');
  const firstSendSessions=(await api('/actions/agent/sessions',{project_id:project.id})).items;
  assert.equal(firstSendSessions.length,1,'A failed first run should leave one reusable session');
  await page.getByTestId(`agent-session-${firstSendSessions[0].id}`).waitFor();
  assert.equal(await page.getByTestId(`agent-session-${firstSendSessions[0].id}`).getAttribute('aria-current'),'page');
  await page.getByTestId('agent-send').click();
  await page.getByRole('link',{name:'参考资料',exact:true}).waitFor({timeout:15000});
  assert.equal(firstSendCreates,1,'Retrying the first run created another empty session');
  assert.deepEqual(firstSendSessionIds,[firstSendSessions[0].id,firstSendSessions[0].id]);
  assert.equal((await api('/actions/agent/sessions',{project_id:project.id})).items.length,1);
  assert.equal(await page.getByTestId('agent-composer').inputValue(),'');
  await page.unroute('**/api/v1/actions/agent/create',countFirstCreate);
  await page.unroute('**/api/v1/actions/agent/run',rejectFirstRun);
  await page.getByTestId('agent-plan').getByText('2/2',{exact:true}).waitFor();
  assert(await page.locator('.agent-tool summary > small').getByText('资产库',{exact:true}).count()>0);
  assert.equal(await page.locator('.agent-tool summary > small').getByText('roles',{exact:true}).count(),0);
  const operationGroup = page.locator('.agent-tool-group');
  assert.equal(await operationGroup.count(),1,'Consecutive operations should share one group');
  assert.equal(await operationGroup.evaluate(element=>element.open),false,'Operation history should start collapsed');
  assert.equal(await operationGroup.locator('.agent-tool').count(),6);
  await operationGroup.locator(':scope > summary').click();
  await operationGroup.locator('.agent-tool').first().waitFor({state:'visible'});
  await operationGroup.locator('.agent-tool summary').first().click();
  assert.equal(await operationGroup.locator('.agent-tool').first().evaluate(element=>element.open),true);
  await operationGroup.locator(':scope > summary').click();
  const originalSession=(await api('/actions/agent/sessions',{project_id:project.id})).items[0];
  assert.equal(await page.getByRole('link',{name:'参考资料',exact:true}).getAttribute('href'),'https://example.com/reference');
  const roles=await api(`/projects/${project.id}/assets`,undefined,'GET');assert.equal(roles.length,1);assert.equal(roles[0].name,'Agent 主角');
  const scripts=await api(`/projects/${project.id}/screenplays`,undefined,'GET');assert.equal(scripts.length,1);
  await page.screenshot({path:path.join(screenshots,'desktop.png'),fullPage:true});
  // Reproduce an already migrated history: the asset exists on this machine,
  // while its original generation result still contains a Windows path.
  const upload=await fetch(`${base}/api/v1/projects/${project.id}/media/upload?name=migrated.png`,{
   method:'POST',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII=','base64')
  });
  assert(upload.ok);const migrated=(await upload.json()).data;
  // Real playable files exercise media loading, rather than only checking tags.
  const audioFile=path.join(temp,'preview.wav'),videoFile=path.join(temp,'preview.mp4');
  for(const args of [
   ['-f','lavfi','-i','sine=frequency=440:duration=2','-c:a','pcm_s16le',audioFile],
   ['-f','lavfi','-i','color=c=blue:s=240x140:d=2','-c:v','libx264','-pix_fmt','yuv420p',videoFile],
  ]) {
   const generated=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{encoding:'utf8'});
   assert.equal(generated.status,0,generated.stderr);
  }
  const uploadFixture=async(file)=>{
   const response=await fetch(`${base}/api/v1/projects/${project.id}/media/upload?name=${encodeURIComponent(path.basename(file))}`,{method:'POST',body:fs.readFileSync(file)});
   assert(response.ok);return (await response.json()).data;
  };
  const audio=await uploadFixture(audioFile),video=await uploadFixture(videoFile);
  speechAudio=fs.readFileSync(audioFile);
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
audio=json.loads(sys.argv[4]);video=json.loads(sys.argv[5]);pid=sys.argv[6]
def output(operation,value,status='completed'):
 return {'role':'tool','tool_name':'app_action','status':status,'arguments':{'operation':operation,'data':{'image_media_ids':[media['id']]}},'content':json.dumps(value)}
messages.extend([
 output('generations/video',{'data':{'media':dict(video,path=r'C:\\old\\preview.mp4')}}),
 output('generations/tts',dict(audio,path=r'C:\\old\\preview.wav')),
 output('generations/image',media,'failed'),
 output('tasks',{'items':[{'status':'running','result':media}]}),
 output('tasks',{'items':[{'status':'completed','result':audio}]}),
 output('editor/export',audio),
 output('episodes/merge',video),
 output('media/video-frame',media),
 {'role':'tool','tool_name':'app_request','status':'completed','arguments':{'resource':'media','method':'GET'},'content':json.dumps({'items':[media,audio,video]})},
 {'role':'assistant','content':f'[试听音频](/api/v1/projects/{pid}/media/{audio["id"]}/content)\\n\\n[播放视频](/media?path={video["path"]})\\n\\n![引用图片][picture]\\n\\n[picture]: /api/v1/projects/{pid}/media/{media["id"]}/content'},
])
c.execute('UPDATE agent_sessions SET messages=? WHERE id=?',(json.dumps(messages),sys.argv[2]));c.commit()
`,path.join(project.path,'spielberg.sqlite'),originalSession.id,JSON.stringify(migrated),JSON.stringify(audio),JSON.stringify(video),project.id],{encoding:'utf8'});
  assert.equal(seed.status,0,seed.stderr);
  await page.reload();await page.getByRole('menuitem',{name:'Agent 助手',exact:true}).click();
  await page.getByRole('link',{name:'参考资料',exact:true}).waitFor();
  await page.getByTestId('agent-plan').getByText('2/2',{exact:true}).waitFor();
  const thumbnail=page.locator('.agent-generated-images img');
  await thumbnail.waitFor();
  await page.waitForFunction(()=>document.querySelector('.agent-generated-images img')?.naturalWidth>0);
  assert.equal(new URL(await thumbnail.getAttribute('src'),base).searchParams.get('path'),migrated.path);
  await page.locator('.agent-media-results').getByRole('button',{name:'预览 migrated.png',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.image-preview-full img')?.naturalWidth>0);
  await page.screenshot({path:path.join(screenshots,'migrated-image.png'),fullPage:true});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.agent-media-results img').count(),1,'Only successful image generation should have a preview');
  assert.equal(await page.locator('.agent-media-results audio').count(),1,'Media queries, completed tasks and exports must not add audio previews');
  assert.equal(await page.locator('.agent-media-results video').count(),1,'Media queries and merges must not add video previews');
  const inlineAudio=page.locator('.agent-media-results audio');
  assert.equal(new URL(await inlineAudio.getAttribute('src'),base).searchParams.get('path'),audio.path);
  await inlineAudio.evaluate(async player=>{await player.play();player.pause();});
  const inlineVideo=page.locator('.agent-media-results video');
  assert.equal(new URL(await inlineVideo.getAttribute('src'),base).searchParams.get('path'),video.path);
  await inlineVideo.evaluate(async player=>{await player.play();player.pause();});
  await page.locator('.agent-media-results').getByRole('button',{name:'放大预览 preview.mp4',exact:true}).click();
  await page.getByRole('dialog').getByLabel('视频画布').waitFor();
  await page.waitForFunction(()=>document.querySelector('.video-preview-viewport video')?.videoWidth>0);
  await page.screenshot({path:path.join(screenshots,'video-preview.png'),fullPage:true});
  await page.getByRole('button',{name:'关闭视频预览',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  assert.equal(await page.locator('.agent-message-content audio').count(),0,'Ordinary audio links must remain links');
  assert.equal(await page.locator('.agent-message-content video').count(),0,'Ordinary video links must remain links');
  await page.getByRole('link',{name:'试听音频',exact:true}).waitFor();
  await page.getByRole('link',{name:'播放视频',exact:true}).waitFor();
  await page.locator('.agent-message-content').getByRole('button',{name:'预览 migrated.png',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.image-preview-full img')?.naturalWidth>0);
  await page.keyboard.press('Escape');
  // Broken external media should offer the original URL instead of a blank card.
  await page.route('**/broken-preview.png',route=>route.abort());
  const brokenSession=await api('/actions/agent/create',{project_id:project.id});
  const brokenSeed=spawnSync('python3',['-c',`
import json,sqlite3,sys
c=sqlite3.connect(sys.argv[1]);messages=[{'role':'assistant','content':'![加载失败图片](https://example.com/broken-preview.png)'}]
c.execute('UPDATE agent_sessions SET messages=? WHERE id=?',(json.dumps(messages),sys.argv[2]));c.commit()
`,path.join(project.path,'spielberg.sqlite'),brokenSession.id],{encoding:'utf8'});
  assert.equal(brokenSeed.status,0,brokenSeed.stderr);
  await page.reload();await page.getByRole('menuitem',{name:'Agent 助手',exact:true}).click();
  await page.getByTestId(`agent-session-${brokenSession.id}`).click();
  await page.getByRole('link',{name:'打开原文件',exact:true}).waitFor();
  await page.getByTestId(`agent-session-${originalSession.id}`).click();
  await page.getByTestId('agent-plan').waitFor();
  await page.getByTestId('agent-settings').click();
  await page.getByRole('dialog').getByText('Agent 设置',{exact:true}).waitFor();
  await page.screenshot({path:path.join(screenshots,'settings.png'),fullPage:true,animations:'disabled'});
  const stepLimit = page.getByRole('spinbutton',{name:'最多执行步数',exact:true});
  assert.equal(await stepLimit.getAttribute('max'),'128');
  await stepLimit.fill('128');
  await page.getByRole('dialog').getByRole('button',{name:'保存设置',exact:true}).click();
  await page.locator('.agent-settings-modal:visible').waitFor({state:'hidden'});
  assert.equal((await api('/actions/agent/config',{project_id:project.id})).max_steps,128);
  // A saved conversation remains usable after visiting the app's normal editors.
  await page.getByRole('menuitem',{name:'资产库',exact:true}).click();
  await page.locator('.role-card').getByText('Agent 主角',{exact:true}).waitFor();
  await page.getByRole('menuitem',{name:'Agent 助手',exact:true}).click();
  await page.getByTestId('agent-new-session').click();
  await page.getByTestId('agent-composer').fill('停止测试');
  await page.getByTestId('agent-send').click();
  await page.getByTestId('agent-stop').click();
  await page.waitForTimeout(2100);
  assert.equal((await api(`/projects/${project.id}/assets`,undefined,'GET')).length,1);
  await api('/actions/agent/config/save',{project_id:project.id,config:{max_steps:1}});
  await page.getByTestId('agent-new-session').click();
  await page.getByTestId('agent-composer').fill('预算测试');
  await page.getByTestId('agent-send').click();
  await page.locator('.agent-limit-notice').waitFor();
  assert.equal(await page.locator('.agent-tool-status.skipped').textContent(),'未执行');
  // Text is visible before the model finishes; cancelled partial output remains
  // visibly interrupted, and typing a follow-up never discards that draft.
  for(const cancelStream of [false,true]) {
   const prompt=`流式回复测试${cancelStream?'中断':'完成'}`;
   await page.getByTestId('agent-new-session').click();
   await page.getByTestId('agent-composer').fill(prompt);
   await page.getByTestId('agent-send').click();
   const partial=page.locator('.agent-message.is-assistant[data-status="streaming"]');
   await partial.getByText('正在逐步整理雨夜故事。',{exact:true}).waitFor({timeout:15000});
   await partial.getByText('正在回复',{exact:true}).waitFor();
   if(!cancelStream)await page.screenshot({path:path.join(screenshots,'streaming.png'),fullPage:true});
   await page.getByTestId('agent-composer').fill('下一轮继续使用这份草稿');
   if(cancelStream) {
    await page.getByTestId('agent-stop').click();
    await page.locator('.agent-message[data-status="interrupted"]').getByText('回复已中断',{exact:true}).waitFor();
    streamGates.get(prompt).resolve();
    await page.getByTestId('agent-send').waitFor();
    assert.equal(await page.getByText('故事已整理完成。',{exact:true}).count(),0);
    await page.screenshot({path:path.join(screenshots,'stream-interrupted.png'),fullPage:true});
   } else {
    streamGates.get(prompt).resolve();
    await page.locator('.agent-message[data-status="completed"]').getByText('正在逐步整理雨夜故事。故事已整理完成。',{exact:true}).waitFor();
    await page.getByTestId('agent-send').waitFor();
   }
   assert.equal(await page.getByTestId('agent-composer').inputValue(),'下一轮继续使用这份草稿');
   assert.equal(await page.locator('.agent-message[data-status="streaming"]').count(),0);
  }
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
  const svgAsset=(await api(`/projects/${project.id}/media?kind=image`,undefined,'GET')).items.find(item=>item.name==='Agent 矢量图.svg');
  assert(svgAsset && svgAsset.kind==='image');
  const svgResponse=await fetch(`${base}/api/v1/projects/${project.id}/media/${svgAsset.id}/content`);
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
  // Execute real Agent tool calls against a local TTS fixture, with default and
  // explicitly selected channels. No paid model or speech service is contacted.
  await api('/actions/settings',{project_id:project.id,settings:{
   llm:{base_url:`http://127.0.0.1:${model.address().port}/v1`,model:'qa-tool-model',api_key:'ui-test-private-key'},
   tts:{default_channel_id:'speech-default',channels:[
    {id:'speech-default',name:'默认配音',provider:'openai',base_url:`http://127.0.0.1:${model.address().port}/default`,models:[{id:'tts-1',profile:'openai-tts'}]},
    {id:'speech-selected',name:'指定配音',provider:'openai',base_url:`http://127.0.0.1:${model.address().port}/selected`,models:[{id:'custom-narrator',profile:'openai-tts-instruct'}]},
   ]},
  }});
  for(const mode of ['默认','指定']) {
   await page.getByTestId('agent-new-session').click();
   await page.getByTestId('agent-composer').fill(`TTS 测试 ${mode}：为雨夜故事生成配音`);
   await page.getByTestId('agent-send').click();
   await page.getByText('配音已生成，可直接试听。',{exact:true}).waitFor({timeout:15000});
   const speechPlayer=page.locator('.agent-media-results audio');
   await speechPlayer.waitFor();await speechPlayer.evaluate(async player=>{await player.play();player.pause();});
   assert(await page.locator('.agent-tool summary > small').getByText('合成配音',{exact:true}).count()>0);
  }
  assert.deepEqual(speechRequests,[
   {url:'/default/v1/audio/speech',body:{model:'tts-1',input:'雨停了，故事才刚刚开始。',voice:'alloy',response_format:'wav'}},
   {url:'/selected/v1/audio/speech',body:{model:'custom-narrator',input:'雨停了，故事才刚刚开始。',voice:'nova',response_format:'wav',speed:1.25,instructions:'平静地讲述'}},
  ]);
  const speechMedia=(await api(`/projects/${project.id}/media?kind=audio`,undefined,'GET')).items.filter(item=>item.name.startsWith('TTS-'));
  assert.equal(speechMedia.length,2);
  await page.screenshot({path:path.join(screenshots,'agent-tts.png'),fullPage:true});
  await page.reload();await page.getByRole('menuitem',{name:'Agent 助手',exact:true}).click();
  await page.locator('.agent-media-results audio').waitFor();
  // The composer uses the same channel/model cascade as image/video generation.
  // Verify actual endpoint, model and credentials, without changing shared defaults.
  const modelBase=`http://127.0.0.1:${model.address().port}`;
  await api('/actions/settings',{project_id:project.id,settings:{llm:{default_channel_id:'llm-default',channels:[
   {id:'llm-default',name:'默认渠道',provider:'openai',base_url:modelBase+'/default/v1',api_key:'default-model-key',models:[{id:'qa-default',name:'默认模型',profile:'openai-chat'}]},
   {id:'llm-other',name:'备用渠道',provider:'deepseek',base_url:modelBase+'/other/v1',api_key:'selected-model-key',default_model_id:'qa-first',models:[
    {id:'qa-first',name:'备用模型',profile:'deepseek-chat'},
    {id:'qa-selected',name:'指定模型',profile:'deepseek-chat',base_url:modelBase+'/model/v1'},
   ]},
  ]}}});
  await page.reload();await page.getByRole('menuitem',{name:'Agent 助手',exact:true}).click();
  const picker=page.getByRole('button',{name:'Agent渠道与模型',exact:true});
  const cascade=page.getByRole('dialog',{name:'Agent渠道与模型',exact:true});
  await picker.getByText('默认模型',{exact:true}).waitFor();
  for(const width of [1440,390,320]) {
   await page.setViewportSize({width,height:900});
   await picker.click();await cascade.waitFor();
   await cascade.getByRole('button',{name:'备用渠道',exact:true}).click();
   await cascade.getByText('指定模型',{exact:true}).waitFor();
   await page.screenshot({path:path.join(screenshots,`model-cascade-${width}.png`),fullPage:true,animations:'disabled'});
   const bounds=await cascade.boundingBox();assert(bounds && bounds.x>=0 && bounds.x+bounds.width<=width+1 && bounds.y>=0 && bounds.y+bounds.height<=901,`model picker outside viewport at ${width}`);
   assert(await picker.evaluate(button=>{const rect=button.getBoundingClientRect();return rect.x>=0 && rect.right<=innerWidth;}));
   assert.equal(await page.locator('.agent-settings-modal:visible').count(),0);
   await cascade.press('Escape');await cascade.waitFor({state:'hidden'});
   assert(await picker.evaluate(button=>button===document.activeElement));
  }
  await page.setViewportSize({width:1440,height:1000});
  const pickModel=async(channel,name)=>{
   await picker.click();await cascade.getByRole('button',{name:channel,exact:true}).click();
   await cascade.getByRole('button').filter({has:page.getByText(name,{exact:true})}).click();
   await cascade.waitFor({state:'hidden'});await picker.getByText(name,{exact:true}).waitFor();
  };
  const runSelection=async(model)=>{
   await page.getByTestId('agent-new-session').click();
   await page.getByTestId('agent-composer').fill('渠道切换测试');
   await page.getByTestId('agent-send').click();
   await page.getByText(`渠道切换测试完成：${model}`,{exact:true}).waitFor();
   assert.equal(await picker.isDisabled(),false);
  };
  await pickModel('备用渠道','指定模型');
  await page.getByTestId('agent-settings').click();
  await page.getByLabel('模型请求等待时间（秒）',{exact:true}).fill('120');
  const settingsResponse=page.waitForResponse(response=>response.url().endsWith('/agent/config/save'));
  await page.getByRole('button',{name:'保存设置',exact:true}).click();
  const savedSettings=await settingsResponse;assert(savedSettings.ok(),await savedSettings.text());
  await page.locator('.agent-settings-modal:visible').waitFor({state:'hidden'});
  await picker.getByText('指定模型',{exact:true}).waitFor();
  await runSelection('qa-selected');
  assert.equal((await api('/actions/agent/config',{project_id:project.id})).model,'qa-default');
  await pickModel('默认渠道','默认模型');await runSelection('qa-default');
  await api('/actions/agent/config/save',{project_id:project.id,config:{inherit_llm:false,base_url:modelBase+'/independent/v1',model:'qa-own',api_key:'own-model-key'}});
  await page.reload();await page.getByRole('menuitem',{name:'Agent 助手',exact:true}).click();
  await picker.getByText('Agent 独立配置',{exact:true}).waitFor();
  await pickModel('备用渠道','备用模型');await runSelection('qa-first');
  await pickModel('Agent 独立配置','qa-own');await runSelection('qa-own');
  assert.deepEqual(modelSelections,[
   {url:'/model/v1/chat/completions',model:'qa-selected',authorization:'Bearer selected-model-key'},
   {url:'/default/v1/chat/completions',model:'qa-default',authorization:'Bearer default-model-key'},
   {url:'/other/v1/chat/completions',model:'qa-first',authorization:'Bearer selected-model-key'},
   {url:'/independent/v1/chat/completions',model:'qa-own',authorization:'Bearer own-model-key'},
  ]);
  // Hold a session read across cancellation. This reproduces the loading race
  // deterministically and keeps the tool active until its final result arrives.
  const idle={id:'ui-idle',title:'空闲会话',status:'idle',messages:[],updated_at:'1',execution:{active:false}};
  const active={id:'ui-active',title:'停止竞态会话',status:'running',messages:[{role:'user',content:'请执行操作'},{role:'tool',tool_name:'get_project',tool_call_id:'late-result',status:'running',content:''}],updated_at:'2',execution:{active:true,phase:'tool',active_tool:'get_project'}};
  const stopped={...active,status:'cancelled',execution:{active:true,phase:'stopping'}};
  let current=active,holdFirstRead=true,unexpectedRuns=0;
  const heldRead=deferred(),readStarted=deferred();
  const fixtureRoute=async route=>{
   const action=new URL(route.request().url()).pathname.split('/').at(-1);
   const request=route.request().postDataJSON();
   if(action==='sessions')return route.fulfill({json:{data:{items:[idle,{...current,messages:[]}]}}});
   if(action==='session') {
    if(request.session_id===idle.id)return route.fulfill({json:{data:idle}});
    if(holdFirstRead){holdFirstRead=false;readStarted.resolve();await heldRead.promise;return route.fulfill({json:{data:active}});}
    return route.fulfill({json:{data:current}});
   }
   if(action==='cancel'){current=stopped;return route.fulfill({json:{data:stopped}});}
   if(action==='run'){unexpectedRuns++;return route.fulfill({status:409,json:{error:'此会话仍在停止中'}});}
   return route.continue();
  };
  await page.route('**/api/v1/actions/agent/*',fixtureRoute);
  await page.evaluate(({pid,id})=>localStorage.setItem(`spielberg-agent-session-${pid}`,id),{pid:project.id,id:idle.id});
  await page.reload();await page.getByRole('menuitem',{name:'Agent 助手',exact:true}).click();
  await page.getByTestId(`agent-session-${active.id}`).click();await readStarted.promise;
  await page.getByText('正在读取会话',{exact:true}).waitFor();
  await page.getByTestId('agent-stop').click();
  await page.getByText('正在读取会话',{exact:true}).waitFor({state:'hidden'});
  assert(await page.getByTestId('agent-stop').isDisabled());
  assert(await page.getByRole('button',{name:`删除会话 ${active.title}`,exact:true}).isDisabled());
  await page.getByTestId('agent-composer').fill('停止完成后继续');
  await page.getByTestId('agent-composer').press('Enter');
  assert.equal(unexpectedRuns,0,'A new run was sent while cancellation was draining');
  await page.screenshot({path:path.join(screenshots,'stopping.png'),fullPage:true});
  heldRead.resolve();
  await page.getByText('正在停止，等待当前操作结束',{exact:true}).waitFor();
  current={...stopped,messages:[active.messages[0],{...active.messages[1],status:'completed',content:'工具最终完成'}],execution:{active:false,phase:'cancelled'}};
  await page.getByTestId('agent-send').waitFor();
  await page.getByText('工具最终完成',{exact:true}).waitFor({state:'attached'});
  assert.equal(await page.getByTestId('agent-composer').inputValue(),'停止完成后继续');
  assert.equal(await page.getByTestId('agent-send').isDisabled(),false);
  assert.equal(await page.getByRole('button',{name:`删除会话 ${active.title}`,exact:true}).isDisabled(),false);
  assert.equal(await page.locator('.agent-loading').count(),0);
  await page.unroute('**/api/v1/actions/agent/*',fixtureRoute);
  // Leaving the workspace while its first create is pending must not cancel
  // the already submitted instruction before the backend can start its run.
  const navigationCreateStarted=deferred(),releaseNavigationCreate=deferred();
  let navigationSession;
  const noSessions=route=>route.fulfill({json:{data:{items:[]}}});
  const delayedCreate=async route=>{
   const response=await route.fetch();
   navigationSession=(await response.json()).data;
   navigationCreateStarted.resolve();
   await releaseNavigationCreate.promise;
   return route.fulfill({response});
  };
  await page.route('**/api/v1/actions/agent/sessions',noSessions);
  await page.route('**/api/v1/actions/agent/create',delayedCreate);
  await page.reload();await page.getByRole('menuitem',{name:'Agent 助手',exact:true}).click();
  await page.getByTestId('agent-composer').fill('导航后台执行测试');
  await page.getByTestId('agent-send').click();
  await navigationCreateStarted.promise;
  await page.getByRole('menuitem',{name:'素材库',exact:true}).click();
  await page.getByTestId('agent-workspace').waitFor({state:'detached'});
  const navigationRun=page.waitForRequest(request=>request.url().endsWith('/api/v1/actions/agent/run') && request.postDataJSON().message==='导航后台执行测试',{timeout:10000});
  releaseNavigationCreate.resolve();
  assert.equal((await navigationRun).postDataJSON().session_id,navigationSession.id);
  await page.unroute('**/api/v1/actions/agent/sessions',noSessions);
  await page.unroute('**/api/v1/actions/agent/create',delayedCreate);
  let navigationResult;
  for(let attempt=0;attempt<100;attempt++) {
   navigationResult=await api('/actions/agent/session',{project_id:project.id,session_id:navigationSession.id});
   if(navigationResult.status==='completed')break;
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(navigationResult.status,'completed','Navigating away prevented the submitted instruction from completing');
  assert(navigationResult.messages.some(message=>message.content==='导航后的后台执行已完成。'));
  assert.deepEqual(failures,[]);
  console.log('PASS: Agent streaming and interrupted replies; first-run retry without duplicate sessions; navigation during initial send; load recovery and draft retention; cancellation during selection, draining and final tool results; channel/model routing; generation previews; TTS; SVG; session order, plans and desktop/mobile/dark themes');
  console.log('Screenshots: '+screenshots);
 } catch(error) {
  if(page && !page.isClosed()) {
   await page.screenshot({path:path.join(screenshots,'failure.png'),fullPage:true}).catch(()=>{});
   console.error('Visible dialogs:',await page.getByRole('dialog').allTextContents());
   console.error('Failure screenshot: '+path.join(screenshots,'failure.png'));
  }
  throw error;
 } finally {
  for(const gate of streamGates.values())gate.resolve();
  if(browser)await browser.close();
  server.kill('SIGTERM');await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));
  model.closeAllConnections();await new Promise(resolve=>model.close(resolve));
  // Preserve screenshots only; remove all disposable project data.
  fs.rmSync(path.join(temp,'data'),{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
