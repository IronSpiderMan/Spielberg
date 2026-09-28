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
    if(args.path==='/media/import')return {...media,id:3};
    return {ok:true};
   }
   return null;
  }};
 });

 await require('./http-fixture.cjs')(page);
 await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
 await page.getByText('02 · 图片生成',{exact:true}).click();
 await page.locator('.creation-split textarea').fill('雨夜中的城市');
 await page.locator('.creation-split .arco-select').last().click();
 await page.getByRole('option',{name:'4 张',exact:true}).click();
 await page.getByRole('button',{name:'生成 4 张图片',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.image-result-card').length===4);
 await page.getByRole('button',{name:'生成 4 张图片',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.__qaCalls.filter(c=>c.path==='/generations/image').length),4);
 await page.evaluate(()=>{window.__qaFailure='partial';});
 await page.getByRole('button',{name:'生成 4 张图片',exact:true}).click();
 await page.locator('.image-generation-errors').waitFor();
 await page.getByRole('button',{name:'生成 4 张图片',exact:true}).waitFor();
 assert.equal(await page.locator('.image-result-card').count(),2);
 assert.equal(await page.locator('.image-generation-errors p').count(),2);
 await page.evaluate(()=>{window.__qaFailure='all';});
 await page.getByRole('button',{name:'生成 4 张图片',exact:true}).click();
 await page.getByText('本次未生成图片，请重试',{exact:true}).waitFor();
 assert.equal(await page.locator('.image-result-card').count(),0);
 assert.equal(await page.locator('.image-generation-errors p').count(),4);
 assert.deepEqual(errors,[]);
 console.log('PASS: four images, partial success, all failures, no runtime errors');
 await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
