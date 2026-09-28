// Isolated UI fixture: no real projects, credentials, or generation services are used.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
 const browser = await chromium.launch({headless:true});
 const page = await browser.newPage({reducedMotion:'reduce'});
 const errors=[]; page.on('pageerror', e=>errors.push(e.message));
 await page.addInitScript(() => {
  const long='长安十二时辰：雨夜追踪与角色命运的交汇';
  const project={id:'qa-project',name:long,path:'/fixture',updated_at:'刚刚'};
  const media={id:1,name:long+'.png',path:'/spielberg-logo-s.png',kind:'image',created_at:'1789990000'};
  const scenes=Array.from({length:3},(_,i)=>({id:i+1,title:`场景 ${i+1} · ${long}`,description:(long+'。').repeat(8),sort_order:i,first_media_id:1,last_media_id:null,reference_media_id:null,first_media:media,videos:[]}));
  const data={project,media:[media],roles:[{id:1,name:long,description:long.repeat(6),design_media_id:1,images:[media]}],episodes:[{id:1,title:long,description:long.repeat(3),scenes}],prompts:[{id:1,name:long.repeat(3),content:long.repeat(12),category:'角色'}],settings:{t2i:{provider:'openai',base_url:'https://example.com',model:'test',api_key:'',description:''}}};
  window.__qaCalls=[];
  window.__qaFailLoad=false;
  let draft=null;
  window.__TAURI_INTERNALS__={convertFileSrc:path=>path,invoke:async(command,args)=>{
   if(command==='api_request'){
    window.__qaCalls.push({path:args.path,payload:args.payload});
    if(args.path==='/project/changes')return {...data,project:args.payload.id==='second'?{...project,id:'second',name:'第二个项目'}:project};
    if(args.path==='/media/list')return {items:data.media.map(m=>({...m,usage_count:0})),total:data.media.length};
    if(args.path==='/media/thumbnail')return {path:'/spielberg-logo-s.png'};
    if(args.path==='/projects')return [project,{...project,id:'second',name:'第二个项目'}];
    if(args.path==='/project')return {...data,project:args.payload.id==='second'?{...project,id:'second',name:'第二个项目'}:project};
    if(args.path==='/tasks')return {items:[],has_more:false,next_cursor:null};
    if(args.path==='/scripts/load'){if(window.__qaFailLoad)throw new Error('读取测试失败');return draft;}
    if(args.path==='/scripts/save'){draft=args.payload.draft;return {ok:true};}
    if(args.path==='/generations/image')return {...media,id:2};
    if(args.path==='/media/import')return {...media,id:3};
    return {ok:true};
   }
   return null;
  }};
 });
 const report=[];
 async function check(name,width){
  await page.waitForTimeout(100);
  const overflow=await page.locator('.content').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth}));
  const dialogs=await page.locator('.arco-modal:visible, .arco-drawer:visible').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:el.scrollWidth,client:el.clientWidth};}));
  report.push({width,name,...overflow,dialogs});
  if(process.env.STRICT_UI) for(const r of dialogs){assert(r.left>=-1&&r.right<=width+1&&r.top>=-1&&r.bottom<=page.viewportSize().height+1,`${name} at ${width}: dialog outside viewport ${JSON.stringify(r)}`);assert(r.scroll<=r.client+1,`${name} dialog overflows`);}
 }
 async function nav(index){await page.locator('.nav .arco-menu-item').nth(index).click();}

 fs.mkdirSync('/tmp/spielberg-ui',{recursive:true});
 for(const width of [1920,1440,1280,1024,768,390]){
  await page.setViewportSize({width,height:width>=1280?1000:900});
  await require('./http-fixture.cjs')(page);
 await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
  await page.locator('.nav').waitFor();
  for(const [name,selector] of [['studio','.nav .arco-menu-item:nth-child(1)'],['episodes','.nav .arco-menu-item:nth-child(2)'],['assets','.nav .arco-menu-item:nth-child(3)'],['roles','.nav .arco-menu-item:nth-child(4)'],['tasks','.nav .arco-menu-item:nth-child(5)'],['prompts','.nav .arco-menu-item:nth-child(6)'],['settings','.side-bottom button']]){
   const target=page.locator(selector).first();if(!await target.isVisible()){report.push({width,name,hidden:true});continue;}
   await target.click();await page.waitForTimeout(100);
   const overflow=await page.locator('.content').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth}));
   report.push({width,name,...overflow});
   await page.screenshot({path:`/tmp/spielberg-ui/${width}-${name}.png`});
  }
  await nav(0);
  await page.getByText('02 · 图片生成',{exact:true}).click(); await check('image-generator',width); await page.screenshot({path:`/tmp/spielberg-ui/${width}-image-generator.png`});
  await page.getByText('03 · 剧集编排',{exact:true}).click(); await check('sequence',width); await page.screenshot({path:`/tmp/spielberg-ui/${width}-sequence.png`});
  await nav(1);
  await page.locator('.episode-top').getByRole('button',{name:'编辑',exact:true}).click(); await check('episode-editor',width);
  await page.locator('.arco-modal-close-icon').click();
  await page.locator('.scene-actions').first().getByRole('button',{name:'编辑',exact:true}).click();
  await check('scene-editor',width);
  await page.screenshot({path:`/tmp/spielberg-ui/${width}-scene-editor.png`});
  await page.locator('.scene-image-field').first().getByRole('button',{name:'生成图片',exact:true}).click(); await check('scene-image-modal',width);
  await page.locator('.arco-modal-close-icon').click();
  await page.locator('.arco-tabs-header').getByText('生成视频',{exact:true}).click(); await check('scene-video',width);
  await nav(3);
  await page.locator('.role-card').first().getByRole('button',{name:'设定',exact:true}).click();
  await check('role-editor',width);
  await page.locator('.arco-drawer-close-icon').click();
  await nav(2);
  await page.locator('.library-thumbnail').first().click(); await check('asset-preview',width);
  await page.locator('.arco-modal-close-icon').click();
  await page.getByRole('button',{name:'新建项目',exact:true}).click(); await check('create-project',width);
  await page.locator('.arco-modal').getByRole('button',{name:'取消',exact:true}).click();
 }
 // Behavioral checks use the same isolated IPC fixture.
 await page.setViewportSize({width:1100,height:920}); await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
 await page.locator('.nav').waitFor();
 await page.getByPlaceholder('为这一集命名').fill('测试脚本');
 await page.getByPlaceholder('描述场景中的动作、环境和镜头运动（必填）').fill('雨夜，主角走进长安城。');
 await page.getByRole('button',{name:'确定脚本，创建剧集',exact:true}).click();
 await page.locator('.episode-list').waitFor();
 assert(await page.evaluate(()=>window.__qaCalls.some(c=>c.path==='/scripts/publish'&&c.payload.draft.title==='测试脚本')));
 await page.locator('.scene-actions').first().getByRole('button',{name:'编辑',exact:true}).click();
 await page.locator('.scene-form-card input').fill('未保存场景');
 await nav(2);
 await page.getByText('放弃未保存的修改？',{exact:true}).waitFor();
 await page.getByRole('button',{name:'继续编辑',exact:true}).click();
 assert.equal(await page.locator('.scene-form-card input').inputValue(),'未保存场景');
 await nav(2); await page.getByRole('button',{name:'放弃修改',exact:true}).click();
 await page.locator('.library-grid').waitFor();
 await nav(3); await page.locator('.role-card').first().getByRole('button',{name:'设定',exact:true}).click();
 await page.locator('.arco-drawer').getByRole('button',{name:'文生图',exact:true}).click();
 await page.waitForFunction(()=>window.__qaCalls.some(c=>c.path==='/media/import'&&c.payload.role_id===1));
 await page.locator('.arco-drawer').getByRole('button',{name:'保存角色',exact:true}).click();
 await page.waitForFunction(()=>window.__qaCalls.some(c=>c.path==='/roles/update'&&c.payload.design_media_id===3));
 await page.locator('.side-bottom button').click();
 await page.locator('.settings-fields input').first().fill('https://changed.example.com');
 await nav(0); await page.getByRole('button',{name:'继续编辑',exact:true}).click();
 assert.equal(await page.locator('.settings-fields input').first().inputValue(),'https://changed.example.com');
 await page.getByRole('button',{name:'保存配置',exact:true}).click();
 await page.waitForFunction(()=>window.__qaCalls.some(c=>c.path==='/settings'));
 await nav(0);
 await page.getByText('02 · 图片生成',{exact:true}).click();
 await page.locator('.creation-panel .arco-select').nth(1).click();
 await page.locator('.arco-select-option').last().click();
 assert((await page.locator('.creation-panel textarea').inputValue()).length>0);
 await page.locator('.project-switch').click();
 await page.locator('.project-card').filter({hasText:'第二个项目'}).click();
 await page.getByPlaceholder('为这一集命名').waitFor();
 assert.equal(await page.locator('.topbar .crumb').innerText(),'第二个项目');
 console.log('Behavior checks passed: script publication, discard protection, role generation, settings save, prompt reuse, project switch.');
 fs.writeFileSync('/tmp/spielberg-ui/report.json',JSON.stringify({report,errors},null,2));
 console.log(JSON.stringify({layoutChecks:report.length,overflow:report.filter(r=>r.hidden||r.scroll>r.client+1),errors},null,2));
 await browser.close();
 if(process.env.STRICT_UI){assert.equal(errors.length,0);assert.equal(report.filter(r=>r.hidden||r.scroll>r.client+1).length,0);}
})().catch(e=>{console.error(e);process.exit(1)});
