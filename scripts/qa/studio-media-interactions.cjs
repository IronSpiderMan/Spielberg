// Isolated fixtures: no real project, upload, or generation service is changed.
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {})});
  const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'spielberg-studio-media-'));
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const project = {id: 'qa-studio-media', name: '素材交互测试', path: '/fixture', updated_at: '1'};
      const image = {id: 1, name: '角色 正面.png', kind: 'image', path: '/spielberg-logo-s.png', created_at: '1'};
      const data = {
        project, assets: [], episodes: [], prompts: [],
        media: [image, {...image, id: 2, name: 'Forest.Scene.png'}, {...image, id: 3, name: '夜景.png'}, {...image, id: 4, kind: 'video', name: '视频.mp4'}],
        settings: {image: {provider: 'openai', base_url: 'https://fixture.invalid/v1', api_key: 'fixture', model: 'gpt-image-1'}},
      };
      window.__qaCalls = [];
      window.__qaData = data;
      window.__qaHoldGeneration = false;
      const original = window.fetch.bind(window);
      window.fetch = async (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (!url.pathname.startsWith('/api/v1/')) return original(input, init);
        let path = url.pathname.slice('/api/v1'.length);
        if (path.startsWith('/actions/')) path = path.slice('/actions'.length);
        const payload = init.body ? JSON.parse(init.body) : {};
        window.__qaCalls.push({path, payload});
        let result = {ok: true};
        if (path === '/projects') result = [project];
        if (path === '/project' || path === '/project/changes') result = structuredClone(data);
        if (path === '/tasks') result = {items: [], has_more: false};
        if (path === '/app/settings/load') result = {projects_directory: '/fixture'};
        if (path === '/skills/list') result = {items: [], directory: '/fixture/skills'};
        if (path === '/media/thumbnail') result = {path: image.path};
        if (path === '/generations/image') {
          if (window.__qaHoldGeneration) await new Promise(resolve => {window.__qaFinishGeneration = resolve;});
          // Deliberately leave this out of /project to exercise the pending cache.
          result = {...image, id: 50, name: '新生成.png'};
        }
        return new Response(JSON.stringify({data: result}), {status: 200, headers: {'Content-Type': 'application/json'}});
      };
    });
    await page.route('**/media?*', route => route.fulfill({status: 302, headers: {Location: '/spielberg-logo-s.png'}}));
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
    const studio = page.locator('.image-creation-split:visible');
    const left = studio.locator('.image-reference-drop-target');
    const library = studio.getByRole('region', {name: '图片素材', exact: true});
    const search = library.getByRole('textbox', {name: '搜索图片素材', exact: true});
    const cards = library.locator('.studio-media-item');
    const prompt = left.getByRole('textbox', {name: '画面描述', exact: true});
    const chips = left.locator('.creation-reference-chip');
    const card = name => library.getByRole('button', {name: `预览 ${name}`, exact: true});
    await search.waitFor();
    assert.equal(await cards.count(), 3);
    await search.fill('  fOrEsT  ');
    assert.equal(await cards.count(), 1);
    assert.match(await library.locator('h2').innerText(), /1\s*\/\s*3/);
    await card('Forest.Scene.png').click();
    const preview = page.locator('.image-preview-modal:visible');
    await preview.waitFor();
    await preview.locator('.arco-modal-close-icon').click();
    await preview.waitFor({state: 'hidden'});
    assert.equal(await search.inputValue(), '  fOrEsT  ');
    await search.fill('不存在的素材');
    assert.equal(await cards.count(), 0);
    await library.getByText('没有匹配的图片素材', {exact: true}).waitFor();
    await library.getByRole('button', {name: '清除搜索', exact: true}).click();
    assert.equal(await cards.count(), 3);
    await search.fill('角色');
    assert.equal(await cards.count(), 1);
    await search.fill('');
    await prompt.fill('保留这段描述');

    // Start from the actual thumbnail so native img URL dragging is covered.
    await card('角色 正面.png').locator('img').dragTo(prompt);
    await chips.waitFor();
    assert.equal(await left.getByRole('tab', {name: '图生图', exact: true}).getAttribute('aria-selected'), 'true');
    assert.equal(await prompt.inputValue(), '保留这段描述');
    assert.equal(await chips.count(), 1);
    await card('角色 正面.png').locator('img').dragTo(prompt);
    assert.equal(await chips.count(), 1, 'Dropping the same image twice must not duplicate it');
    await card('Forest.Scene.png').locator('img').dragTo(prompt);
    assert.equal(await chips.count(), 2, 'Dropping another image keeps existing references');

    const dropPayload = async raw => {
      const transfer = await page.evaluateHandle(raw => {
        const transfer = new DataTransfer();
        transfer.setData('application/x-spielberg-image', raw);
        return transfer;
      }, typeof raw === 'string' ? raw : JSON.stringify(raw));
      await prompt.dispatchEvent('dragenter', {dataTransfer: transfer});
      await prompt.dispatchEvent('dragover', {dataTransfer: transfer});
      await prompt.dispatchEvent('drop', {dataTransfer: transfer});
      await transfer.dispose();
    };
    for (const payload of ['invalid json', null, {projectId: 'other-project', mediaId: 3}, {projectId: 'qa-studio-media', mediaId: 4}, {projectId: 'qa-studio-media', mediaId: 999}, {projectId: 'qa-studio-media', mediaId: '3'}]) {
      await dropPayload(payload);
      assert.equal(await chips.count(), 2, `Reject invalid or unavailable media: ${JSON.stringify(payload)}`);
      assert.equal(await prompt.inputValue(), '保留这段描述');
    }
    assert.equal(await left.evaluate(el => el.classList.contains('is-drag-over')), false);

    await page.evaluate(() => {window.__qaHoldGeneration = true;});
    await left.getByRole('button', {name: '生成 1 张图片', exact: true}).click();
    await page.waitForFunction(() => typeof window.__qaFinishGeneration === 'function');
    assert.equal(await card('夜景.png').getAttribute('draggable'), 'false');
    await dropPayload({projectId: 'qa-studio-media', mediaId: 3});
    assert.equal(await chips.count(), 2, 'Busy generation must reject new references');
    assert.equal(await left.evaluate(el => el.classList.contains('is-drag-over')), false);
    const request = await page.evaluate(() => window.__qaCalls.find(call => call.path === '/generations/image').payload);
    assert.equal(request.operation, 'i2i');
    assert.deepEqual(request.image_media_ids, [1, 2]);
    assert.equal(request.prompt, '保留这段描述');
    await page.evaluate(() => {window.__qaFinishGeneration();});
    await card('新生成.png').waitFor();
    await page.waitForFunction(() => document.querySelector('.studio-media-item[aria-label="预览 新生成.png"]')?.draggable === true);
    assert.equal(await page.evaluate(() => window.__qaData.media.some(item => item.id === 50)), false);
    await card('新生成.png').locator('img').dragTo(prompt);
    assert.equal(await chips.count(), 3, 'A generated image remains selectable before the project snapshot catches up');
    await chips.filter({hasText: '新生成.png'}).waitFor();
    assert.equal(await prompt.inputValue(), '保留这段描述');
    await left.getByRole('button', {name: '移除 Forest.Scene.png', exact: true}).click();
    assert.equal(await chips.count(), 2);
    await page.screenshot({animations: 'disabled', path: path.join(screenshots, 'desktop.png')});
    await page.getByRole('button', {name: '切换到暗夜模式', exact: true}).click();
    await page.screenshot({animations: 'disabled', path: path.join(screenshots, 'dark.png')});
    await page.setViewportSize({width: 390, height: 844});
    await search.scrollIntoViewIfNeeded();
    assert(await library.evaluate(el => el.scrollWidth <= el.clientWidth), 'Search and media cards fit on narrow screens');
    await library.screenshot({animations: 'disabled', path: path.join(screenshots, 'mobile.png')});
    assert.deepEqual(errors, []);
    console.log(`PASS: search, clear/empty, preview, native thumbnail drag, auto i2i, deduplication, prompt preservation, invalid/busy drops, generation request and pending media; screenshots: ${screenshots}`);
  } catch (error) {
    await page.screenshot({animations: 'disabled', path: path.join(screenshots, 'failure.png'), fullPage: true}).catch(() => {});
    console.error(`Failure screenshot: ${path.join(screenshots, 'failure.png')}`);
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error); process.exit(1);});
