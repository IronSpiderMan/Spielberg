// Isolated UI fixture: never reads real projects or calls a generation service.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  let page;
  try {
    page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('spielberg-theme', 'dark');
      const project = { id: 'qa-reference-media', name: '音视频参考回归', path: '/fixture', updated_at: '刚刚' };
      const media = [
        { id: 101, name: '卧室.png', kind: 'image' },
        { id: 103, name: '镜头运动.mp4', kind: 'video' },
        { id: 104, name: '魏来台词录音原文件.wav', kind: 'audio' },
        { id: 105, name: '猫叫.wav', kind: 'audio' },
        { id: 106, name: '旁白.wav', kind: 'audio' },
        { id: 107, name: '雨声.wav', kind: 'audio' },
      ].map(item => ({ ...item, path: item.kind === 'image' ? '/spielberg-logo-s.png' : `/fixture/${item.id}`, created_at: '2026-11-06' }));
      const asset = (id, name, category, audios) => ({ id, name, category, audios, enabled: true, description: '', design_media_id: null, images: [] });
      const assets = [
        asset(1, '魏来', 'person', [{ ...media[2], name: '低声耳语' }]),
        asset(2, '小猫', 'creature', [{ ...media[3], name: '呼唤叫声' }]),
        asset(3, '旧版旁白角色', undefined, [{ ...media[4], name: '平静旁白' }]),
        asset(4, '不支持音频的地点', 'location', [{ ...media[5], name: '不应显示的雨声' }]),
        asset(5, '额外角色', 'person', [
          { id: 109, name: '资产专属的长名称音频参考_用于测试窄屏下标题省略与播放器边界.wav', kind: 'audio', path: '/fixture/109', created_at: '2026-11-06' },
          { ...media[0], name: '不应作为音频显示的图片' },
        ]),
      ];
      const scene = { id: 1, title: '混合来源参考', description: '保留场景描述', prompt: '人物轻声说话，镜头缓慢推进', sort_order: 0,
        first_media_id: null, last_media_id: null, reference_media_id: null, videos: [],
        generation_options: { video_mode: 'i2v', reference_media_ids: [101], duration: 5, aspect_ratio: '16:9' } };
      const data = { project, media, assets, episodes: [{ id: 1, title: '测试剧集', description: '', scenes: [scene] }], prompts: [],
        settings: { ref2v: { url: 'https://example.invalid', api_key: '' } } };
      window.__qaData = data;
      window.__qaGenerations = [];
      window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
        if (command !== 'api_request') return null;
        if (['/project', '/project/changes'].includes(args.path)) return structuredClone(data);
        if (args.path === '/projects') return [project];
        if (args.path === '/tasks') return { items: [], has_more: false, next_cursor: null };
        if (args.path === '/screenplays') return [];
        if (args.path === '/scripts/load') return null;
        if (args.path === '/media/thumbnail') return { path: '/spielberg-logo-s.png' };
        if (args.path === '/scenes/update') Object.assign(scene, args.payload);
        if (args.path === '/generations/video') {
          window.__qaGenerations.push(args.payload);
          return { id: 201, kind: 'video', name: '隔离生成结果.mp4', path: '/fixture/result', created_at: '2026-11-06' };
        }
        return { ok: true };
      } };
    });
    await require('./http-fixture.cjs')(page);
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
    await page.getByRole('menuitem', { name: '剧集', exact: true }).click();
    const edit = async () => {
      if (!await page.getByRole('button', { name: '编辑场景：混合来源参考', exact: true }).isVisible()) {
        await page.locator('.episode-card').getByRole('button', { name: '编辑', exact: true }).click();
        await page.getByRole('tab', { name: '场景', exact: true }).click();
      }
      await page.getByRole('button', { name: '编辑场景：混合来源参考', exact: true }).click();
    };
    await edit();
    const editor = page.locator('.scene-editor-page');
    const video = editor.getByRole('region', { name: '参考视频', exact: true });
    const audio = editor.getByRole('region', { name: '参考音频', exact: true });
    const selectedIds = section => section.locator('.reference-media-selected-item').evaluateAll(items => items.map(item => Number(item.dataset.mediaId)));
    const openPicker = async (kind, source = '素材库') => {
      await editor.getByRole('button', { name: `添加参考${kind}`, exact: true }).click();
      await page.locator('.reference-media-source-menu:visible').getByRole('button', { name: `从${source}选择`, exact: true }).click();
      const dialog = page.locator('.reference-media-modal:visible');
      await dialog.waitFor();
      await dialog.getByText(`选择参考${kind}`, { exact: true }).waitFor();
      return dialog;
    };
    const finish = dialog => dialog.getByRole('button', { name: '完成选择', exact: true }).click();

    let dialog = await openPicker('视频');
    await dialog.getByRole('button', { name: '选择参考视频 镜头运动.mp4', exact: true }).click();
    await finish(dialog);
    assert.deepEqual(await selectedIds(video), [103]);
    await video.getByRole('button', { name: '预览参考视频 镜头运动.mp4', exact: true }).click();
    await page.getByRole('button', { name: '关闭视频预览', exact: true }).click();

    dialog = await openPicker('音频');
    await dialog.getByLabel('搜索参考音频', { exact: true }).fill('魏来台词');
    await dialog.getByRole('button', { name: '选择参考音频 魏来台词录音原文件.wav', exact: true }).click();
    await dialog.getByLabel('搜索参考音频', { exact: true }).fill('');
    await dialog.getByRole('tab', { name: '资产库', exact: true }).click();
    // An asset's alias represents the same media ID, not an additional selection.
    await dialog.getByRole('button', { name: '取消选择参考音频 魏来 · 低声耳语', exact: true }).waitFor();
    assert.deepEqual(await selectedIds(audio), [104]);
    assert.equal(await dialog.getByText('不应显示的雨声', { exact: true }).count(), 0);
    assert.equal(await dialog.getByText('不应作为音频显示的图片', { exact: true }).count(), 0);
    await dialog.getByLabel('搜索参考音频', { exact: true }).fill('小猫');
    await dialog.getByRole('button', { name: '选择参考音频 小猫 · 呼唤叫声', exact: true }).click();
    assert.equal(await dialog.getByRole('button', { name: '取消选择参考音频 魏来 · 低声耳语', exact: true }).count(), 0);
    await dialog.getByLabel('搜索参考音频', { exact: true }).fill('平静旁白');
    await dialog.getByRole('button', { name: '选择参考音频 旧版旁白角色 · 平静旁白', exact: true }).click();
    await dialog.getByLabel('搜索参考音频', { exact: true }).fill('');
    assert.deepEqual(await selectedIds(audio), [104, 105, 106]);
    const extraName = '资产专属的长名称音频参考_用于测试窄屏下标题省略与播放器边界.wav';
    assert.equal(await dialog.getByRole('button', { name: `选择参考音频 额外角色 · ${extraName}`, exact: true }).isDisabled(), true);
    await dialog.getByRole('tab', { name: '素材库', exact: true }).click();
    assert.equal(await dialog.getByRole('button', { name: '选择参考音频 雨声.wav', exact: true }).isDisabled(), true);
    await dialog.getByRole('button', { name: '取消选择参考音频 魏来台词录音原文件.wav', exact: true }).click();
    assert.deepEqual(await selectedIds(audio), [105, 106]);
    await dialog.getByRole('tab', { name: '资产库', exact: true }).click();
    await dialog.getByRole('button', { name: '选择参考音频 魏来 · 低声耳语', exact: true }).click();
    await finish(dialog);
    assert.deepEqual(await selectedIds(audio), [105, 106, 104]);
    await audio.locator('[data-media-id="104"]').getByRole('button', { name: /^移除参考音频 / }).click();
    dialog = await openPicker('音频', '资产库');
    assert.equal(await dialog.getByRole('tab', { name: '资产库', exact: true }).getAttribute('aria-selected'), 'true');
    await dialog.getByRole('button', { name: `选择参考音频 额外角色 · ${extraName}`, exact: true }).click();
    fs.mkdirSync('/tmp/spielberg-reference-media', { recursive: true });
    await page.screenshot({ path: '/tmp/spielberg-reference-media/desktop-asset-picker.png', animations: 'disabled' });
    await finish(dialog);
    assert.deepEqual(await selectedIds(audio), [105, 106, 109]);
    assert.equal(await audio.locator('audio[controls]').count(), 3);

    fs.mkdirSync('/tmp/spielberg-reference-media', { recursive: true });
    const desktopVideo = await video.boundingBox();
    const desktopAudio = await audio.boundingBox();
    assert(Math.abs(desktopVideo.y - desktopAudio.y) < 3, 'Video and audio references should share a row on desktop');
    await editor.screenshot({ path: '/tmp/spielberg-reference-media/desktop-dark.png', animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    await audio.scrollIntoViewIfNeeded();
    const narrow = await audio.boundingBox();
    assert(narrow.x >= 0 && narrow.x + narrow.width <= 391, 'Audio references should fit the mobile viewport');
    assert.equal(await audio.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
    await page.screenshot({ path: '/tmp/spielberg-reference-media/mobile-dark.png', animations: 'disabled' });
    dialog = await openPicker('音频', '资产库');
    assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'Asset picker should not overflow on mobile');
    await page.screenshot({ path: '/tmp/spielberg-reference-media/mobile-asset-picker.png', animations: 'disabled' });
    await finish(dialog);
    await page.setViewportSize({ width: 1440, height: 1100 });

    await editor.getByRole('button', { name: '保存场景', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    const saved = await page.evaluate(() => window.__qaData.episodes[0].scenes[0]);
    assert.equal(saved.description, '保留场景描述');
    assert.deepEqual(saved.generation_options.reference_video_media_ids, [103]);
    assert.deepEqual(saved.generation_options.reference_audio_media_ids, [105, 106, 109]);
    await edit();
    assert.deepEqual(await selectedIds(video), [103]);
    assert.deepEqual(await selectedIds(audio), [105, 106, 109]);
    await editor.getByRole('button', { name: '生成新视频', exact: true }).click();
    await page.waitForFunction(() => window.__qaGenerations.length === 1);
    const request = await page.evaluate(() => window.__qaGenerations[0]);
    assert.equal(request.operation, 'ref2v');
    assert.deepEqual(request.reference_video_media_ids, [103]);
    assert.deepEqual(request.reference_audio_media_ids, [105, 106, 109]);
    assert.deepEqual(errors, []);
    console.log('PASS: video preview, audio library/asset selection, alias/legacy categories, shared IDs/limits, removal, mobile layout, save/reopen and generation payload');
  } catch (error) {
    if (page) {
      fs.mkdirSync('/tmp/spielberg-reference-media', { recursive: true });
      await page.screenshot({ path: '/tmp/spielberg-reference-media/failure.png', fullPage: true }).catch(() => {});
      console.error(await page.locator('body').innerText().catch(() => 'Unable to read the failed page'));
    }
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
