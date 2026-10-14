// Isolated editor fixture: does not access user projects.
const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const project={id:'editor-qa',name:'剪辑测试',path:'/fixture',updated_at:'刚刚'};
  const media={id:1,name:'演示视频.mp4',path:'/fixture.mp4',kind:'video',created_at:'0'};
  const data={project,media:[media],roles:[],episodes:[],prompts:[],settings:{}};let exported;let edits=[];
  await page.route('**/api/v1/**',async route=>{
   const path=new URL(route.request().url()).pathname;let result={};
   if(path==='/api/v1/projects')result=[project];
   else if(path.endsWith('/project')||path.endsWith('/project/changes'))result=data;
   else if(path.endsWith('/editor/projects'))result=edits;
   else if(path.endsWith('/editor/save')){const value=route.request().postDataJSON();const old=edits.find(e=>e.id===value.id);edits=[{...value,status:old?.status||'draft',outputs:old?.outputs||[],updated_at:String(Math.floor(Date.now()/1000))},...edits.filter(e=>e.id!==value.id)];result=edits;}
   else if(path.endsWith('/editor/probe'))result={duration:4,video:true,audio:true};
   else if(path.endsWith('/editor/export')){exported=route.request().postDataJSON();result={...media,id:2,name:'剪辑作品.mp4'};}
   else if(path.endsWith('/tasks'))result={items:[]};
   await route.fulfill({json:{data:result}});
  });
  await page.route('**/media?*',r=>{const bytes=require('node:fs').readFileSync(process.env.EDITOR_FIXTURE||'/tmp/editor-fixture.mp4');const range=r.request().headers().range;if(range){const m=/bytes=(\d+)-(\d*)/.exec(range);const start=Number(m[1]),end=m[2]?Math.min(Number(m[2]),bytes.length-1):bytes.length-1;return r.fulfill({status:206,headers:{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${bytes.length}`},body:bytes.subarray(start,end+1)});}return r.fulfill({body:bytes,contentType:'video/mp4',headers:{'Accept-Ranges':'bytes'}});});
  await page.goto(process.env.QA_URL||'http://127.0.0.1:1420');
  await page.getByRole('menuitem',{name:'音视频剪辑',exact:true}).click();
  await page.getByRole('button',{name:'创建剪辑项目'}).click();
  await page.locator('.me-asset').click();await page.locator('.me-clip').waitFor();
  await page.waitForFunction(()=>document.querySelector('.me-canvas video')?.readyState>=1);
  const firstWidth=(await page.locator('.me-clip').first().boundingBox()).width;
  await page.locator('.me-asset').click();
  await page.waitForFunction(()=>document.querySelectorAll('.me-clip').length===2);
  assert.equal((await page.locator('.me-clip').first().boundingBox()).width,firstWidth,'Adding a clip must preserve the existing scale');
  await page.locator('.me-track-scroll').dispatchEvent('wheel',{ctrlKey:true,deltaY:-40,clientX:700,bubbles:true,cancelable:true});
  await page.waitForFunction(()=>Number(document.querySelector('[aria-label="时间线缩放"]').value)>100);
  assert.ok((await page.locator('.me-clip').first().boundingBox()).width>firstWidth,'Pinch must enlarge clips');
  await page.locator('.me-timeline').evaluate(node=>{
    node.dispatchEvent(new Event('gesturestart',{cancelable:true}));
    const event=new Event('gesturechange',{cancelable:true});
    Object.assign(event,{scale:0.5,clientX:700});node.dispatchEvent(event);
    node.dispatchEvent(new Event('gestureend',{cancelable:true}));
  });
  await page.waitForFunction(()=>Number(document.querySelector('[aria-label="时间线缩放"]').value)<100);
  await page.getByLabel('时间线缩放').fill('100');
  await page.getByLabel('撤销',{exact:true}).click();
  await page.locator('.me-clip-hit').first().click();
  await page.getByLabel('出点',{exact:true}).fill('3');
  await page.getByLabel('时间线播放头').fill('1.5');
  await page.getByRole('button',{name:'在播放头分割'}).click();
  assert.equal(await page.locator('.me-clip').count(),2);
  await page.getByLabel('前移片段',{exact:true}).click();
  await page.getByLabel('撤销',{exact:true}).click();
  await page.getByLabel('删除片段',{exact:true}).click();
  assert.equal(await page.locator('.me-clip').count(),1);
  await page.getByLabel('撤销',{exact:true}).click();
  assert.equal(await page.locator('.me-clip').count(),2);
  // Click inside a clip to position the playhead and detach its original audio.
  await page.locator('.me-clip-hit').first().click();
  assert.ok(Number(await page.getByLabel('时间线播放头').inputValue())>0);
  await page.getByRole('button',{name:'分离音轨',exact:true}).click();
  await page.locator('.me-clip.audio').waitFor();
  assert.equal(await page.locator('.me-clip').count(),3);
  await page.locator('.me-clip.audio .me-clip-hit').click();
  await page.getByRole('button',{name:'在播放头分割'}).click();
  assert.equal(await page.locator('.me-clip.audio').count(),2);
  await page.getByLabel('音轨位置',{exact:true}).fill('2');
  await page.getByLabel('音量',{exact:true}).fill('0.5');
  await page.getByLabel('删除片段',{exact:true}).click();
  assert.equal(await page.locator('.me-clip.audio').count(),1);
  await page.getByLabel('撤销',{exact:true}).click();
  assert.equal(await page.locator('.me-clip.audio').count(),2);
  await page.getByLabel('时间线播放头').fill('0.1');
  await page.evaluate(()=>{window.__playbackSeeks=0;document.querySelector('.me-canvas video').addEventListener('seeking',()=>window.__playbackSeeks++);});
  await page.getByRole('button',{name:'播放',exact:true}).click();
  await page.waitForFunction(()=>{const v=document.querySelector('.me-canvas video'),a=document.querySelector('.me-canvas audio');return v&&a&&v.volume===0&&!a.paused&&v.currentTime>0.5;});
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  assert.ok(await page.evaluate(()=>window.__playbackSeeks<=1),'Continuous playback must not repeatedly seek the video');
  await page.getByRole('button',{name:'导出作品',exact:true}).click();
  await page.getByRole('button',{name:'下载文件',exact:true}).waitFor();
  assert.equal(exported.clips.length,2);assert.equal(exported.format,'mp4');assert.equal(exported.clips[0].volume,0);assert.equal(exported.audio_clips.length,2);assert.equal(exported.audio_clips[1].at,2);assert.equal(exported.audio_clips[1].volume,0.5);
  await page.screenshot({path:'/tmp/spielberg-editor-qa.png',fullPage:true});
  await page.reload();await page.getByRole('menuitem',{name:'音视频剪辑',exact:true}).click();
  await page.locator('.me-clip').first().waitFor();assert.equal(await page.locator('.me-clip').count(),4);assert.equal(await page.locator('.me-clip.audio').count(),2);
  assert.deepEqual(errors,[]);console.log('Editor UI: split, trim, detach audio, independent audio editing, synchronized playback, undo, export and draft restore passed.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
