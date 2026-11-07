// Disposable media and mocked HTTP data; never touches user projects.
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

(async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'spielberg-audio-tools-'));
  const generate = (name, args) => {
    const target = path.join(output, name);
    const result = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-v', 'error', ...args, target]);
    assert.equal(result.status, 0, result.stderr?.toString());
    return fs.readFileSync(target);
  };
  const video = generate('source.mp4', ['-f','lavfi','-i','color=c=blue:s=320x180:r=24','-f','lavfi','-i','sine=frequency=440','-t','3','-c:v','libx264','-c:a','aac']);
  const audio = generate('source.wav', ['-f','lavfi','-i',"aevalsrc='if(between(t,0.5,1.5)+between(t,2,2.6),0.25*sin(2*PI*440*t)*(0.65+0.35*sin(2*PI*3*t)),0)':s=44100:d=3"]);
  const trimmed = generate('trim.wav', ['-ss','0.4','-i',path.join(output,'source.wav'),'-t','0.8']);
  const analyze = (name,duration) => {
    const result = spawnSync(process.env.FFMPEG || 'ffmpeg',['-v','error','-i',path.join(output,name),'-f','f32le','pipe:1']);
    assert.equal(result.status,0,result.stderr?.toString());
    const count = result.stdout.length/4, peaks = Array(2048).fill(0), rms = Array(2048).fill(0), counts=Array(2048).fill(0);
    for(let i=0;i<count;i++){const bin=Math.min(2047,Math.floor(i/count*2048)), sample=result.stdout.readFloatLE(i*4);peaks[bin]=Math.max(peaks[bin],Math.abs(sample));rms[bin]+=sample*sample;counts[bin]++;}
    return {duration,peaks,rms:rms.map((value,i)=>Math.sqrt(value/(counts[i]||1))),silence_threshold:0.003162278};
  };
  const fullWave = analyze('source.wav',3), cutWave=analyze('trim.wav',0.8);
  const waveformRequests=[]; let failWaveform=true;
  const browser = await chromium.launch({headless: true});
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const project = {id:'audio-qa', name:'音频工具测试', path:'/fixture', updated_at:'1'};
  const source = {id:1, name:'原视频.mp4', kind:'video', path:'/fixture/source.mp4', created_at:'1'};
  const data = {project, media:[source], assets:[], episodes:[], prompts:[], settings:{}, revisions:{media:1, assets:1}};
  const calls = [];
  let failExtract = true, failTrim = false, hold = false, finish;
  try {
    await page.route('**/api/v1/**', async route => {
      const url = new URL(route.request().url()), pathname = url.pathname;
      let result = {};
      if (pathname === '/api/v1/projects') result = [project];
      else if (pathname.endsWith('/project') || pathname.endsWith('/project/changes')) result = data;
      else if (pathname.endsWith('/tasks')) result = {items:[], has_more:false};
      else if (pathname.endsWith('/skills/list')) result = {items:[], directory:'/fixture'};
      else if (pathname.endsWith('/media/thumbnail')) result = {path:'/spielberg-logo-s.png'};
      else if (pathname.endsWith('/media/audio-waveform')) {
        const request=route.request().postDataJSON();waveformRequests.push(request);
        if(failWaveform)return route.fulfill({status:400,json:{error:'测试波形加载失败'}});
        result=/trim|overwrite/.test(request.source_path)?cutWave:fullWave;
      }
      else if (pathname === '/api/v1/projects/audio-qa/media') result = {items:data.media.map(m => ({...m,usage_count:0})),total:data.media.length};
      else if (pathname.endsWith('/media/extract-audio') || pathname.endsWith('/media/trim-audio')) {
        const request = route.request().postDataJSON(); calls.push({pathname, request});
        if (hold) await new Promise(resolve => {finish = resolve;});
        if (pathname.endsWith('/extract-audio')) {
          if (failExtract) return route.fulfill({status:400,json:{error:'该素材没有音轨'}});
          result = {id:2,kind:'audio',name:'原视频 · 音频.wav',path:'/fixture/source.wav',created_at:'2'};
          data.media.push(result);
        } else {
          if (failTrim) return route.fulfill({status:400,json:{error:'测试保存失败'}});
          const original = data.media.find(m=>m.id===request.media_id);
          result = {...original,id:request.overwrite?original.id:3,name:request.overwrite?original.name:`${request.name}.wav`,path:request.overwrite?'/fixture/overwrite.wav':'/fixture/trim.wav'};
          if (request.overwrite) data.media[data.media.indexOf(original)] = result;
          else data.media.push(result);
        }
        data.revisions.media++; data.revisions.assets++;
      }
      await route.fulfill({json:{data:result}});
    });
    await page.route('**/media?*', route => {
      const url = new URL(route.request().url()), file = url.searchParams.get('path') || '';
      if (url.pathname.startsWith('/api/')) return route.fallback();
      if (file === '/spielberg-logo-s.png') return route.fulfill({status:302,headers:{Location:'/spielberg-logo-s.png'}});
      const bytes = file.endsWith('.mp4') ? video : /trim|overwrite/.test(file) ? trimmed : audio;
      const type = file.endsWith('.mp4') ? 'video/mp4' : 'audio/wav';
      const match = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
      if (match) {
        const start = Number(match[1]), end = match[2] ? Math.min(Number(match[2]),bytes.length-1) : bytes.length-1;
        return route.fulfill({status:206,headers:{'Content-Type':type,'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${bytes.length}`},body:bytes.subarray(start,end+1)});
      }
      return route.fulfill({contentType:type,body:bytes});
    });
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
    await page.getByRole('menuitem',{name:'素材库',exact:true}).click();
    await page.getByRole('button',{name:'预览 原视频.mp4',exact:true}).click();
    const videoModal = page.locator('.video-preview-modal:visible');
    await videoModal.getByRole('button',{name:'提取音频',exact:true}).click();
    await videoModal.getByRole('alert').filter({hasText:'没有音轨'}).waitFor();
    failExtract = false; hold = true;
    await videoModal.getByRole('button',{name:'重试提取',exact:true}).dblclick();
    await page.waitForFunction(()=>document.querySelector('.video-preview-close')?.disabled);
    await page.keyboard.press('Escape');
    assert.equal(await videoModal.count(),1);
    assert.equal(calls.length,2,'Double click extraction submits once');
    hold = false; finish();
    await videoModal.getByRole('button',{name:'试听已提取音频',exact:true}).click();
    const audioModal = page.locator('.audio-preview-modal:visible');
    await audioModal.waitFor({state:'visible'});
    assert.equal(await audioModal.getByRole('button',{name:'编辑 / 裁剪',exact:true}).count(),0,'Extraction result is an audition; editing starts from the library');
    await page.waitForFunction(()=>document.querySelector('.audio-preview-modal audio')?.duration===3);
    await page.keyboard.press('Escape');
    await audioModal.waitFor({state:'hidden'});
    await videoModal.getByRole('button',{name:'关闭视频预览'}).click();
    const card = page.locator('.library-card').filter({has:page.getByRole('button',{name:'预览 原视频 · 音频.wav',exact:true})});
    await card.getByRole('button',{name:'裁剪音频',exact:true}).click();
    const panel = audioModal.getByRole('region',{name:'音频裁剪',exact:true});
    const start = panel.getByLabel('音频裁剪起点',{exact:true}), end = panel.getByLabel('音频裁剪终点',{exact:true});
    const commit = async (field,value)=>{await field.fill(String(value));await field.press('Enter');};
    await page.waitForFunction(()=>document.querySelector('.audio-preview-modal audio')?.duration===3);
    await panel.getByText('波形暂时无法加载',{exact:true}).waitFor();
    assert.equal(await panel.getByRole('button',{name:'预览选中片段',exact:true}).isEnabled(),true,'A waveform failure does not block playback or trimming');
    failWaveform=false;await panel.getByRole('button',{name:'重新加载波形',exact:true}).click();
    await panel.getByRole('img',{name:/真实音频波形/}).waitFor();
    const quiet=await panel.locator('.audio-waveform-silence').evaluateAll(nodes=>nodes.map(node=>[Number(node.dataset.start),Number(node.dataset.end)]));
    for(const t of [0.2,1.7,2.8])assert(quiet.some(([start,end])=>start<=t&&end>=t),`Silence at ${t}s is marked on the real waveform`);
    assert(!quiet.some(([start,end])=>start<=0.8&&end>=0.8),'Sound is not marked as silent');
    assert((await panel.locator('.audio-waveform-peak').first().getAttribute('d')).length>1000);
    await start.fill(''); assert.equal(await start.inputValue(),'');
    await commit(start,0.4); await commit(end,1.2);
    const handle = panel.getByRole('slider',{name:'拖动裁剪起点',exact:true});
    await handle.focus(); await handle.press('ArrowRight');
    assert.equal(Number(await start.inputValue()),0.41);
    await commit(start,0.4);
    await commit(start,9); assert(Number(await start.inputValue())<=1.15+1e-8);
    await commit(start,0.4);
    await panel.getByRole('button',{name:'预览选中片段',exact:true}).click();
    await page.waitForFunction(()=>{const audio=document.querySelector('.audio-preview-modal audio');return audio.paused && Math.abs(audio.currentTime-1.2)<0.03;});
    await panel.getByLabel('裁剪音频名称').fill('保留音频');
    await page.screenshot({path:path.join(output,'waveform-desktop.png')});
    await page.evaluate(()=>{document.documentElement.setAttribute('arco-theme','dark');document.documentElement.setAttribute('data-theme','dark');});
    await page.waitForFunction(()=>{const node=document.querySelector('.audio-preview-summary button');return node&&getComputedStyle(node).backgroundColor!=='rgb(255, 255, 255)';});
    assert.notEqual(await audioModal.getByRole('button',{name:'返回预览',exact:true}).evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(255, 255, 255)','Secondary audio controls follow the dark palette');
    await audioModal.screenshot({path:path.join(output,'audio-editor.png'),animations:'disabled'});
    await page.screenshot({path:path.join(output,'waveform-dark.png'),animations:'disabled'});
    await page.setViewportSize({width:390,height:844});
    assert(await audioModal.evaluate(node=>node.scrollWidth<=node.clientWidth));
    await audioModal.locator('.arco-modal-content').evaluate(node=>{const scroll=node.closest('.arco-modal-body');if(scroll)scroll.scrollTop=0;});
    await page.screenshot({path:path.join(output,'waveform-mobile-top.png')});
    await panel.getByRole('button',{name:'保存为新素材',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,'waveform-mobile.png')});
    await page.setViewportSize({width:1440,height:1000});
    await page.evaluate(()=>{document.documentElement.removeAttribute('arco-theme');document.documentElement.setAttribute('data-theme','light');});
    failTrim = true;
    await panel.getByRole('button',{name:'保存为新素材',exact:true}).click();
    await panel.getByRole('alert').filter({hasText:'测试保存失败'}).waitFor();
    assert.equal(Number(await start.inputValue()),0.4); assert.equal(Number(await end.inputValue()),1.2);
    failTrim = false; hold = true;
    await panel.getByRole('button',{name:'重试保存',exact:true}).dblclick();
    await page.waitForFunction(()=>document.querySelector('[aria-label="音频裁剪起点"]').disabled);
    await page.keyboard.press('Escape'); assert.equal(await audioModal.count(),1);
    assert.equal(calls.length,4,'Double click trim submits once');
    hold = false; finish();
    await panel.getByText('已保存到素材库：保留音频.wav',{exact:true}).waitFor();
    assert.equal(await panel.getByRole('button',{name:'已保存',exact:true}).isDisabled(),true);
    assert.equal(data.media.length,3); assert.equal(data.media[1].path,'/fixture/source.wav');
    await panel.getByRole('button',{name:'试听结果',exact:true}).click();
    assert.equal(await page.locator('.audio-preview-modal:visible').count(),2);
    await page.keyboard.press('Escape');
    await panel.waitFor({state:'visible'});
    await panel.getByRole('radio',{name:'覆盖原素材',exact:true}).check();
    await panel.getByRole('button',{name:'裁剪并覆盖素材',exact:true}).click();
    await panel.getByText('已覆盖：原视频 · 音频.wav',{exact:true}).waitFor();
    await page.waitForFunction(()=>Math.abs(document.querySelector('.audio-preview-modal audio').duration-0.8)<0.001);
    assert.equal(data.media.length,3); assert.equal(data.media[1].id,2); assert.equal(data.media[1].path,'/fixture/overwrite.wav');
    assert.deepEqual(calls.at(-1).request,{project_id:project.id,media_id:2,source_path:'/fixture/source.wav',start:0.4,end:1.2,name:'保留音频',overwrite:true});
    assert.equal(Number(await start.inputValue()),0); assert.equal(Number(await end.inputValue()),0.8);
    await page.waitForFunction(()=>document.querySelector('.audio-waveform'));
    assert(waveformRequests.some(request=>request.source_path==='/fixture/overwrite.wav'),'Overwriting loads a new waveform');
    await page.screenshot({path:path.join(output,'desktop.png')});
    await page.evaluate(()=>{document.documentElement.setAttribute('arco-theme','dark');document.documentElement.setAttribute('data-theme','dark');});
    await page.screenshot({path:path.join(output,'dark.png')});
    await page.setViewportSize({width:390,height:844});
    assert(await audioModal.evaluate(node=>node.scrollWidth<=node.clientWidth),'Audio modal fits narrow screens');
    assert(await panel.evaluate(node=>node.scrollWidth<=node.clientWidth),'Audio controls fit narrow screens');
    await page.screenshot({path:path.join(output,'mobile.png')});
    assert.deepEqual(errors,[]);
    console.log(`PASS: real sound/silence waveform, waveform failure/retry and overwrite refresh, extraction, range/keyboard controls, selected playback, save locking, new/overwrite modes, result preview and responsive themes. Screenshots: ${output}`);
  } catch (e) {await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});console.error(`Failure screenshot: ${output}/failure.png`);throw e;}
  finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
