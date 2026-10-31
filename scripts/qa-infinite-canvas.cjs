// Isolated HTTP fixtures. Never uses real projects or calls model services.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({ headless: true });
 try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
   const project = { id: 'canvas-qa', name: '画布测试项目', path: '/fixture', updated_at: '刚刚' };
   const image = { id: 1, name: '参考图片.png', path: '/spielberg-logo-s.png', kind: 'image', created_at: '1' };
   const scene = { id: 3, title: '默认场景', description: '', creation_mode: 'default', sort_order: 0, first_media_id: null, last_media_id: null, reference_media_id: null, videos: [] };
   const initial = { project, assets: [], media: [image, { ...image, id: 2, name: '参考音频.wav', kind: 'audio' }, { ...image, id: 3, name: '参考视频.mp4', kind: 'video' }], episodes: [{ id: 1, title: '第一集', description: '', scenes: [scene] }], prompts: [], settings: {} };
   const data = JSON.parse(sessionStorage.getItem('qa-data') || 'null') || initial;
   const boards = JSON.parse(sessionStorage.getItem('qa-boards') || '{}');
   window.__qaData = data; window.__qaBoards = boards; window.__qaRequests = []; window.__qaFail = false;
   const persist = () => { sessionStorage.setItem('qa-data', JSON.stringify(data)); sessionStorage.setItem('qa-boards', JSON.stringify(boards)); };
   const original = window.fetch.bind(window);
   window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.startsWith('/api/v1/')) return original(input, init);
    const path = url.pathname.slice('/api/v1'.length), method = init.method || 'GET';
    const payload = init.body instanceof File ? {} : init.body ? JSON.parse(init.body) : {};
    let result = null;
    if (path === '/projects') result = [project];
    if (path === '/actions/project' || path === '/actions/project/changes') result = data;
    if (path.endsWith('/episodes/1/scenes') && method === 'POST') {
     const next = { ...scene, id: Math.max(...data.episodes[0].scenes.map(s => s.id)) + 1, title: payload.title, creation_mode: payload.creation_mode || 'default', sort_order: data.episodes[0].scenes.length };
     data.episodes[0].scenes.push(next); result = next;
    }
    if (/\/scenes\/\d+$/.test(path) && method === 'PATCH') { const current = data.episodes[0].scenes.find(s => s.id === Number(path.split('/').pop())); Object.assign(current, payload); result = current; }
    if (path === '/actions/canvas/load') result = boards[payload.scene_id] || { revision: 0, draft: { version: 1, nodes: [], edges: [], viewport: { x: 80, y: 80, zoom: 1 } } };
    if (path === '/actions/canvas/save') {
     if (window.__qaFail) return new Response(JSON.stringify({ error: '模拟保存失败' }), { status: 400 });
     if (payload.revision !== (boards[payload.scene_id]?.revision || 0)) return new Response(JSON.stringify({ error: '画布已在其他窗口更新' }), { status: 400 });
     boards[payload.scene_id] = { draft: payload.draft, revision: payload.revision + 1 }; result = boards[payload.scene_id];
    }
    if (path.endsWith('/media') && method === 'GET') {
     const items = data.media.filter(m => m.kind === url.searchParams.get('kind') && m.name.includes(url.searchParams.get('query') || ''));
     result = { items, total: items.length };
    }
    if (path.endsWith('/media/upload')) {
     const file = init.body, m = { ...image, id: 30, name: file.name }; data.media.push(m); result = m;
    }
    if (path === '/actions/media/thumbnail') result = { path: '/spielberg-logo-s.png' };
    if (path === '/actions/generations/image') {
     window.__qaRequests.push(payload); result = { ...image, id: 100 + window.__qaRequests.length, name: '生成图片.png' }; data.media.push(result);
    }
    if (path === '/actions/generations/video') {
     window.__qaRequests.push(payload); result = { ...image, id: 20, name: '生成视频.mp4', kind: 'video' }; data.media.push(result);
     data.episodes[0].scenes.find(s => s.id === payload.scene_id).videos.push(result);
    }
    if (path === '/actions/scenes/select-video') { data.episodes[0].scenes.find(s => s.id === payload.scene_id).video_media_id = payload.media_id; result = { ok: true }; }
    if (path === '/actions/tasks') result = { items: [], has_more: false, next_cursor: null };
    persist(); return new Response(JSON.stringify({ data: result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
   };
  });
  await page.route('**/media?*', async route => {
   const path = new URL(route.request().url()).searchParams.get('path');
   if (path === '/spielberg-logo-s.png') await route.fulfill({ status: 302, headers: { Location: '/spielberg-logo-s.png' } }); else await route.fulfill({ status: 404, body: '' });
  });
  await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
  assert.equal(await page.getByRole('menuitem', { name: '无限画布', exact: true }).count(), 0);
  await page.getByRole('menuitem', { name: '剧集', exact: true }).click();
  async function create(mode, title) {
   await page.getByRole('button', { name: '新建场景', exact: true }).click();
   const modal = page.locator('.arco-modal:visible');
   await modal.getByLabel('新场景名称').fill(title);
   await modal.getByRole('button', { name: new RegExp(mode) }).click();
   await modal.getByRole('button', { name: '确定', exact: true }).click();
  }
  await create('默认方式', '默认创建验证'); await page.locator('.scene-editor-host').waitFor();
  assert.equal((await page.evaluate(() => window.__qaData.episodes[0].scenes.at(-1))).creation_mode, 'default');
  await page.getByRole('menuitem', { name: '剧集', exact: true }).click();
  await create('画布方式', '节点创作测试'); await page.locator('.ic-stage').waitFor();
  assert.equal(await page.locator('.ic-shelf').count(), 0);
  const bounds = await page.locator('.ic-stage').boundingBox(); assert.equal(bounds.x, 0); assert.equal(bounds.y, 0); assert.equal(bounds.width, 1600); assert.equal(bounds.height, 1100);
  assert.equal((await page.evaluate(() => window.__qaData.episodes[0].scenes.at(-1))).creation_mode, 'canvas');
  const stage = page.locator('.ic-stage');
  async function add(kind, x, y) { await stage.click({ button: 'right', position: { x, y } }); await page.getByRole('menuitem', { name: `添加${kind}节点`, exact: true }).click(); }
  async function choose(kind, name) {
   const node = page.locator(`.ic-${kind}`).last(); await node.getByRole('button', { name: /选择 \/ 上传/ }).click();
   const modal = page.locator('.ic-asset-picker:visible'); await modal.getByRole('button', { name: `选择${name}`, exact: true }).click();
  }
  await add('图片', 60, 70); const sb = await stage.boundingBox(), nb = await page.locator('.ic-image').boundingBox(); assert(Math.abs(nb.x - sb.x - 60) < 2); assert(Math.abs(nb.y - sb.y - 70) < 2); await choose('image', '参考图片.png');
  await add('音频', 60, 330); await choose('audio', '参考音频.wav');
  await add('视频', 420, 70); await choose('video', '参考视频.mp4');
  await add('视频', 800, 70);
  const output = await page.getByRole('button', { name: '输出参考图片.png', exact: true }).boundingBox();
  const input = await page.getByRole('button', { name: '输入视频节点', exact: true }).boundingBox();
  await page.mouse.move(output.x + output.width / 2, output.y + output.height / 2); await page.mouse.down();
  await page.mouse.move(input.x + input.width / 2, input.y + input.height / 2, { steps: 12 });
  assert.equal(await page.locator('.ic-link-preview').count(), 1); await page.mouse.up();
  assert.equal(await page.locator('.ic-edges g').count(), 1);
  for (const name of ['参考音频.wav', '参考视频.mp4']) { await page.getByRole('button', { name: `输出${name}`, exact: true }).click(); await page.getByRole('button', { name: '输入视频节点', exact: true }).click(); }
  assert.equal(await page.locator('.ic-edges g').count(), 3);
  assert.equal(await page.locator('.ic-image .ic-input').count(), 1); assert.equal(await page.locator('.ic-audio .ic-input').count(), 0);
  const header = page.locator('.ic-image header'), before = await header.boundingBox();
  await page.mouse.move(before.x + 100, before.y + 20); await page.mouse.down(); await page.mouse.move(before.x + 150, before.y + 50, { steps: 8 }); await page.mouse.up();
  assert((await header.boundingBox()).x - before.x > 45);
  await page.getByRole('button', { name: '撤销画布操作', exact: true }).click(); assert(Math.abs((await header.boundingBox()).x - before.x) < 2);
  await page.getByRole('button', { name: '重做画布操作', exact: true }).click();
  const target = page.locator('.ic-video').filter({ has: page.getByRole('button', { name: '输入视频节点', exact: true }) });
  await target.getByLabel('视频节点描述').fill('镜头从雨夜街道缓缓推进'); await target.getByRole('button', { name: '生成视频', exact: true }).click();
  await page.waitForFunction(() => window.__qaRequests.length === 1);
  await page.getByText('视频已生成，保存画布后保留节点结果', { exact: true }).waitFor();
  const request = await page.evaluate(() => window.__qaRequests[0]);
  assert.equal(request.operation, 'ref2v'); assert.deepEqual(request.image_media_ids, [1]); assert.deepEqual(request.reference_audio_media_ids, [2]); assert.deepEqual(request.reference_video_media_ids, [3]);
  await page.getByRole('button', { name: '输出生成视频.mp4', exact: true }).click(); await page.getByRole('button', { name: '输入参考视频.mp4', exact: true }).click(); await page.getByText('连接不能形成循环', { exact: true }).waitFor();
  await stage.press('Escape');
  await page.locator('.ic-video').filter({ has: page.getByRole('button', { name: '输入生成视频.mp4', exact: true }) }).getByRole('button', { name: '设为场景视频', exact: true }).click();
  await page.waitForFunction(() => window.__qaData.episodes[0].scenes.at(-1).video_media_id === 20);
  await page.evaluate(() => window.__qaFail = true); await page.getByRole('button', { name: '保存画布', exact: true }).click(); await page.getByText('Error: 模拟保存失败', { exact: true }).waitFor();
  await page.evaluate(() => window.__qaFail = false); await page.getByRole('button', { name: '保存画布', exact: true }).click(); await page.getByText('画布场景已保存', { exact: true }).waitFor();
  const id = await page.evaluate(() => window.__qaData.episodes[0].scenes.at(-1).id);
  assert.equal((await page.evaluate(id => window.__qaBoards[id], id)).draft.nodes.length, 4);
  await page.reload(); await page.getByRole('menuitem', { name: '剧集', exact: true }).click();
  await page.locator('.scene-row').filter({ hasText: '节点创作测试' }).getByRole('button', { name: '编辑', exact: true }).click(); await page.locator('.ic-node').first().waitFor(); assert.equal(await page.locator('.ic-node').count(), 4);
  const populated = page.locator('.ic-video').filter({ has: page.getByRole('button', { name: '输入生成视频.mp4', exact: true }) });
  await populated.getByRole('button', { name: '生成视频', exact: true }).click();
  await page.waitForFunction(() => window.__qaRequests.length === 1);
  await page.waitForFunction(() => document.querySelectorAll('.ic-node').length === 5);
  assert.equal(await page.getByRole('button', { name: '输出生成视频.mp4', exact: true }).count(), 2);
  assert.equal(await page.locator('.ic-edges g').count(), 4);
  await page.getByRole('button', { name: '适应画布', exact: true }).click();
  await page.screenshot({ path: '/tmp/spielberg-canvas-scene-qa.png' });

  await page.getByRole('button', { name: '返回场景列表', exact: true }).click(); await page.getByText('放弃未保存的修改？', { exact: true }).waitFor(); await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await page.getByRole('button', { name: '保存画布', exact: true }).click();
  await page.getByRole('button', { name: '返回场景列表', exact: true }).click(); await create('画布方式', '独立画布验证'); await page.getByText('让灵感，在这里连接', { exact: true }).waitFor(); assert.equal(await page.locator('.ic-node').count(), 0);
  await add('图片', 100, 100); await page.locator('.ic-image').getByRole('button', { name: /选择 \/ 上传/ }).click();
  await page.getByLabel('上传节点素材').setInputFiles({ name: '新图片.png', mimeType: 'image/png', buffer: Buffer.from('fixture') }); await page.locator('.ic-asset-picker:visible').waitFor({ state: 'hidden' }); await page.getByRole('button', { name: '输出新图片.png', exact: true }).waitFor();
  // Pull from an input to create an upstream image in one undoable operation.
  await add('视频', 850, 150);
  const reverseInput = await page.locator('.ic-video .ic-input').boundingBox();
  await page.mouse.move(reverseInput.x + 12, reverseInput.y + 12); await page.mouse.down();
  await page.mouse.move(480, 420, { steps: 12 }); await page.mouse.up();
  await page.getByRole('menuitem', { name: '添加图片节点', exact: true }).click();
  assert.equal(await page.locator('.ic-edges g').count(), 1);
  const emptyImage = page.locator('.ic-image').last();
  await emptyImage.getByRole('button', { name: '文生图 / 图生图', exact: true }).click();
  await page.getByLabel('图片节点描述').fill('白色背景上的一朵花');
  await page.getByRole('button', { name: '生成图片', exact: true }).click();
  await page.getByText('图片已生成，保存画布后保留节点结果', { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.__qaRequests.at(-1))).operation, 't2i');
  const generatedImageId = await page.evaluate(() => window.__qaData.media.at(-1).id);
  await emptyImage.getByRole('button', { name: '图生图', exact: true }).click();
  await page.getByLabel('图片节点描述').fill('把花朵改为红色');
  await page.getByRole('button', { name: '生成图片', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.ic-image').length === 3);
  const imageRequest = await page.evaluate(() => window.__qaRequests.at(-1));
  assert.equal(imageRequest.operation, 'i2i'); assert.deepEqual(imageRequest.image_media_ids, [generatedImageId]);
  assert.equal(await page.locator('.ic-edges g').count(), 2);
  await page.getByRole('button', { name: '保存画布', exact: true }).click();
  await page.getByText('画布场景已保存', { exact: true }).waitFor();
  for (const width of [1024, 768, 390]) { await page.setViewportSize({ width, height: 900 }); await page.getByRole('button', { name: '适应画布', exact: true }).click(); assert(await stage.isVisible()); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); }
  assert.deepEqual(errors, []);
  console.log('PASS: 默认/画布场景创建、右键节点、素材选择和上传、三种输入到视频、循环保护、参考生成请求、场景视频选择、撤销重做、保存重开、失败重试、独立场景与响应布局');
 } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
