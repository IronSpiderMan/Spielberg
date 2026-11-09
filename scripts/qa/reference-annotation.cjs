// Isolated pixel + interaction regression: all API and image requests use local fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const playwrightPath = process.env.PLAYWRIGHT_PATH || [
  'playwright',
  path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'),
].find(candidate => { try { require.resolve(candidate); return true; } catch { return false; } });
assert(playwrightPath, 'Set PLAYWRIGHT_PATH to the installed Playwright package');
const { chromium } = require(playwrightPath);
const fixtureImage = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="white"/></svg>';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'spielberg-annotation-'));
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(12000);
    const errors = [];
    const consoleErrors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.addInitScript(() => {
      localStorage.setItem('spielberg-theme', 'dark');
      const project = { id: 'qa-annotation', name: '参考图标注测试', path: '/fixture', updated_at: '刚刚' };
      const media = { id: 101, name: '角色参考.png', path: '/annotation-fixture.svg', kind: 'image', created_at: '2026-11-06' };
      const scene = { id: 1, scene_id: 1, title: '标注场景', sort_order: 0, description: '隔离标注测试', prompt: '', videos: [],
        first_media_id: null, last_media_id: null, reference_media_id: null,
        generation_options: { video_mode: 'i2v', reference_media_ids: [101] } };
      const data = { project, media: [media], assets: [], episodes: [{ id: 1, title: '测试剧集', description: '', clips: [scene], scenes: [{id:scene.id,title:scene.title,generation_mode:'clips',clips:[scene],reference_media_ids:[],reference_audio_media_ids:[]}], playback_units: [] }], prompts: [], settings: {} };
      window.__qaData = data;
      window.__qaUploads = [];
      window.__qaFailUpload = false;
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (!url.pathname.startsWith('/api/v1/')) return originalFetch(input, init);
        const reply = (value, status = 200) => new Response(JSON.stringify(status === 200 ? { data: value } : { error: value }), { status, headers: { 'Content-Type': 'application/json' } });
        if (url.pathname.endsWith('/media/upload')) {
          const file = init.body;
          const bitmap = await createImageBitmap(file);
          const output = document.createElement('canvas');
          output.width = bitmap.width; output.height = bitmap.height;
          output.getContext('2d').drawImage(bitmap, 0, 0);
          bitmap.close();
          window.__qaUploads.push({ name: file.name, type: file.type, width: output.width, height: output.height, dataUrl: output.toDataURL('image/png') });
          if (window.__qaFailUpload) return reply('测试上传失败', 500);
          const uploaded = { ...media, id: 200 + window.__qaUploads.length, name: file.name, path: '/annotation-upload.png' };
          data.media.push(uploaded);
          return reply(uploaded);
        }
        const payload = init.body ? JSON.parse(init.body) : {};
        if (url.pathname === '/api/v1/projects') return reply([project]);
        if (['/api/v1/actions/project', '/api/v1/actions/project/changes'].includes(url.pathname)) return reply(structuredClone(data));
        if (url.pathname.endsWith('/tasks')) return reply({ items: [], has_more: false });
        if (url.pathname.endsWith('/screenplays')) return reply([]);
        if (url.pathname.endsWith('/scripts/load')) return reply(null);
        if (url.pathname.endsWith('/clips/1')) Object.assign(scene, payload);
        if (url.pathname.endsWith('/media')) return reply({ items: data.media, total: data.media.length });
        return reply({ ok: true });
      };
    });
    await page.route('**/media?*', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: fixtureImage }));
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
    await page.getByRole('menuitem', { name: '剧集', exact: true }).click();
    await page.locator('.episode-card').getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByRole('tab', { name: '场景', exact: true }).click();
    await page.getByRole('button', { name: '查看场景「标注场景」', exact: true }).click();
    await page.getByRole('button', { name: '编辑片段：标注场景', exact: true }).click();
    await page.getByRole('button', { name: '标注参考图 角色参考.png', exact: true }).click();
    const modal = page.locator('.reference-annotation-modal');
    const canvas = modal.locator('canvas');
    await canvas.waitFor();
    const button = name => modal.getByRole('button', { name, exact: true });
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const imageData = () => canvas.evaluate(node => node.toDataURL('image/png'));
    const pixel = (x, y) => canvas.evaluate((node, point) => Array.from(node.getContext('2d').getImageData(point.x, point.y, 1, 1).data), { x, y });
    const coloredPixels = (x, y, width, height) => canvas.evaluate((node, area) => {
      const pixels = node.getContext('2d').getImageData(area.x, area.y, area.width, area.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 250 || pixels[i + 1] < 250 || pixels[i + 2] < 250) count++;
      return count;
    }, { x, y, width, height });
    const white = async (x, y, message) => assert.deepEqual(await pixel(x, y), [255, 255, 255, 255], message);
    const red = async (x, y, message) => {
      const [r, g, b, a] = await pixel(x, y);
      assert(r > 240 && g < 100 && b < 100 && a === 255, `${message}: ${[r, g, b, a]}`);
    };
    async function point(x, y) {
      const bounds = await canvas.boundingBox();
      return { x: bounds.x + x * bounds.width / 1200, y: bounds.y + y * bounds.height / 800 };
    }
    async function drag(from, to, shift = false) {
      const a = await point(...from); const b = await point(...to);
      if (shift) await page.keyboard.down('Shift');
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 8 });
      await page.mouse.up();
      if (shift) await page.keyboard.up('Shift');
      await settle();
    }
    async function placeText(x, y, content) {
      await button('文字').click();
      const p = await point(x, y);
      await page.mouse.click(p.x, p.y);
      const editor = modal.getByRole('textbox', { name: '标注文字', exact: true });
      await editor.fill(content);
      return editor;
    }
    const baseline = await imageData();
    assert(await button('用作参考图').isDisabled(), 'Unchanged image cannot be applied');
    assert(await button('撤销').isDisabled());
    assert(await button('重做').isDisabled());

    // Both outline and filled rectangles, including a reversed drag.
    await button('矩形').click();
    await button('空心').click();
    await drag([80, 100], [350, 280]);
    await red(80, 180, 'Rectangle outline is drawn');
    await white(200, 190, 'Outline rectangle preserves the image inside');
    await button('填充').click();
    await drag([650, 300], [450, 100]);
    await red(550, 200, 'Reversed filled rectangle fills its interior');
    await white(420, 200, 'Rectangle does not spill outside its bounds');

    // Ellipses use the same options, and keep their corners transparent.
    await button('圆形').click();
    await button('空心').click();
    await drag([800, 100], [1100, 300]);
    await red(950, 100, 'Ellipse outline is drawn');
    await white(950, 200, 'Outline ellipse preserves the image inside');
    await button('填充').click();
    await drag([350, 650], [80, 420]);
    await red(215, 535, 'Reversed filled ellipse fills its interior');
    await white(85, 425, 'Filled ellipse preserves its bounding-box corners');
    const shapes = await imageData();
    await page.screenshot({ path: path.join(screenshots, 'annotation-shapes-dark.png') });
    await button('撤销').click(); await settle();
    await white(215, 535, 'Undo removes exactly the last shape');
    await red(550, 200, 'Undo keeps earlier shapes');
    await button('重做').click(); await settle();
    assert.equal(await imageData(), shapes, 'Redo restores identical pixels');
    await button('清空标注').click(); await settle();
    assert.equal(await imageData(), baseline, 'Clear preserves the original image');
    await button('撤销').click(); await settle();
    assert.equal(await imageData(), shapes, 'Clear is a single undoable operation');
    await button('清空标注').click(); await settle();

    // Shift creates a true circle despite a non-square drag.
    await button('圆形').click();
    await button('填充').click();
    await drag([100, 100], [340, 250], true);
    const bounds = await canvas.evaluate(node => {
      const data = node.getContext('2d').getImageData(0, 0, node.width, node.height).data;
      let left = node.width, top = node.height, right = -1, bottom = -1;
      for (let y = 0; y < node.height; y++) for (let x = 0; x < node.width; x++) {
        const i = (y * node.width + x) * 4;
        if (data[i + 1] < 200) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
      }
      return { width: right - left + 1, height: bottom - top + 1 };
    });
    assert(Math.abs(bounds.width - bounds.height) <= 2, 'Shift constrains ellipse to a circle');
    assert(await button('重做').isDisabled(), 'A new annotation discards redo history');
    await button('清空标注').click(); await settle();

    // Pointer cancellation should not turn a partial drag into a committed annotation.
    await button('矩形').click();
    await canvas.evaluate(node => node.addEventListener('pointerdown', event => { window.__qaPointerId = event.pointerId; }, { once: true }));
    const start = await point(100, 100); const end = await point(500, 350);
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y);
    await canvas.dispatchEvent('pointercancel', { pointerId: await page.evaluate(() => window.__qaPointerId) });
    await page.mouse.up(); await settle();
    assert.equal(await imageData(), baseline, 'Cancelled pointer operation leaves no mark');
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y);
    await page.keyboard.press('Escape'); await page.mouse.up(); await settle();
    assert(await modal.isVisible(), 'Escape during a drag does not close the editor');
    assert.equal(await imageData(), baseline, 'Escape cancels the in-progress shape without committing it');
    await page.waitForTimeout(50);
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '标注参考图 角色参考.png', exact: true }).click();
    await canvas.waitFor(); await settle();
    await page.waitForTimeout(50);
    await page.keyboard.press('r');
    assert.equal(await button('矩形').getAttribute('aria-pressed'), 'true', 'Shortcuts work with the initial modal wrapper focus');

    // Style changes apply only to subsequent annotations, including alpha compositing.
    const setInput = async (label, value) => {
      await modal.getByLabel(label, { exact: true }).evaluate((node, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value);
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
    };
    await button('填充').click();
    await setInput('不透明度', '50');
    await drag([700, 100], [1000, 300]);
    const translucent = await pixel(850, 200);
    assert(translucent[0] === 255 && translucent[1] > 145 && translucent[1] < 170 && translucent[2] > 140 && translucent[2] < 165, 'Fill opacity blends with the original image');
    const styled = await imageData();
    await setInput('不透明度', '100');
    await setInput('标注颜色', '#00aaff');
    await modal.getByLabel('线宽', { exact: true }).selectOption('12');
    await settle();
    assert.equal(await imageData(), styled, 'Changing tool settings does not alter existing annotations');
    await drag([100, 100], [400, 300]);
    assert.deepEqual(await pixel(250, 200), [0, 170, 255, 255], 'Custom color applies to the next annotation');
    assert.deepEqual(await pixel(850, 200), translucent, 'Existing annotation retains its own color and opacity');
    await button('清空标注').click(); await settle();
    await setInput('标注颜色', '#ff3b30');
    await modal.getByLabel('线宽', { exact: true }).selectOption('4');

    // Text supports Chinese composition, line breaks, commit and cancellation.
    let textEditor = await placeText(100, 120, '中文标注');
    await textEditor.dispatchEvent('compositionstart');
    await textEditor.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true });
    assert(await textEditor.isVisible(), 'IME confirmation must not commit the text');
    await textEditor.dispatchEvent('compositionend');
    await textEditor.press('End');
    await textEditor.press('Shift+Enter');
    await textEditor.pressSequentially('second line');
    await textEditor.press('Enter'); await settle();
    assert.equal(await textEditor.count(), 0, 'Enter commits text');
    assert(await coloredPixels(90, 110, 600, 150) > 100, 'Text is rasterized onto the original image');
    const textImage = await imageData();
    textEditor = await placeText(600, 450, '取消这段文字');
    await textEditor.press('Escape'); await settle();
    assert(await modal.isVisible(), 'Escape while editing does not close the annotation modal');
    assert.equal(await imageData(), textImage, 'Escape discards text draft');
    // Arco schedules focus changes after a draft ends; test shortcuts after that timer.
    await page.waitForTimeout(50);
    await page.keyboard.press('Control+z'); await settle();
    assert.equal(await imageData(), baseline, 'Ctrl+Z undoes text as one operation');
    await page.keyboard.press('Control+Shift+z'); await settle();
    assert.equal(await imageData(), textImage, 'Ctrl+Shift+Z restores the text');
    await page.keyboard.press('b');
    assert.equal(await button('画笔').getAttribute('aria-pressed'), 'true', 'B selects the pen tool');
    await drag([100, 400], [500, 450]);
    assert(await coloredPixels(90, 390, 430, 80) > 100, 'Pen drawing remains available');
    await page.waitForTimeout(50);
    await page.keyboard.press('r');
    assert.equal(await button('矩形').getAttribute('aria-pressed'), 'true', 'Tool shortcuts work after delayed modal focus changes');

    // Clicking directly from one text draft to another must transfer keyboard focus.
    const beforeConsecutiveText = await imageData();
    await placeText(100, 560, '连续输入一');
    const secondTextPosition = await point(850, 620);
    await page.mouse.click(secondTextPosition.x, secondTextPosition.y);
    const secondTextEditor = modal.getByRole('textbox', { name: '标注文字', exact: true });
    assert(await secondTextEditor.evaluate(node => document.activeElement === node), 'A second text draft immediately receives keyboard focus');
    assert.equal(await secondTextEditor.inputValue(), '', 'Clicking outside the first editor starts a fresh text draft');
    await page.keyboard.insertText('连续输入二');
    assert.equal(await secondTextEditor.inputValue(), '连续输入二', 'Typing updates the second text draft');
    await page.keyboard.press('Enter'); await settle();
    assert(await coloredPixels(90, 550, 450, 70) > 100, 'First text draft is committed when clicking the second position');
    assert(await coloredPixels(840, 610, 350, 70) > 100, 'Direct keyboard input reaches the second text draft');
    await button('撤销').click(); await button('撤销').click(); await settle();
    assert.equal(await imageData(), beforeConsecutiveText, 'Consecutive text drafts are separate history operations');

    // Inspect wide and narrow layouts with both themes; canvas/footer stay reachable.
    for (const [width, height, theme] of [[1440, 1000, 'dark'], [768, 800, 'light'], [390, 844, 'dark']]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(theme => {
        document.documentElement.dataset.theme = theme;
        if (theme === 'dark') document.body.setAttribute('arco-theme', 'dark');
        else document.body.removeAttribute('arco-theme');
      }, theme);
      await settle();
      const layout = await modal.evaluate(node => {
        const modal = node.getBoundingClientRect();
        const canvas = node.querySelector('canvas').getBoundingClientRect();
        return { left: modal.left, right: modal.right, canvasLeft: canvas.left, canvasRight: canvas.right, scroll: node.scrollWidth, client: node.clientWidth };
      });
      assert(layout.left >= -1 && layout.right <= width + 1, `Modal fits ${width}px viewport`);
      assert(layout.scroll <= layout.client + 1, `Modal has no horizontal overflow at ${width}px`);
      assert(layout.canvasLeft >= layout.left - 1 && layout.canvasRight <= layout.right + 1, `Canvas fits at ${width}px`);
      await button('用作参考图').scrollIntoViewIfNeeded();
      assert(await button('用作参考图').isVisible());
      await page.screenshot({ path: path.join(screenshots, `annotation-${width}-${theme}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await settle();

    // Applying an active text draft exports original-resolution PNG. A failed upload keeps edits for retry.
    textEditor = await placeText(650, 500, '导出时保留');
    await page.evaluate(() => { window.__qaFailUpload = true; });
    await button('用作参考图').click();
    await page.waitForFunction(() => window.__qaUploads.length === 1);
    await page.getByText(/测试上传失败/).waitFor();
    assert(await modal.isVisible(), 'Upload failure keeps the editor open');
    assert(await button('用作参考图').isEnabled(), 'Upload failure allows retry');
    const exported = await page.evaluate(() => window.__qaUploads[0]);
    assert.equal(exported.width, 1200, 'Export retains the original width');
    assert.equal(exported.height, 800, 'Export retains the original height');
    assert.equal(exported.type, 'image/png');
    assert.equal(exported.name, '角色参考-标注.png');
    assert(await coloredPixels(640, 490, 450, 100) > 100, 'Active text is committed before export');
    assert.equal(exported.dataUrl, await imageData(), 'Export includes every visible annotation and active text');
    await page.evaluate(() => { window.__qaFailUpload = false; });
    await button('用作参考图').click();
    await modal.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__qaUploads.length), 2);
    assert.equal(await page.evaluate(() => window.__qaUploads[1].dataUrl), exported.dataUrl, 'Retry preserves identical annotation pixels');
    assert(await page.getByRole('button', { name: '标注参考图 角色参考-标注.png', exact: true }).isVisible(), 'Scene now uses the annotated reference');
    assert.equal(await page.evaluate(() => window.__qaData.media.some(item => item.id === 101)), true, 'Original media is retained');
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, [], 'Browser console has no unexpected errors');
    console.log(`PASS: outline/filled/reversed shapes, circle constraint, history, pointer cancellation, Chinese multiline text, keyboard, responsive themes, PNG export and retry. Screenshots: ${screenshots}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
