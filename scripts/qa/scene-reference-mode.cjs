// Isolated regression fixture: never calls real projects or generation services.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const project = { id: 'qa-reference', name: '全能参考回归测试', path: '/fixture', updated_at: '刚刚' };
      const media = [
        { id: 101, name: '角色.png', kind: 'image' },
        { id: 102, name: '卧室.png', kind: 'image' },
        { id: 103, name: '动作.mp4', kind: 'video' },
        { id: 104, name: '对白.wav', kind: 'audio' },
      ].map(item => ({ ...item, path: '/spielberg-logo-s.png', created_at: '2026-10-30' }));
      const base = { description: '', prompt: '只有视频 Prompt 也能生成', first_media_id: null, last_media_id: null, reference_media_id: null, videos: [] };
      const scenes = [
        { ...base, id: 1, title: '历史 ref2v', sort_order: 0, reference_media_id: 101, generation_options: { video_mode: 'ref2v', duration: 15, aspect_ratio: '16:9', reference_media_ids: [102, 101] } },
        { ...base, id: 2, title: '当前 i2v', sort_order: 1, reference_media_id: 101, generation_options: { video_mode: 'i2v', duration: 10, aspect_ratio: '9:16', reference_media_ids: [101] } },
        { ...base, id: 3, title: '音视频参考推断', sort_order: 2, generation_options: { reference_video_media_ids: [103], reference_audio_media_ids: [104] } },
        { ...base, id: 4, title: '保留首尾帧选择', sort_order: 3, first_media_id: 102, generation_options: { video_mode: 'fl2v', reference_media_ids: [101] } },
      ];
      const data = { project, media, roles: [], episodes: [{ id: 1, title: '测试剧集', description: '', scenes }], prompts: [], settings: { ref2v: { url: 'https://example.invalid', api_key: '' }, fl2v: { url: 'https://example.invalid', api_key: '' } } };
      window.__qaData = data;
      window.__qaGenerations = [];
      window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
        if (command !== 'api_request') return null;
        if (['/project', '/project/changes'].includes(args.path)) return structuredClone(data);
        if (args.path === '/projects') return [project];
        if (args.path === '/tasks') return { items: [], has_more: false, next_cursor: null };
        if (args.path === '/screenplays') return [];
        if (args.path === '/scripts/load') return null;
        if (args.path === '/scenes/update') Object.assign(scenes.find(scene => scene.id === args.payload.id), args.payload);
        if (args.path === '/generations/video') {
          window.__qaGenerations.push(args.payload);
          return { id: 201, kind: 'video', name: '测试视频.mp4', path: '/fixture.mp4', created_at: '2026-10-30' };
        }
        return { ok: true };
      } };
    });
    await require('./http-fixture.cjs')(page);
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');

    // Batch submission must resolve legacy data before anyone opens/saves it.
    await page.getByRole('menuitem', { name: '剧集', exact: true }).click();
    await page.getByRole('button', { name: '生成 / 合并', exact: true }).click();
    await page.getByRole('button', { name: '生成 4 个视频', exact: true }).click();
    await page.waitForFunction(() => window.__qaGenerations.length === 4);
    const requests = await page.evaluate(() => window.__qaGenerations);
    for (const request of requests.slice(0, 3)) {
      assert.equal(request.operation, 'ref2v');
      assert.equal(request.video_mode, 'i2v');
      assert.equal(request.first_media_id, null);
      assert.equal(request.last_media_id, null);
    }
    assert.deepEqual(requests[0].image_media_ids, [102, 101]);
    assert.equal(requests[0].duration, 15);
    assert.equal(requests[1].aspect_ratio, '9:16');
    assert.deepEqual(requests[2].reference_video_media_ids, [103]);
    assert.deepEqual(requests[2].reference_audio_media_ids, [104]);
    assert.equal(requests[2].duration, 5);
    assert.equal(requests[3].operation, 'fl2v');
    assert.equal(requests[3].first_media_id, 102);
    assert.deepEqual(requests[3].image_media_ids, []);
    await page.getByRole('button', { name: '关闭', exact: true }).click();

    await page.locator('.episode-card').getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByRole('tab', { name: '场景', exact: true }).click();
    const openLegacy = () => page.getByRole('button', { name: '编辑场景：历史 ref2v', exact: true }).click();
    await openLegacy();
    const editor = page.locator('.scene-editor-page');
    await editor.getByRole('tab', { name: '全能参考', exact: true }).waitFor();
    assert.equal(await editor.getByRole('tab', { name: '全能参考', exact: true }).getAttribute('aria-selected'), 'true');
    await editor.locator('.scene-reference-thumb').nth(1).waitFor();
    assert.equal(await editor.locator('.scene-reference-thumb').count(), 2);
    assert.match(await editor.locator('.scene-reference-thumb').first().textContent(), /卧室/);
    assert.equal(await editor.getByRole('button', { name: '生成新视频', exact: true }).isEnabled(), true);
    if (process.env.QA_SCREENSHOT) await editor.screenshot({ path: process.env.QA_SCREENSHOT });
    await editor.getByRole('button', { name: '生成新视频', exact: true }).click();
    await page.waitForFunction(() => window.__qaGenerations.length === 5);
    const saved = await page.evaluate(() => window.__qaData.episodes[0].scenes[0]);
    assert.equal(saved.generation_options.video_mode, 'i2v');
    assert.deepEqual(saved.generation_options.reference_media_ids, [102, 101]);
    assert.equal(saved.description, '');
    assert.equal(saved.prompt, '只有视频 Prompt 也能生成');
    assert.deepEqual((await page.evaluate(() => window.__qaGenerations[4])).image_media_ids, [102, 101]);

    // Switching modes still works; only the active mode's inputs are submitted.
    await editor.getByRole('tab', { name: '首尾帧', exact: true }).click();
    await editor.getByRole('button', { name: '选择首帧', exact: true }).waitFor();
    await editor.getByRole('tab', { name: '全能参考', exact: true }).click();
    assert.equal(await editor.locator('.scene-reference-thumb').count(), 2);
    await editor.getByRole('button', { name: '保存场景', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    await page.locator('.episode-card').getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByRole('tab', { name: '场景', exact: true }).click();
    await openLegacy();
    await editor.locator('.scene-reference-thumb').nth(1).waitFor();
    assert.equal(await editor.getByRole('tab', { name: '全能参考', exact: true }).getAttribute('aria-selected'), 'true');
    assert.deepEqual(errors, []);
    console.log('PASS: ref2v first-open rendering, reference order, mixed-mode batch, multimodal inference, prompt-only generation, canonical save/reopen, mode switching');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
