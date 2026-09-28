// Isolated fixture; never reads or modifies real projects.
const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   const project={id:'qa',name:'测试项目',path:'/fixture',updated_at:'刚刚'};
   const image={id:1,name:'测试图片.png',path:'/spielberg-logo-s.png',kind:'image',created_at:'1789990000'};
   const scene={id:3,title:'测试场景',description:'保留描述',sort_order:0,first_media_id:9,last_media_id:8,reference_media_id:7,videos:[]};
   const role={id:2,name:'测试角色',description:'保留设定',design_media_id:null,images:[]};
   const data={project,roles:[role],media:[image,{...image,id:2,name:'测试视频.mp4',kind:'video'}],episodes:[{id:1,title:'测试剧集',description:'',scenes:[scene]}],prompts:[],settings:{}};
   window.__qaData=data;window.__qaFail=false;
   window.__TAURI_INTERNALS__={convertFileSrc:p=>p,invoke:async(command,args)=>{
    if(command!=='api_request')return null;
    const {path,payload}=args;
    if(path==='/scripts/load')return null;
    if(path==='/project/changes')return structuredClone(data);
if(path==='/media/list')return {items:data.media.map(m=>({...m,usage_count:0})),total:data.media.length};
if(path==='/media/thumbnail')return {path:'/spielberg-logo-s.png'};
if(path==='/projects')return [project];if(path==='/project')return structuredClone(data);if(path==='/tasks')return {items:[],has_more:false,next_cursor:null};
    if(window.__qaFail)throw Error('测试保存失败');
    if(path==='/roles/media/add'){if(!role.images.length)role.images.push(image);}
    if(path==='/roles/update')Object.assign(role,payload);
    if(path==='/scenes/update')Object.assign(scene,payload);
    if(path==='/scenes/select-video'){scene.video_media_id=payload.media_id;}
    return {ok:true};
   }};
  });
  await require('./http-fixture.cjs')(page);
 await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
  await page.getByRole('menuitem',{name:'资产库',exact:true}).click();
  const modal=page.locator('.asset-assignment-modal:visible');
  async function select(label,text){await modal.getByLabel(label,{exact:true}).click();await page.locator('.arco-select-option:visible').filter({hasText:text}).click();}
  for(const [usage,field] of [['角色图','role'],['场景首帧','first'],['场景尾帧','last'],['场景参考图','reference'],['场景视频','video']]){
   await page.locator('.library-card').filter({hasText:field==='video'?'测试视频.mp4':'测试图片.png'}).getByRole('button',{name:'设置用途'}).click();
   assert(await modal.getByRole('button',{name:'确定设置'}).isDisabled());
   if(field!=='video')await select('资产用途',usage);
   await select(field==='role'?'选择角色':'选择场景',field==='role'?'测试角色':'测试剧集 / 测试场景');
   if(field==='first'){
    await page.evaluate(()=>window.__qaFail=true);await modal.getByRole('button',{name:'确定设置'}).click();await page.getByText('Error: 测试保存失败',{exact:true}).waitFor();assert(await modal.isVisible());await page.evaluate(()=>window.__qaFail=false);
   }
   await modal.getByRole('button',{name:'确定设置'}).click();await modal.waitFor({state:'hidden'});
   const data=await page.evaluate(()=>window.__qaData);
   if(field==='role'){assert.equal(data.roles[0].design_media_id,1);assert.equal(data.roles[0].description,'保留设定');}
   else{assert.equal(data.episodes[0].scenes[0][field+'_media_id'],field==='video'?2:1);assert.equal(data.episodes[0].scenes[0].description,'保留描述');}
   if(field==='first'){assert.equal(data.episodes[0].scenes[0].last_media_id,8);assert.equal(data.episodes[0].scenes[0].reference_media_id,7);}
  }
  assert.deepEqual(errors,[]);console.log('PASS: 五种资产用途、目标必选、失败重试、保留其他场景帧与描述');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
