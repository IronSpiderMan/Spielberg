// Isolated production-build UI coverage. No real files, projects, or model requests.
const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1420,height:920},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   const project={id:'qa',name:'小王子',path:'/fixture',updated_at:'刚刚'};
   const media=Array.from({length:55},(_,i)=>({id:i+1,name:`素材-${String(i+1).padStart(2,'0')}.png`,path:'/spielberg-logo-s.png',kind:'image',created_at:'1789990000',deleted_at:null,usage_count:i===54?2:0}));
   const role={id:1,name:'小王子',description:'旅行者',design_media_id:55,images:[media[54]]};
   const scene={id:1,title:'沙漠相遇',description:'飞行员与小王子',sort_order:0,first_media_id:55,last_media_id:null,reference_media_id:null,first_media:media[54],videos:[]};
   const data={project,roles:[role],media,episodes:[{id:1,title:'第一集',description:'',scenes:[scene]}],prompts:[],settings:{},revisions:{media:0,roles:0,episodes:0,settings:0,prompts:0,jobs:0}};
   window.__calls=[];window.__fail=false;window.__hidden=false;
   Object.defineProperty(document,'visibilityState',{get:()=>window.__hidden?'hidden':'visible'});
   const changed=()=>{data.revisions.media++;};
   window.__TAURI_INTERNALS__={convertFileSrc:p=>p,invoke:async(command,args)=>{
    if(command==='plugin:dialog|save')return '/fixture-export.spielberg-backup';
    if(command==='plugin:dialog|open')return '/fixture-backup';
    if(command!=='api_request')return null;
    const {path,payload}=args;window.__calls.push({path,payload});
    if(path==='/projects')return [project];
    if(path==='/project')return structuredClone({...data,media:media.filter(m=>!m.deleted_at)});
    if(path==='/project/changes')return JSON.stringify(payload.revisions)===JSON.stringify(data.revisions)?{project,revisions:data.revisions}:structuredClone({...data,media:media.filter(m=>!m.deleted_at)});
    if(path==='/scripts/load')return null;
    if(path==='/tasks')return {items:[],has_more:false,next_cursor:null};
    if(path==='/media/thumbnail')return {path:'/spielberg-logo-s.png'};
    if(path==='/media/list'){
     if(window.__fail)throw Error('测试加载失败');
     const filtered=media.filter(m=>(payload.usage==='trash'?!!m.deleted_at:!m.deleted_at)&&(payload.usage!=='used'||m.usage_count>0)&&(payload.usage!=='unused'||m.usage_count===0)&&(payload.kind==='all'||m.kind===payload.kind)&&m.name.toLowerCase().includes(payload.query.toLowerCase())).sort((a,b)=>b.id-a.id);
     return {items:structuredClone(filtered.slice((payload.page-1)*payload.limit,payload.page*payload.limit)),total:filtered.length};
    }
    if(path==='/media/usage')return {items:payload.id===55?[{kind:'role',target_id:1,title:'小王子',purpose:'角色主图'},{kind:'scene',target_id:1,title:'沙漠相遇',episode_id:1,episode_title:'第一集',purpose:'场景首帧'}]:[]};
    const m=media.find(item=>item.id===payload?.id);
    if(path==='/media/delete'){m.deleted_at='1';changed();}
    if(path==='/media/restore'){m.deleted_at=null;changed();}
    if(path==='/media/purge'){media.splice(media.indexOf(m),1);changed();}
    if(path==='/media/rename'){m.name=payload.name;changed();}
    if(path==='/storage/scan')return {files:[{path:'/fixture/assets/orphan.png',size:500}],cache_bytes:102400};
    if(path==='/projects/restore')return {...project,id:'restored',name:'恢复项目'};
    return {ok:true};
   }};
  });
  await require('./http-fixture.cjs')(page);
 await page.goto(process.env.QA_URL||'http://127.0.0.1:1420');
  const nav=()=>page.getByRole('menuitem',{name:'资产库',exact:true}).click();
  await nav();await page.locator('.library-card').first().waitFor();
  assert.equal(await page.locator('.library-card').count(),24);
  assert.equal(await page.locator('.library-thumbnail video').count(),0);
  await page.locator('.asset-pagination').getByText('2',{exact:true}).click();
  await page.getByRole('button',{name:'预览 素材-31.png',exact:true}).waitFor();
  const select=async(label,text)=>{await page.getByLabel(label,{exact:true}).click();await page.locator('.arco-select-option:visible').filter({hasText:text}).click();};
  await select('使用状态','使用中');await page.getByText('使用中 · 2 处用途',{exact:true}).click();
  const drawer=page.locator('.arco-drawer:visible');await drawer.getByText('第一集 / 沙漠相遇',{exact:true}).waitFor();
  await drawer.getByRole('button',{name:'前往角色'}).click();await page.locator('.arco-drawer:visible').getByRole('button',{name:'保存角色'}).waitFor();
  await page.locator('.arco-drawer-close-icon').click();await nav();
  await page.getByText('使用中 · 2 处用途',{exact:true}).click();await page.getByRole('button',{name:'前往场景'}).click();await page.locator('.scene-form-card').waitFor();
  assert.equal(await page.locator('.scene-form-card input').inputValue(),'沙漠相遇');
  await nav();await select('使用状态','未使用');
  const more=(name)=>page.getByRole('button',{name:`更多操作 ${name}`,exact:true}).click();
  await more('素材-54.png');await page.getByRole('menuitem',{name:'移入回收站',exact:true}).click();
  await page.locator('.arco-modal:visible').getByRole('button',{name:'移入回收站',exact:true}).click();
  await select('使用状态','回收站');await page.getByRole('button',{name:'恢复资产',exact:true}).click();await page.getByText('回收站为空',{exact:true}).waitFor();
  await select('使用状态','未使用');await more('素材-54.png');await page.getByRole('menuitem',{name:'移入回收站',exact:true}).click();await page.locator('.arco-modal:visible').getByRole('button',{name:'移入回收站',exact:true}).click();
  await select('使用状态','回收站');await more('素材-54.png');await page.getByRole('menuitem',{name:'永久删除',exact:true}).click();await page.locator('.arco-modal:visible').getByRole('button',{name:'永久删除',exact:true}).click();await page.getByText('回收站为空',{exact:true}).waitFor();
  await page.getByRole('button',{name:'磁盘清理',exact:true}).click();await page.getByText('orphan.png · 0.5 KB',{exact:true}).waitFor();await page.getByRole('button',{name:'执行清理',exact:true}).click();
  await page.getByRole('button',{name:'项目备份',exact:true}).click();await page.getByRole('menuitem',{name:'备份当前项目',exact:true}).click();
  assert.equal(await page.locator('.project-tools input[type=checkbox]').isChecked(),false);
  await page.getByRole('button',{name:'选择位置并备份',exact:true}).click();
  await page.waitForFunction(()=>window.__calls.some(c=>c.path==='/projects/backup'));
  assert.equal(await page.evaluate(()=>window.__calls.find(c=>c.path==='/projects/backup').payload.include_api_keys),false);
  await select('使用状态','全部资产');
  await page.evaluate(()=>window.__fail=true);await page.getByPlaceholder('搜索资产名称').fill('素材-');await page.getByText('Error: 测试加载失败',{exact:true}).waitFor();
  await page.evaluate(()=>window.__fail=false);await page.getByRole('button',{name:'重试',exact:true}).click();await page.locator('.library-card').first().waitFor();
  await page.getByPlaceholder('搜索资产名称').fill('素材-01');await page.getByRole('button',{name:'预览 素材-01.png',exact:true}).waitFor();assert.equal(await page.locator('.library-card').count(),1);
  // Hidden windows stop polling; restoring visibility triggers a lightweight check.
  await page.evaluate(()=>{window.__hidden=true;document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForTimeout(200);const count=await page.evaluate(()=>window.__calls.filter(c=>c.path==='/project/changes').length);
  await page.waitForTimeout(4300);assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.path==='/project/changes').length),count);
  await page.evaluate(()=>{window.__hidden=false;document.dispatchEvent(new Event('visibilitychange'));});await page.waitForFunction(n=>window.__calls.filter(c=>c.path==='/project/changes').length>n,count);
  assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.path==='/project').length),1);
  await page.getByPlaceholder('搜索资产名称').fill('');await page.waitForFunction(()=>document.querySelectorAll('.library-card').length===24);
  fs.mkdirSync('/tmp/spielberg-assets',{recursive:true});await page.screenshot({path:'/tmp/spielberg-assets/library.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: 24-item pagination, cached previews, usage navigation, trash/restore/purge, cleanup, backup defaults, search/retry, incremental and visibility-aware refresh');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
