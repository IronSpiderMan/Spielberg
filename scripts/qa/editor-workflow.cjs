// Isolated HTTP fixtures and temporary media: never reads or modifies user projects.
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

(async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'spielberg-editor-workflow-'));
  const fixture = path.join(output, 'video.mp4');
  const audioFixture = path.join(output, 'audio.wav');
  const generate = args => {
    const result = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-v', 'error', ...args]);
    assert.equal(result.status, 0, result.stderr?.toString());
  };
  generate(['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '4', '-c:v', 'libx264', '-c:a', 'aac', fixture]);
  generate(['-f', 'lavfi', '-i', 'sine=frequency=660', '-t', '2', audioFixture]);
  const videoBytes = fs.readFileSync(fixture), audioBytes = fs.readFileSync(audioFixture);
  const browser = await chromium.launch({headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {})});
  const page = await browser.newPage({viewport: {width: 1500, height: 1050}});
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const project = {id: 'editor-workflow-qa', name: '剪辑操作回归', path: '/fixture', updated_at: '1'};
  const video = {id: 1, name: '日光镜头.mp4', path: '/fixture/video.mp4', kind: 'video', created_at: '1'};
  const secondVideo = {...video, id: 2, name: '夜景镜头.mp4', path: '/fixture/night.mp4'};
  const audio = {...video, id: 3, name: '背景配乐.wav', path: '/fixture/audio.wav', kind: 'audio'};
  const data = {project, media: [video, secondVideo, audio], assets: [], episodes: [], prompts: [], settings: {}};
  const saves = [], releases = [];
  let edits = [], exported, pauseSaves = false;
  const waitFor = async (predicate, description) => {
    const deadline = Date.now() + 10000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`Timed out: ${description}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };
  try {
    await page.route('**/api/v1/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      let result = {};
      if (pathname === '/api/v1/projects') result = [project];
      else if (pathname.endsWith('/project') || pathname.endsWith('/project/changes')) result = data;
      else if (pathname.endsWith('/editor/projects')) result = edits;
      else if (pathname.endsWith('/editor/save')) {
        const request = route.request().postDataJSON();
        saves.push(request);
        if (pauseSaves) await new Promise(resolve => releases.push(resolve));
        const old = edits.find(edit => edit.id === request.id);
        edits = [{...request, status: 'draft', outputs: old?.outputs || [], updated_at: '1'}, ...edits.filter(edit => edit.id !== request.id)];
        result = edits;
      } else if (pathname.endsWith('/editor/probe')) {
        const request = route.request().postDataJSON();
        result = {duration: request.media_id === audio.id ? 2 : 4, video: request.media_id !== audio.id, audio: true};
      } else if (pathname.endsWith('/editor/export')) {
        exported = route.request().postDataJSON();
        result = {...video, id: 9, name: '回归导出.mp4'};
      } else if (pathname.endsWith('/tasks')) result = {items: [], has_more: false};
      else if (pathname.endsWith('/skills/list')) result = {items: []};
      else if (pathname.endsWith('/media/thumbnail')) result = {path: '/spielberg-logo-s.png'};
      await route.fulfill({json: {data: result}});
    });
    await page.route('**/media?*', route => {
      const mediaPath = new URL(route.request().url()).searchParams.get('path');
      if (mediaPath === '/spielberg-logo-s.png') return route.fulfill({status: 302, headers: {Location: '/spielberg-logo-s.png'}});
      const isAudio = mediaPath?.endsWith('.wav'), bytes = isAudio ? audioBytes : videoBytes;
      const type = isAudio ? 'audio/wav' : 'video/mp4';
      const match = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
      if (match) {
        const start = Number(match[1]), end = match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
        return route.fulfill({status: 206, headers: {'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${bytes.length}`}, body: bytes.subarray(start, end + 1)});
      }
      return route.fulfill({contentType: type, body: bytes});
    });
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
    await page.getByRole('menuitem', {name: '音视频剪辑', exact: true}).click();
    await page.getByRole('button', {name: '创建剪辑项目', exact: true}).click();
    const workbench = page.locator('.me-workbench');
    await workbench.waitFor();
    const add = item => workbench.getByRole('button', {name: `添加到时间线 ${item.name}`, exact: true});
    const cursor = workbench.getByLabel('时间线播放头', {exact: true});
    const undo = () => workbench.getByRole('button', {name: '撤销', exact: true}).click();
    const redo = () => workbench.getByRole('button', {name: '重做', exact: true}).click();
    const dropClip = async (source, target, coordinates = {}) => {
      const transfer = await page.evaluateHandle(() => new DataTransfer());
      await source.dispatchEvent('dragstart', {dataTransfer: transfer});
      await target.dispatchEvent('dragover', {dataTransfer: transfer, ...coordinates});
      await target.dispatchEvent('drop', {dataTransfer: transfer, ...coordinates});
      await source.dispatchEvent('dragend', {dataTransfer: transfer});
      await transfer.dispose();
    };
    const mainClips = workbench.locator('.me-clip:not(.audio)');
    const audioClips = workbench.locator('.me-clip.audio');
    const search = workbench.getByLabel('搜索剪辑素材', {exact: true});
    await search.fill('夜景');
    assert.equal(await workbench.locator('.me-asset-row').count(), 1);
    await search.fill('');
    await workbench.getByRole('button', {name: `预览素材 ${video.name}`, exact: true}).click();
    await page.locator('.video-preview-modal:visible').waitFor();
    assert.equal(await mainClips.count(), 0, 'Previewing a source must not append it');
    await page.getByRole('button', {name: '关闭视频预览', exact: true}).click();
    await add(video).click();
    await page.waitForFunction(() => document.querySelector('.me-canvas video')?.readyState >= 2);
    const firstWidth = (await mainClips.first().boundingBox()).width;
    await add(secondVideo).click();
    await mainClips.nth(1).waitFor();
    assert.equal(await mainClips.count(), 2);
    assert.equal((await mainClips.first().boundingBox()).width, firstWidth, 'Adding a source preserves timeline scale');
    await cursor.fill('0.5');
    await add(audio).click();
    await audioClips.first().waitFor();
    assert.equal(await mainClips.count(), 2, 'A soundtrack must not extend the sequential video track');
    assert.equal(await audioClips.count(), 1);
    assert.equal(Number(await workbench.getByLabel('音轨位置', {exact: true}).inputValue()), 0.5, 'A soundtrack starts at the playhead');
    assert.equal(Number(await cursor.getAttribute('max')), 8, 'Soundtrack shorter than video must not extend total duration');

    // History restores the selected audio and playhead, including undoing removal.
    await workbench.focus(); await page.keyboard.press('Delete');
    assert.equal(await audioClips.count(), 0);
    await undo();
    assert.equal(await audioClips.count(), 1);
    assert.equal(await audioClips.locator('.me-clip-hit').getAttribute('aria-pressed'), 'true');
    assert.equal(Number(await cursor.inputValue()), 0.5);
    await undo();
    assert.equal(await audioClips.count(), 0);

    // Multiple pointer moves create one undo step for a trim gesture.
    await mainClips.first().locator('.me-clip-hit').click({position: {x: 35, y: 35}});
    const beforeCursor = Number(await cursor.inputValue());
    const handle = mainClips.first().locator('.me-trim-handle.is-start');
    const bounds = await handle.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 12, bounds.y + bounds.height / 2, {steps: 3});
    await page.mouse.move(bounds.x + 26, bounds.y + bounds.height / 2, {steps: 3});
    await page.mouse.up();
    const trimmedStart = Number(await workbench.getByLabel('入点', {exact: true}).inputValue());
    assert(trimmedStart > 0.3, 'Dragging the left edge changes the source in point');
    await undo();
    assert.equal(Number(await workbench.getByLabel('入点', {exact: true}).inputValue()), 0, 'One undo restores the entire trim gesture');
    assert.equal(Number(await cursor.inputValue()), beforeCursor);
    await redo();
    assert.equal(Number(await workbench.getByLabel('入点', {exact: true}).inputValue()), trimmedStart);
    await undo();

    // Editing numeric controls is grouped and keeps the selected material in view.
    const outPoint = workbench.getByLabel('出点', {exact: true});
    await cursor.fill('7.5');
    await outPoint.focus(); await outPoint.fill('3.2'); await outPoint.fill('3'); await outPoint.blur();
    assert.equal(await outPoint.inputValue(), '3');
    assert.equal(await mainClips.first().locator('.me-clip-hit').getAttribute('aria-pressed'), 'true');
    assert(Number(await cursor.inputValue()) < 3);
    await undo(); assert.equal(await outPoint.inputValue(), '4', 'One undo restores a full numeric edit');

    // A split and delete can be driven by shortcuts; text fields keep native input behavior.
    await cursor.fill('1.5');
    await workbench.focus(); await page.keyboard.press('s');
    assert.equal(await mainClips.count(), 3);
    await page.keyboard.press('Control+z');
    assert.equal(await mainClips.count(), 2);
    assert.equal(await mainClips.first().locator('.me-clip-hit').getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('Control+Shift+z');
    assert.equal(await mainClips.count(), 3);
    const name = workbench.getByLabel('作品名称', {exact: true});
    await name.fill('测试 s Delete'); await name.press('s');
    assert.equal(await mainClips.count(), 3, 'Typing s in the name must not split');
    await workbench.focus(); await page.keyboard.press('Delete');
    assert.equal(await mainClips.count(), 2);
    await undo(); assert.equal(await mainClips.count(), 3);
    await undo(); assert.equal(await mainClips.count(), 2);
    await cursor.fill('0.2');
    await workbench.focus(); await page.keyboard.press('Space');
    await page.waitForFunction(() => {const video = document.querySelector('.me-canvas video'); return video && !video.paused && video.currentTime > 0.4;});
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('.me-canvas video').paused);

    // Actual timeline hit testing, including empty lane space and the ruler.
    const lane = workbench.locator('.me-track-lane').first();
    const laneBox = await lane.boundingBox();
    await lane.click({position: {x: Math.min(laneBox.width - 10, 380), y: 83}});
    assert(Number(await cursor.inputValue()) > 4, 'Clicking lane space seeks instead of selecting a different clip');
    await workbench.locator('.me-time-ruler').click({position: {x: 40, y: 10}});
    assert(Math.abs(Number(await cursor.inputValue()) - 1) < 0.1, 'Ruler coordinates correspond to timeline seconds');
    await dropClip(mainClips.nth(1).locator('.me-clip-hit'), mainClips.first().locator('.me-clip-hit'));
    assert.match(await mainClips.first().innerText(), /夜景镜头/);
    await undo();
    assert.match(await mainClips.first().innerText(), /日光镜头/, 'Undo restores the order before a drag');

    const beforeShortcutSave = saves.length;
    await name.fill('快捷保存'); await name.press('Control+s');
    await waitFor(() => saves.length > beforeShortcutSave && saves.at(-1).name === '快捷保存', 'save shortcut inside the name input');
    assert.equal(await mainClips.count(), 2, 'Save shortcut inside an input must not split the selection');

    // An older queued response cannot claim that newer changes are already saved.
    await page.waitForFunction(() => {const node = document.querySelector('.me-save-state'); return node && node.textContent.includes('已保存') && !node.classList.contains('is-saving') && !node.classList.contains('is-dirty');});
    pauseSaves = true;
    await name.fill('排队保存 A'); await name.blur();
    await waitFor(() => releases.length === 1, 'first queued save');
    await name.fill('排队保存 B'); await name.blur();
    await page.waitForTimeout(750);
    releases.shift()();
    await waitFor(() => releases.length === 1, 'latest queued save');
    assert(await workbench.locator('.me-save-state').evaluate(node => !node.textContent.includes('已保存')), 'An older response must not report the latest draft saved');
    pauseSaves = false; releases.shift()();
    await page.waitForFunction(() => {const node = document.querySelector('.me-save-state'); return node && node.textContent.includes('已保存') && !node.classList.contains('is-saving') && !node.classList.contains('is-dirty');});
    assert.equal(edits[0].name, '排队保存 B');

    await cursor.fill('0.5'); await add(audio).click(); await audioClips.first().waitFor();
    const mainLane = await lane.boundingBox();
    await dropClip(audioClips.first().locator('.me-clip-hit'), mainClips.first().locator('.me-clip-hit'), {clientX: mainLane.x + 80, clientY: mainLane.y + 20});
    assert.equal(Number(await workbench.getByLabel('音轨位置', {exact: true}).inputValue()), 2, 'Dropping audio on an existing video reaches the lane position handler');
    await undo();
    assert.equal(Number(await workbench.getByLabel('音轨位置', {exact: true}).inputValue()), 0.5, 'Undo restores the audio position before drag');
    await workbench.getByLabel('音量', {exact: true}).fill('0.5');
    await workbench.getByRole('button', {name: '导出作品', exact: true}).click();
    await workbench.getByRole('button', {name: '下载文件', exact: true}).waitFor();
    assert.equal(exported.clips.length, 2); assert.equal(exported.audio_clips.length, 1);
    assert.equal(exported.audio_clips[0].at, 0.5); assert.equal(exported.audio_clips[0].volume, 0.5);
    await page.waitForFunction(() => !document.querySelector('.me-asset-add')?.disabled && document.querySelector('.me-save-state')?.textContent === '已保存');
    await page.screenshot({path: path.join(output, 'desktop.png'), fullPage: true, animations: 'disabled'});
    await page.evaluate(() => {document.documentElement.setAttribute('data-theme', 'dark'); document.documentElement.setAttribute('arco-theme', 'dark');});
    await page.waitForTimeout(250);
    await page.screenshot({path: path.join(output, 'dark.png'), fullPage: true, animations: 'disabled'});
    await page.setViewportSize({width: 390, height: 844});
    await page.waitForTimeout(250);
    assert(await workbench.evaluate(node => node.scrollWidth <= node.clientWidth), 'Editor workbench must fit narrow screens');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Narrow editor must not create page-wide horizontal overflow');
    await page.screenshot({path: path.join(output, 'mobile.png'), fullPage: true, animations: 'disabled'});
    assert.deepEqual(errors, []);
    console.log(`PASS: source preview/search, video/audio placement, grouped pointer/numeric trims, selection/playhead history, keyboard shortcuts, timeline seeking, queued saves, export, themes and responsive layout. Screenshots: ${output}`);
  } catch (error) {
    await page.screenshot({path: path.join(output, 'failure.png'), fullPage: true}).catch(() => {});
    console.error(`Failure screenshot: ${path.join(output, 'failure.png')}`);
    throw error;
  } finally {
    pauseSaves = false;
    releases.splice(0).forEach(resolve => resolve());
    await browser.close();
  }
})().catch(error => {console.error(error); process.exit(1);});
