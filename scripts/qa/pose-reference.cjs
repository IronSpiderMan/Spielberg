// Isolated UI fixture: no real projects, credentials, or generation services are used.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');

async function canvasPoint(canvas, color, edge) {
 return canvas.evaluate((source, {color, edge}) => {
  const copy = document.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  const context = copy.getContext('2d');
  context.drawImage(source, 0, 0);
  const {data} = context.getImageData(0, 0, copy.width, copy.height);
  const points = [];
  for (let i = 0; i < data.length; i += 4) {
   const r = data[i], g = data[i + 1], b = data[i + 2];
   const matches = color === 'box' ? b - r > 30 && b - g > 12 && r > 40
    : color === 'red' ? r > 220 && g < 40 && b < 40
    : color === 'green' ? g > 220 && r < 40 && b < 40
    : b > 220 && r < 40 && g < 40;
   if (matches) points.push({x: (i / 4) % copy.width, y: Math.floor(i / 4 / copy.width)});
  }
  if (!points.length) return null;
  const center = points.reduce((p, q) => ({x: p.x + q.x, y: p.y + q.y}), {x: 0, y: 0});
  const point = edge === 'right' ? points.reduce((a, b) => a.x > b.x ? a : b)
   : edge === 'top' ? points.reduce((a, b) => a.y < b.y ? a : b)
   : edge === 'topRight' ? points.reduce((a, b) => a.x - a.y > b.x - b.y ? a : b)
   : {x: center.x / points.length, y: center.y / points.length};
  const rect = source.getBoundingClientRect();
  return {x: rect.left + point.x * rect.width / copy.width, y: rect.top + point.y * rect.height / copy.height, pixels: points.length};
 }, {color, edge});
}

async function dragCanvas(page, point, dx, dy) {
 assert.ok(point, 'Expected a visible 3D control');
 await page.mouse.move(point.x, point.y);
 await page.mouse.down();
 await page.mouse.move(point.x + dx, point.y + dy, {steps: 5});
 await page.mouse.up();
}

(async () => {
 const browser = await chromium.launch({headless:true});
 const page = await browser.newPage({reducedMotion:'reduce'});
 const errors=[]; page.on('pageerror', e=>errors.push(e.message));
 await page.addInitScript(() => {
  const long='长安十二时辰：雨夜追踪与角色命运的交汇';
  const project={id:'qa-project',name:long,path:'/fixture',updated_at:'刚刚'};
  const media={id:1,name:long+'.png',path:'/spielberg-logo-s.png',kind:'image',created_at:'1789990000'};
  const scenes=Array.from({length:3},(_,i)=>({id:i+1,title:`场景 ${i+1} · ${long}`,description:(long+'。').repeat(8),sort_order:i,first_media_id:1,last_media_id:null,reference_media_id:null,first_media:media,videos:[]}));
  for (const clip of scenes) clip.scene_id=clip.id;
  const data={project,media:[media],assets:[{id:1,name:long,description:long.repeat(6),design_media_id:1,images:[media]}],episodes:[{id:1,title:long,description:long.repeat(3),clips:scenes,scenes:scenes.map(clip=>({id:clip.id,title:clip.title,generation_mode:'clips',clips:[clip],reference_media_ids:[],reference_audio_media_ids:[]})),playback_units:scenes.map(clip=>({kind:'clip',id:clip.id,title:clip.title,videos:[]}))}],prompts:[{id:1,name:long.repeat(3),content:long.repeat(12),category:'角色'}],settings:{image:{provider:'openai',base_url:'https://example.com',model:'gpt-image-1',api_key:'',description:''}}};
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
 await page.getByRole('menuitem',{name:'工作台',exact:true}).click();
 await page.getByRole('tab',{name:'图片生成',exact:true}).click();

 await page.getByRole('tab',{name:'图生图',exact:true}).click();
 const entry = page.getByRole('button',{name:'3D 参考 · 人物与基础体积'});
 await entry.click();
 const canvas = page.locator('.pose-viewport canvas');
 await canvas.waitFor({timeout:10000}).catch(async e=>{console.log(errors);console.log(await page.locator('body').innerText());await page.screenshot({path:'/tmp/spielberg-pose-error.png'});throw e;});
 const dimensions=(await page.locator('.pose-modal .helper').first().innerText()).match(/截图 (\d+) × (\d+)/);
 assert.ok(dimensions);
 assert.equal(await page.getByLabel('人偶款式').count(),0);
 await page.getByRole('button',{name:'添加人物',exact:true}).click();
 const cast = page.getByRole('group',{name:'当前人物'});
 assert.equal(await cast.getByRole('button').count(),2);
 assert.equal(await cast.getByRole('button',{name:'人物 2'}).getAttribute('aria-pressed'),'true');
 await page.getByRole('group',{name:'动作预设'}).getByRole('button',{name:'举手'}).click();
 await page.getByRole('button',{name:'斜视',exact:true}).click();
 const leftElbow = page.getByRole('button',{name:'画布关节 · 左肘'});
 await leftElbow.hover();
 const handle = await leftElbow.boundingBox();
 await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
 await page.mouse.down();
 await page.mouse.move(handle.x+handle.width/2+22,handle.y+handle.height/2+34,{steps:4});
 await page.mouse.up();
 const bend = page.getByRole('slider',{name:'前后弯曲',exact:true});
 assert.equal(await leftElbow.getAttribute('aria-pressed'),'true');
 assert.equal(await bend.inputValue(),'14');
 assert.equal(await page.getByRole('slider',{name:'侧向摆动'}).inputValue(),'22');
 await page.getByRole('button',{name:'重置关节',exact:true}).click();
 assert.equal(await bend.inputValue(),'0');
 await bend.fill('-80');
 const modelSettings = page.getByRole('button',{name:'模型设置',exact:true});
 await modelSettings.click();
 assert.equal(await leftElbow.count(),0);
 const modelControls = page.getByRole('group',{name:'模型操作'});
 const rotate = modelControls.getByRole('button',{name:'旋转',exact:true});
 const move = modelControls.getByRole('button',{name:'移动',exact:true});
 await rotate.click();
 await page.getByRole('slider',{name:'人物朝向'}).fill('30');
 await page.getByRole('button',{name:'关节',exact:true}).click();
 assert.equal(await bend.inputValue(),'-80');
 const shapeList = page.getByRole('group',{name:'当前体积'});
 for (const name of ['长方体', '球体', '圆柱']) {
  await page.getByRole('button',{name:`添加${name}`,exact:true}).click();
  assert.equal(await shapeList.getByRole('button',{name:`${name} 1`}).getAttribute('aria-pressed'),'true');
 }
 await cast.getByRole('button',{name:'人物 1'}).click();
 await page.getByRole('button',{name:'关节',exact:true}).click();
 await page.getByRole('button',{name:'正面',exact:true}).click();
 await page.waitForFunction(() => {
  const marker = document.querySelector('.pose-marker');
  return marker?.style.visibility === 'visible';
 });
 const boxPoint = await canvasPoint(canvas, 'box');
 assert.ok(boxPoint, 'Expected the box to be rendered');
 await page.mouse.click(boxPoint.x, boxPoint.y);
 assert.equal(await shapeList.getByRole('button',{name:'长方体 1'}).getAttribute('aria-pressed'),'true');
 const xPosition = page.getByRole('slider',{name:'左右位置'});
 const height = page.getByRole('slider',{name:'高度'});
 await canvas.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
 await dragCanvas(page, await canvasPoint(canvas, 'red', 'right'), 30, 0);
 assert.ok(Number(await xPosition.inputValue()) > -.85);
 await dragCanvas(page, await canvasPoint(canvas, 'green', 'top'), 0, -30);
 assert.ok(Number(await height.inputValue()) > .3);
 const movedX = await xPosition.inputValue();
 const movedHeight = await height.inputValue();
 await rotate.click();
 await canvas.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
 await dragCanvas(page, await canvasPoint(canvas, 'blue', 'topRight'), -24, -24);
 const roll = page.getByRole('slider',{name:'左右倾斜'});
 const rotatedRoll = await roll.inputValue();
 assert.notEqual(rotatedRoll,'0');
 const size = modelControls.getByRole('button',{name:'尺寸',exact:true});
 const appearance = modelControls.getByRole('button',{name:'外观',exact:true});
 const overall = page.getByRole('slider',{name:'整体大小'});
 const widthScale = page.getByRole('slider',{name:'宽度倍率'});
 const color = page.getByLabel('模型颜色',{exact:true});
 const roughness = page.getByRole('slider',{name:'粗糙度'});
 const metalness = page.getByRole('slider',{name:'金属度'});
 await size.click();
 await canvas.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
 const originalBox = await canvasPoint(canvas, 'box');
 assert.ok(originalBox);
 await overall.fill('1.35');
 await widthScale.fill('1.2');
 await canvas.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
 const enlargedBox = await canvasPoint(canvas, 'box');
 assert.ok(enlargedBox.pixels > originalBox.pixels * 1.3, 'Scaling must enlarge the rendered box');
 await appearance.click();
 await color.fill('#d427b5');
 await roughness.fill('0.4');
 await metalness.fill('0.2');
 await page.screenshot({path:'/tmp/spielberg-pose-editor.png'});
 await rotate.click();
 await page.evaluate(()=>{window.__poseFail=true;});
 await page.getByRole('button',{name:'截图并用作参考图',exact:true}).click();
 await page.getByText('保存姿势截图失败：', {exact:false}).waitFor();
 await page.evaluate(()=>{window.__poseFail=false;});
 await cast.getByRole('button',{name:'人物 1'}).click();
 await page.getByRole('button',{name:'关节',exact:true}).click();
 await page.getByRole('button',{name:'截图并用作参考图',exact:true}).click();
 await page.locator('.creation-reference-chip').filter({hasText:'3D姿势参考.png'}).waitFor();
 const [capture, retry] = await page.evaluate(()=>window.__qaCalls.filter(c=>c.path==='/media/pose-reference'));
 assert.equal(capture.payload.data_url,retry.payload.data_url,'Export must hide the gizmo');
 assert.ok(capture.payload.data_url.startsWith('data:image/png;base64,'));
 assert.ok(await page.evaluate(async dataUrl => {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const {data} = context.getImageData(0, 0, canvas.width, canvas.height);
  let boxPixels = 0;
  for (let i = 0; i < data.length; i += 4) {
   const r = data[i], g = data[i + 1], b = data[i + 2];
   if (r > 95 && b > 75 && r - g > 40 && b - g > 30) boxPixels++;
  }
  return boxPixels > 100;
 }, capture.payload.data_url), 'Export must include the recolored box');
 const png=Buffer.from(capture.payload.data_url.split(',')[1],'base64');
 assert.equal(png.readUInt32BE(16),Number(dimensions[1]));assert.equal(png.readUInt32BE(20),Number(dimensions[2]));
 require('node:fs').writeFileSync('/tmp/spielberg-pose-reference.png',png);
 await page.locator('.creation-split textarea').fill('两个人物，按照参考姿势');
 await page.getByRole('button',{name:'生成 1 张图片',exact:true}).click();
 await page.locator('.image-result-card').waitFor();
 const generation=await page.evaluate(()=>window.__qaCalls.find(c=>c.path==='/generations/image'));
 assert.ok(generation.payload.image_media_ids.includes(99));
 await page.getByRole('button',{name:'生成 1 张图片',exact:true}).waitFor();
 await entry.click();
 await page.locator('.pose-viewport canvas').waitFor();
 assert.equal(await cast.getByRole('button').count(),2);
 await cast.getByRole('button',{name:'人物 2'}).click();
 await page.getByRole('group',{name:'编辑关节'}).getByRole('button',{name:'左肘'}).click();
 assert.equal(await bend.inputValue(),'-80');
 await modelSettings.click();
 await rotate.click();
 assert.equal(await page.getByRole('slider',{name:'人物朝向'}).inputValue(),'30');
 await page.getByRole('button',{name:'删除人物',exact:true}).click();
 assert.equal(await cast.getByRole('button').count(),1);
 assert.ok(await page.getByRole('button',{name:'删除人物',exact:true}).isDisabled());
 const box = shapeList.getByRole('button',{name:'长方体 1'});
 await box.click();
 assert.equal(await roll.inputValue(),rotatedRoll);
 await move.click();
 assert.equal(await xPosition.inputValue(),movedX);
 assert.equal(await height.inputValue(),movedHeight);
 await size.click();
 assert.equal(await overall.inputValue(),'1.35');
 assert.equal(await widthScale.inputValue(),'1.2');
 await page.getByRole('button',{name:'重置尺寸'}).click();
 assert.equal(await overall.inputValue(),'1');
 assert.equal(await widthScale.inputValue(),'1');
 await appearance.click();
 assert.equal(await color.inputValue(),'#d427b5');
 assert.equal(await roughness.inputValue(),'0.4');
 assert.equal(await metalness.inputValue(),'0.2');
 await page.getByRole('button',{name:'重置外观'}).click();
 assert.equal(await color.inputValue(),'#6489ab');
 assert.equal(await roughness.inputValue(),'0.65');
 assert.equal(await metalness.inputValue(),'0');
 await page.getByRole('button',{name:'删除体积',exact:true}).click();
 assert.equal(await shapeList.getByRole('button').count(),2);
 const moreShapes = page.getByRole('button',{name:'更多形状',exact:true});
 for (const name of ['圆锥', '四棱锥', '三棱柱', '胶囊体', '圆环', '薄板']) {
  await moreShapes.click();
  await page.getByRole('menuitem',{name,exact:true}).click();
  assert.equal(await shapeList.getByRole('button',{name:`${name} 1`}).getAttribute('aria-pressed'),'true');
 }
 assert.equal(await shapeList.getByRole('button').count(),8);
 await page.screenshot({path:'/tmp/spielberg-pose-shapes.png'});
 await cast.getByRole('button',{name:'人物 1'}).click();
 await modelSettings.click();
 await size.click();
 await overall.fill('0.75');
 assert.equal(await overall.inputValue(),'0.75');
 await appearance.click();
 const tint = page.getByLabel('木纹色调',{exact:true});
 await tint.fill('#87bcff');
 assert.equal(await tint.inputValue(),'#87bcff');

 assert.deepEqual(errors,[]);
 console.log('PASS: figures and nine primitive shapes, model dragging, dimensions and materials, draft restoration, PNG export and reference generation');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
