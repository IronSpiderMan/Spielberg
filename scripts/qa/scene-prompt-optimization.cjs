// Isolated optimization fixture; never calls real projects or LLM services.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('spielberg-theme', 'dark');
      const project = { id: 'qa-optimization', name: '提示词优化测试', path: '/fixture', updated_at: '刚刚' };
      const media = [
        { id: 101, name: '角色.png', kind: 'image' },
        { id: 102, name: '卧室.png', kind: 'image' },
        { id: 103, name: '动作.mp4', kind: 'video' },
        { id: 104, name: '对白.wav', kind: 'audio' },
      ].map(item => ({ ...item, path: '/spielberg-logo-s.png', created_at: '2026-11-06' }));
      const scene = { id: 1, title: '夜晚公寓', sort_order: 0, description: '夜晚，@角色 在 @卧室 中转身，说：“我回来了。”', prompt: '原有视频 Prompt', videos: [],
        generation_options: { video_mode: 'i2v', duration: 15, aspect_ratio: '16:9', reference_media_ids: [102, 101], reference_video_media_ids: [103], reference_audio_media_ids: [104] } };
      const data = { project, media, assets: [], episodes: [{ id: 1, title: '测试剧集', description: '', scenes: [scene] }], prompts: [],
        settings: { ref2v: { url: 'https://example.invalid', api_key: '' }, fl2v: { url: 'https://example.invalid', api_key: '' } } };
      window.__qaData = data;
      window.__qaOptimizations = [];
      window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
        if (command !== 'api_request') return null;
        if (['/project', '/project/changes'].includes(args.path)) return structuredClone(data);
        if (args.path === '/projects') return [project];
        if (args.path === '/tasks') return { items: [], has_more: false, next_cursor: null };
        if (args.path === '/screenplays') return [];
        if (args.path === '/scripts/load') return null;
        if (args.path === '/scenes/update') Object.assign(scene, args.payload);
        if (args.path === '/prompts/optimize') {
          window.__qaOptimizations.push(args.payload);
          return await new Promise((resolve, reject) => { window.__qaCompleteOptimization = (prompt, error) => error ? reject(new Error(error)) : resolve({ prompt }); });
        }
        return { ok: true };
      } };
    });
    await require('./http-fixture.cjs')(page);
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
    await page.getByRole('menuitem', { name: '剧集', exact: true }).click();
    await page.locator('.episode-card').getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByRole('tab', { name: '场景', exact: true }).click();
    await page.getByRole('button', { name: '编辑场景：夜晚公寓', exact: true }).click();
    const editor = page.locator('.scene-editor-page');
    const description = editor.locator('textarea').nth(0);
    const prompt = editor.locator('textarea').nth(1);
    const originalDescription = await description.inputValue();
    const optimize = () => editor.getByRole('button', { name: '优化描述', exact: true });
    const h3 = () => page.getByRole('menuitem', { name: '优化成 minimax-h3 形式', exact: true });
    const wan = () => page.getByRole('menuitem', { name: '优化成 wan3.0 形式', exact: true });
    assert.equal(await page.getByRole('button', { name: '优化指令', exact: true }).count(), 0);
    assert.equal(await page.getByText('自定义提示词优化指令', { exact: true }).count(), 0);
    const hint = editor.getByText('可在此粘贴图片，自动添加到全能参考（最多 9 张）', { exact: true });
    await hint.waitFor();
    assert.equal(await hint.evaluate(node => !!node.closest('.scene-description-label')), true);
    const titleBox = await editor.getByText('场景描述', { exact: true }).boundingBox();
    const hintBox = await hint.boundingBox();
    assert(hintBox.x >= titleBox.x + titleBox.width, 'Paste hint should sit to the right of the title on desktop');
    assert(Math.abs(hintBox.y - titleBox.y) < 8, 'Paste hint should share the title row on desktop');

    await optimize().hover();
    await h3().waitFor();
    await wan().waitFor();
    if (process.env.QA_SCREENSHOT) await page.screenshot({ path: process.env.QA_SCREENSHOT });
    await h3().click();
    await page.waitForFunction(() => window.__qaOptimizations.length === 1);
    assert(await editor.getByRole('button', { name: '正在优化…', exact: true }).isDisabled());
    assert(await description.isDisabled());
    assert(await prompt.isDisabled());
    assert(await editor.getByRole('button', { name: '保存场景', exact: true }).isDisabled());
    const first = await page.evaluate(() => window.__qaOptimizations[0]);
    assert.equal(first.prompt_format, 'minimax-h3');
    assert.equal(first.h3_mode, 'ref2va');
    assert.equal(first.duration, 15);
    assert.deepEqual(first.image_media_ids, [102, 101]);
    assert.deepEqual(first.reference_video_media_ids, [103]);
    assert.deepEqual(first.reference_audio_media_ids, [104]);
    assert.match(first.prompt, /<Picture 2>/);
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.querySelector('.scene-description-label button').click());
    assert.equal(await page.evaluate(() => window.__qaOptimizations.length), 1, 'Disabled trigger must not submit a duplicate request');
    await page.evaluate(() => window.__qaCompleteOptimization('H3 优化结果'));
    await optimize().waitFor();
    assert.equal(await description.inputValue(), originalDescription);
    assert.equal(await prompt.inputValue(), 'H3 优化结果');

    await optimize().hover();
    await wan().click();
    await page.waitForFunction(() => window.__qaOptimizations.length === 2);
    const second = await page.evaluate(() => window.__qaOptimizations[1]);
    assert.equal(second.prompt_format, 'wan3.0');
    assert.equal(second.video_mode, 'i2v');
    assert.equal(second.duration, 15);
    assert.equal(second.h3_mode, undefined);
    assert.equal(second.prompt, originalDescription);
    assert.deepEqual(second.image_media_ids, [102, 101]);
    await page.mouse.move(0, 0);
    await page.evaluate(() => window.__qaCompleteOptimization('Wan 优化结果：@角色 在 @卧室 中转身。'));
    await optimize().waitFor();
    assert.equal(await description.inputValue(), originalDescription);
    assert.equal(await prompt.inputValue(), 'Wan 优化结果：@角色 在 @卧室 中转身。');

    await optimize().hover();
    await wan().click();
    await page.waitForFunction(() => window.__qaOptimizations.length === 3);
    await page.mouse.move(0, 0);
    await page.evaluate(() => window.__qaCompleteOptimization(null, '测试优化失败'));
    await page.getByText('Error: 测试优化失败', { exact: true }).waitFor();
    await optimize().waitFor();
    assert(await optimize().isEnabled());
    assert(await description.isEnabled());
    assert.equal(await description.inputValue(), originalDescription);
    assert.equal(await prompt.inputValue(), 'Wan 优化结果：@角色 在 @卧室 中转身。');

    // A narrower editor may wrap the hint, while preserving access to the menu.
    await page.locator('.arco-message').first().waitFor({ state: 'hidden' });
    await page.setViewportSize({ width: 760, height: 1024 });
    await optimize().hover();
    await wan().waitFor();
    await wan().hover();
    const headingBox = await editor.locator('.scene-description-label .scene-description-heading').boundingBox();
    const buttonBox = await optimize().boundingBox();
    assert(headingBox.x + headingBox.width <= buttonBox.x + 1, 'Hint must not overlap the optimize action');
    assert(await editor.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'Narrow scene editor must not overflow horizontally');
    if (process.env.QA_MOBILE_SCREENSHOT) await page.screenshot({ path: process.env.QA_MOBILE_SCREENSHOT });
    await page.mouse.move(0, 0);
    await description.fill('');
    assert(await optimize().isDisabled());
    assert.deepEqual(errors, []);
    console.log('PASS: hover format menu, hint placement, H3/Wan routing and references, optimization locks, description preservation, failure recovery, narrow layout, empty input');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
