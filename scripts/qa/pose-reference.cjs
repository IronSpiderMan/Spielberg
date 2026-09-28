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
    if(args.path==='/generations/image'){
     const index=window.__qaCalls.filter(c=>c.path==='/generations/image').length;
     await new Promise(resolve=>setTimeout(resolve,150));
     if(window.__qaFailure==='all'||(window.__qaFailure==='partial'&&index%2===0))throw new Error('测试生成失败');
     return {...media,id:index+1};
    }
    if(args.path==='/media/pose-reference'){if(window.__poseFail)throw new Error('保存失败');return {...media,id:99,name:'3D姿势参考.png'};}
    if(args.path==='/media/import')return {...media,id:3};
    return {ok:true};
   }
   return null;
  }};
 });

 await require('./http-fixture.cjs')(page);
 await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
 await page.getByText('02 · 图片生成',{exact:true}).click();

 await page.locator('.creation-split .arco-select').first().click();
 await page.getByRole('option',{name:'图生图',exact:true}).click();
 await page.getByRole('button',{name:'3D 人体 · 摆姿势参考'}).click();
 await page.locator('.pose-viewport canvas').waitFor({timeout:10000}).catch(async e=>{console.log(errors);console.log(await page.locator('body').innerText());await page.screenshot({path:'/tmp/spielberg-pose-error.png'});throw e;});
 await page.getByRole('button',{name:'添加人物',exact:true}).click();
 assert.equal(await page.locator('select[aria-label="当前人物"] option').count(),2);
 await page.getByLabel('动作预设').selectOption('举手');
 await page.getByLabel('编辑关节').selectOption('左肘');
 await page.getByRole('slider',{name:'前后弯曲',exact:true}).fill('-80');
 await page.getByRole('button',{name:'正面',exact:true}).click();
 await page.screenshot({path:'/tmp/spielberg-pose-editor.png'});
 await page.evaluate(()=>{window.__poseFail=true;});
 await page.getByRole('button',{name:'截图并用作参考图',exact:true}).click();
 await page.getByText('保存姿势截图失败：', {exact:false}).waitFor();
 await page.evaluate(()=>{window.__poseFail=false;});
 await page.getByRole('button',{name:'截图并用作参考图',exact:true}).click();
 await page.locator('.creation-reference-chip').filter({hasText:'3D姿势参考.png'}).waitFor();
 const capture=await page.evaluate(()=>window.__qaCalls.find(c=>c.path==='/media/pose-reference'));
 assert.ok(capture.payload.data_url.startsWith('data:image/png;base64,'));
 const png=Buffer.from(capture.payload.data_url.split(',')[1],'base64');
 assert.equal(png.readUInt32BE(16),832);assert.equal(png.readUInt32BE(20),480);
 require('node:fs').writeFileSync('/tmp/spielberg-pose-reference.png',png);
 await page.locator('.creation-split textarea').fill('两个人物，按照参考姿势');
 await page.getByRole('button',{name:'生成 1 张图片',exact:true}).click();
 await page.locator('.image-result-card').waitFor();
 const generation=await page.evaluate(()=>window.__qaCalls.find(c=>c.path==='/generations/image'));
 assert.ok(generation.payload.image_media_ids.includes(99));
 await page.getByRole('button',{name:'生成 1 张图片',exact:true}).waitFor();
 await page.getByRole('button',{name:'3D 人体 · 摆姿势参考'}).click();
 await page.locator('.pose-viewport canvas').waitFor();
 assert.equal(await page.locator('select[aria-label="当前人物"] option').count(),2);
 await page.getByLabel('当前人物').selectOption({label:'人物 2'});
 await page.getByLabel('编辑关节').selectOption('左肘');
 assert.equal(await page.getByRole('slider',{name:'前后弯曲',exact:true}).inputValue(),'-80');
 await page.getByRole('button',{name:'删除人物',exact:true}).click();
 assert.equal(await page.locator('select[aria-label="当前人物"] option').count(),1);
 assert.ok(await page.getByRole('button',{name:'删除人物',exact:true}).isDisabled());

 assert.deepEqual(errors,[]);
 console.log('PASS: multiple people, joint editing, failed save retry, PNG dimensions, reference selection and generation payload');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
