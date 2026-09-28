// Isolated UI fixture: no real projects or generation services are used.
const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch({headless:true});
try {
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
const project={id:'qa',name:'测试项目',path:'/fixture',updated_at:'刚刚'};
const image={id:1,name:'角色正面.png',path:'/spielberg-logo-s.png',kind:'image',created_at:'1789990000'};
const data={project,roles:[],media:[image,{...image,id:2,name:'测试视频.mp4',kind:'video'}],episodes:[],prompts:[],settings:{}};
window.__qaCalls=[];window.__qaData=data;window.__qaFail=false;
window.__TAURI_INTERNALS__={convertFileSrc:p=>p,invoke:async(command,args)=>{
if(command!=='api_request')return null;
const {path,payload}=args;window.__qaCalls.push({path,payload});
if(path==='/project/changes')return structuredClone(data);
if(path==='/media/list')return {items:data.media.map(m=>({...m,usage_count:0})),total:data.media.length};
if(path==='/media/thumbnail')return {path:'/spielberg-logo-s.png'};
if(path==='/projects')return [project];if(path==='/project')return structuredClone(data);if(path==='/tasks')return {items:[],has_more:false,next_cursor:null};
if(path==='/roles'){const role={id:1,name:payload.name,description:'',design_media_id:null,images:[]};data.roles.push(role);return structuredClone(role);}
if(path==='/roles/media/add'){if(window.__qaFail)throw Error('测试导入失败');const role=data.roles[0];if(!role.images.some(m=>m.id===payload.media_id))role.images.push(image);return {ok:true};}
if(path==='/roles/update'){Object.assign(data.roles[0],payload);return {ok:true};}
return null;
}};
});
await require('./http-fixture.cjs')(page);
 await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
await page.locator('.nav .arco-menu-item').nth(3).click();
await page.getByRole('button',{name:'创建角色',exact:true}).first().click();
await page.getByRole('button',{name:'从资产库选择',exact:true}).click();
const picker=page.locator('.asset-picker-modal:visible');
assert.equal(await picker.locator('.media-option-select').count(),1);
await picker.getByPlaceholder('搜索资产名称').fill('无匹配');
await picker.getByText('没有匹配的图片资产').waitFor();
await picker.getByPlaceholder('搜索资产名称').fill('角色');
await picker.getByRole('button',{name:'放大预览 角色正面.png'}).click();
await page.evaluate(()=>window.__qaFail=true);
await page.getByRole('button',{name:'选择此图片',exact:true}).click();
await page.getByText('Error: 测试导入失败',{exact:true}).waitFor();
assert(await picker.isVisible());
await page.evaluate(()=>window.__qaFail=false);
await page.getByRole('button',{name:'选择此图片',exact:true}).click();
await picker.waitFor({state:'hidden'});
await page.locator('.arco-drawer .media-option.selected').waitFor();
await page.getByRole('button',{name:'保存角色',exact:true}).click();
await page.locator('.arco-drawer:visible').waitFor({state:'hidden'});
assert.equal(await page.evaluate(()=>window.__qaData.roles[0].design_media_id),1);
assert.equal(await page.evaluate(()=>window.__qaData.media.length),2);
await page.getByRole('button',{name:'设定',exact:true}).click();
await page.getByRole('button',{name:'从资产库选择',exact:true}).click();
await picker.getByRole('button',{name:'选择资产 角色正面.png'}).click();
await picker.waitFor({state:'hidden'});
assert.equal(await page.locator('.arco-drawer .media-option').count(),1);
assert.deepEqual(errors,[]);
console.log('PASS: 创建角色、仅图片筛选、搜索、预览、失败重试、保存主图、重复选择');
} finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
