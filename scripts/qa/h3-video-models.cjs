// Local UI fixtures only; no video generation service is contacted.
const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  page.setDefaultTimeout(12000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   const project={id:'qa-h3',name:'H3 模型测试',path:'/fixture',updated_at:'1'};
   const data={project,assets:[],episodes:[],prompts:[],media:[],settings:{video:{provider:'cast',base_url:'http://fixture:8001',api_key:'fixture-key',model:'minimax-h3'}}};
   window.__qaCalls=[];
   const original=window.fetch.bind(window);
   window.fetch=async(input,init={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(!url.pathname.startsWith('/api/v1/'))return original(input,init);
    let path=url.pathname.slice('/api/v1'.length);if(path.startsWith('/actions/'))path=path.slice('/actions'.length);
    const payload=init.body?JSON.parse(init.body):{};window.__qaCalls.push({path,payload});
    let result=null;
    if(path==='/projects')result=[project];
    if(path==='/project'||path==='/project/changes')result=structuredClone(data);
    if(path==='/tasks')result={items:[],has_more:false};
    if(path==='/settings'){data.settings=payload.settings;result={ok:true};}
    if(path==='/app/settings/load')result={projects_directory:'/fixture'};
    if(path==='/skills/list')result={items:[],directory:'/fixture/skills'};
    if(path==='/generations/video')result={id:101,name:'生成视频.mp4',kind:'video',path:'/fixture.mp4',created_at:'1'};
    return new Response(JSON.stringify({data:result}),{status:200,headers:{'Content-Type':'application/json'}});
   };
  });
  await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
  await page.locator('.side-bottom button').filter({hasText:'设置'}).click();
  await page.getByRole('tab',{name:/^视频生成/}).click();
  const settings=page.locator('.generation-channels-settings').filter({has:page.getByRole('heading',{name:'视频生成渠道',exact:true})});
  const presets=[['standard','MiniMax H3 · 标准 20 步'],['turbo8','MiniMax H3 · Turbo 8 步'],['pika','MiniMax H3 · Pika 4 步']];
  for(const [id,name] of presets){
   await settings.getByRole('button',{name:'添加模型',exact:true}).click();
   await page.getByRole('menuitem',{name,exact:true}).click();
   assert.equal(await settings.getByLabel('视频模型 ID',{exact:true}).inputValue(),id);
   assert.equal(await settings.getByRole('switch',{name:'接口接收 model 参数',exact:true}).getAttribute('aria-checked'),'true');
  }
  assert.equal(await settings.locator('.generation-channel-model').count(),4);
  await page.getByRole('button',{name:'保存配置',exact:true}).click();
  await page.getByText('接口配置已保存',{exact:true}).waitFor();
  const saved=await page.evaluate(()=>window.__qaCalls.filter(call=>call.path==='/settings').at(-1).payload.settings);
  const channel=saved.video.channels[0];
  assert.equal(channel.default_model_id,'minimax-h3');
  assert.equal(channel.api_key,'fixture-key');
  assert.deepEqual(channel.models.map(model=>model.id),['minimax-h3','standard','turbo8','pika']);
  assert(!channel.models[0].send_model);
  await page.getByRole('menuitem',{name:'工作台',exact:true}).click();
  await page.getByRole('tab',{name:'视频生成',exact:true}).click();
  const video=page.locator('.video-creation-split:visible');
  await video.getByRole('textbox',{name:'画面描述',exact:true}).fill('A red toy car drives slowly.');
  for(const [id,name] of presets){
   await video.getByRole('button',{name:'视频渠道与模型',exact:true}).click();
   const menu=page.getByRole('dialog',{name:'视频渠道与模型',exact:true});
   await menu.getByRole('button',{name:channel.name,exact:true}).click();
   await menu.getByRole('button').filter({has:page.getByText(name,{exact:true})}).click();
   const before=await page.evaluate(()=>window.__qaCalls.filter(call=>call.path==='/generations/video').length);
   await video.getByRole('button',{name:'生成视频',exact:true}).click();
   await page.waitForFunction(count=>window.__qaCalls.filter(call=>call.path==='/generations/video').length>count,before);
   const request=await page.evaluate(()=>window.__qaCalls.filter(call=>call.path==='/generations/video').at(-1).payload);
   assert.equal(request.channel_id,channel.id);assert.equal(request.model,id);
   assert(!('steps' in request));
  }
  await page.setViewportSize({width:390,height:844});
  await video.getByRole('button',{name:'视频渠道与模型',exact:true}).click();
  const menu=page.getByRole('dialog',{name:'视频渠道与模型',exact:true});
  await menu.waitFor();
  for(const [,name] of presets)await menu.getByText(name,{exact:true}).waitFor();
  assert(await menu.evaluate(element=>{const rect=element.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth;}));
  await menu.screenshot({animations:'disabled',path:'/tmp/spielberg-h3-models-mobile.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: existing channel adds/saves H3 standard20, turbo8 and pika; legacy default preserved; all three selection requests and mobile menu verified.');
 } catch(error){
  for(const page of browser.contexts().flatMap(context=>context.pages()))await page.screenshot({animations:'disabled',path:'/tmp/spielberg-h3-models-failure.png',fullPage:true}).catch(()=>{});
  throw error;
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
