// Isolated HTTP fixture: exercises selection without touching user projects.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

(async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'spielberg-scene-video-picker-'));
  const fixture = path.join(output, 'video.mp4');
  const generated = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=12', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', fixture]);
  assert.equal(generated.status, 0, generated.stderr?.toString());
  const bytes = fs.readFileSync(fixture);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(10000);
  const project = { id: 'qa-scene-picker', name: '片段视频选择测试', path: '/fixture', updated_at: '1' };
  const videos = Array.from({ length: 29 }, (_, index) => ({ id: 29 - index, name: `${index === 28 ? '远页特写' : `镜头 ${String(29 - index).padStart(2, '0')}`} · 教室里的黄昏.mp4`, kind: 'video', path: `/fixture/${29 - index}.mp4`, created_at: '2026-11-07' }));
  const scene = { id: 1, scene_id: 1, title: '教室重逢', description: '保留原来的片段描述', prompt: '', sort_order: 0, video_media_id: 29, videos: [videos[0], videos[1]] };
  const data = { project, media: videos, assets: [], episodes: [{ id: 1, title: '第一集', description: '', clips: [scene], scenes: [{id:scene.id,title:scene.title,generation_mode:'clips',clips:[scene],reference_media_ids:[],reference_audio_media_ids:[]}], playback_units: [] }], prompts: [], settings: {} };
  const requests = [], attachments = [];
  let failList = false, failAttach = false, failUpload = false, holdAttach = false, finishAttach, slowFinished = false;
  try {
    await page.route('**/api/v1/**', async route => {
      const url = new URL(route.request().url()), pathname = url.pathname;
      let result = {};
      if (pathname === '/api/v1/projects') result = [project];
      else if (pathname.endsWith('/project') || pathname.endsWith('/project/changes')) result = data;
      else if (pathname.endsWith('/tasks')) result = { items: [], has_more: false };
      else if (pathname.endsWith('/screenplays')) result = [];
      else if (pathname.endsWith('/scripts/load')) result = null;
      else if (pathname.endsWith('/skills/list')) result = { items: [], directory: '/fixture' };
      else if (pathname.endsWith('/media/thumbnail')) result = { path: '/fixture-thumb.svg' };
      else if (pathname.endsWith('/media/upload')) {
        if (failUpload) return route.fulfill({ status: 500, json: { error: '测试上传失败' } });
        result = { id: 30, name: '新上传的视频.mp4', kind: 'video', path: '/fixture/30.mp4', created_at: '2026-11-07' };
        videos.unshift(result);
      }
      else if (pathname.endsWith('/media') && route.request().method() === 'GET') {
        const query = url.searchParams.get('query') || '', current = Number(url.searchParams.get('page')), limit = Number(url.searchParams.get('limit'));
        requests.push({ query, page: current, limit, kind: url.searchParams.get('kind') });
        if (query === '慢搜索') { await new Promise(resolve => setTimeout(resolve, 900)); slowFinished = true; }
        if (failList) return route.fulfill({ status: 500, json: { error: '测试网络错误' } });
        const filtered = query ? videos.filter(video => video.name.includes(query)) : videos;
        result = { items: filtered.slice((current - 1) * limit, current * limit), total: filtered.length };
      } else if (pathname.endsWith('/clips/select-video')) {
        const payload = route.request().postDataJSON();
        attachments.push(payload);
        if (holdAttach) await new Promise(resolve => { finishAttach = resolve; });
        if (failAttach) return route.fulfill({ status: 400, json: { error: '测试关联失败' } });
        scene.video_media_id = payload.media_id;
        if (!scene.videos.some(video => video.id === payload.media_id)) scene.videos.push(videos.find(video => video.id === payload.media_id));
      }
      await route.fulfill({ json: { data: result } });
    });
    await page.route('**/media?*', route => {
      if (new URL(route.request().url()).pathname !== '/media') return route.fallback();
      if (new URL(route.request().url()).searchParams.get('path') === '/fixture-thumb.svg') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#59605a"/><path d="M0 140 120 40 240 140 320 100V180H0Z" fill="#8b9584"/><circle cx="250" cy="42" r="20" fill="#dcbb87"/></svg>' });
      return route.fulfill({ contentType: 'video/mp4', body: bytes });
    });
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
    await page.getByRole('menuitem', { name: '剧集', exact: true }).click();
    await page.locator('.episode-card').getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByRole('tab', { name: '场景', exact: true }).click();
    await page.getByRole('button', { name: '查看场景「教室重逢」', exact: true }).click();
    await page.getByRole('button', { name: '编辑片段：教室重逢', exact: true }).click();
    const open = () => page.getByRole('button', { name: '选择已有视频', exact: true }).click();
    const modal = page.locator('.scene-video-picker:visible');
    const cards = modal.locator('.scene-video-picker-card');
    const confirm = () => modal.getByRole('button', { name: '使用并设为主视频', exact: true });
    const search = () => modal.getByRole('textbox', { name: '搜索全部视频素材' });
    await open();
    await cards.nth(11).waitFor();
    assert.equal(await cards.count(), 12);
    assert.equal(await confirm().isDisabled(), true);
    await cards.first().click();
    assert.equal(await modal.getByRole('button', { name: '已是主视频' }).isDisabled(), true);
    assert.match(await cards.nth(1).textContent(), /已在此片段/);
    await cards.nth(2).click();
    await page.waitForFunction(() => document.querySelector('.scene-video-picker-player video')?.readyState >= 1);
    assert.match(await modal.locator('.scene-video-picker-preview').textContent(), /320 × 180 · 0:02/);
    assert.equal(attachments.length, 0, 'Preview and selection do not save anything');
    await modal.locator('.arco-pagination-item-next').click();
    await cards.first().filter({ hasText: '镜头 17' }).waitFor();
    assert.match(await modal.locator('.scene-video-picker-selection').textContent(), /镜头 27/);
    await search().fill('远页特写');
    await cards.first().filter({ hasText: '远页特写' }).waitFor();
    assert.equal(await cards.count(), 1);
    assert.deepEqual(requests.at(-1), { query: '远页特写', page: 1, limit: 12, kind: 'video' });
    assert.match(await modal.locator('.scene-video-picker-selection').textContent(), /镜头 27/);
    // A response from an older search must never replace the latest results.
    const slowRequest = page.waitForRequest(request => new URL(request.url()).searchParams.get('query') === '慢搜索');
    await search().fill('慢搜索');
    await slowRequest;
    await search().fill('远页特写');
    await cards.first().filter({ hasText: '远页特写' }).waitFor();
    while (!slowFinished) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(await cards.count(), 1);
    await search().fill('不存在的关键词');
    await modal.getByText('没有找到匹配的视频', { exact: true }).waitFor();
    await modal.getByRole('button', { name: '清除搜索', exact: true }).click();
    await cards.nth(11).waitFor();
    failList = true;
    await search().fill('测试错误');
    await modal.getByRole('button', { name: '重新加载' }).waitFor();
    failList = false;
    await modal.getByRole('button', { name: '重新加载' }).click();
    await modal.getByText('没有找到匹配的视频', { exact: true }).waitFor();
    await modal.getByRole('button', { name: '清除搜索', exact: true }).click();
    await cards.nth(11).waitFor();
    failAttach = true;
    await confirm().click();
    await modal.getByRole('alert').filter({ hasText: '测试关联失败' }).waitFor();
    assert.match(await modal.locator('.scene-video-picker-selection').textContent(), /镜头 27/);
    failAttach = false; holdAttach = true;
    await confirm().dblclick();
    await page.waitForFunction(() => document.querySelector('.scene-video-picker-actions .arco-btn-primary')?.classList.contains('arco-btn-loading'));
    assert.equal(attachments.length, 2, 'A double click submits only one retry');
    assert.equal(await modal.getByRole('button', { name: '取消', exact: true }).isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await modal.count(), 1, 'Cannot close while saving');
    holdAttach = false; finishAttach();
    await modal.waitFor({ state: 'hidden' });
    assert.equal(scene.video_media_id, 27);
    assert(scene.videos.some(video => video.id === 29), 'Previous primary remains a candidate');
    await open(); await cards.nth(11).waitFor();
    assert.equal(await confirm().isDisabled(), true, 'Reopening resets temporary selection');
    const upload = async () => {
      const chooser = page.waitForEvent('filechooser');
      await modal.getByRole('button', { name: '本地上传', exact: true }).click();
      await (await chooser).setFiles(fixture);
    };
    failUpload = true;
    await upload();
    await modal.getByRole('alert').filter({ hasText: '测试上传失败' }).waitFor();
    failUpload = false;
    await upload();
    await cards.first().filter({ hasText: '新上传的视频.mp4' }).waitFor();
    assert.match(await modal.locator('.scene-video-picker-selection').textContent(), /新上传的视频/);
    assert.equal(scene.video_media_id, 27, 'Upload only selects the new video until explicit confirmation');
    assert.equal(attachments.length, 2);
    await cards.nth(4).click();
    await page.waitForFunction(() => document.querySelectorAll('.arco-message').length === 0);
    await modal.screenshot({ path: path.join(output, 'desktop-light.png') });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; document.body.setAttribute('arco-theme', 'dark'); });
    await modal.screenshot({ path: path.join(output, 'desktop-dark.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await cards.first().click();
    await page.waitForFunction(() => {
      const player = document.querySelector('.scene-video-picker-player')?.getBoundingClientRect();
      const footer = document.querySelector('.scene-video-picker-footer')?.getBoundingClientRect();
      return player && footer && player.top >= 0 && player.bottom <= footer.top;
    });
    await modal.screenshot({ path: path.join(output, 'mobile-dark.png') });
    const bounds = await modal.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 391, 'Modal fits mobile viewport');
    assert(await modal.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'No horizontal overflow');
    assert.equal(await confirm().isVisible(), true);
    const buttonBounds = await confirm().boundingBox();
    assert(buttonBounds.y >= 0 && buttonBounds.y + buttonBounds.height <= 844, 'Confirmation stays within the viewport');
    await modal.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(attachments.length, 2, 'Cancel does not change the primary');
    assert.deepEqual(errors, []);
    console.log(`PASS: full-library search, pagination, retained selection, preview metadata, stale-response protection, empty/error recovery, current-primary guard, submit retry/deduplication, busy lock, upload failure/retry and explicit confirmation, cancellation, responsive layout. Screenshots: ${output}`);
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
    console.error({ output, requests, errors, modal: await page.locator('.scene-video-picker').textContent().catch(() => '') });
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
