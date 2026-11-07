// Isolated fixtures: no real projects, source files or generation services are changed.
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({headless: true});
  const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'spielberg-asset-editor-layout-'));
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      localStorage.setItem('spielberg-theme', 'dark');
      const dimensions = [[600, 1000], [1500, 600], [700, 1000], [1400, 650], [1200, 700], [650, 1000], [900, 900]];
      const names = ['未来—高中版—五成相似原创角色全身正面参考图.png', '未来—高中版—横向三图角色卡—面部与服装完整参考.png', '未来—穿越前27岁—全身定位照.png', '未来—大学版—横向三图角色卡—原图43.png', '未来—高中版—横向三图角色卡—原图42.png', '未来—大学版—五成相似原创角色全身参考.png', '尚未关联的造型参考.png'];
      const media = dimensions.map(([width, height], i) => {
        const drawing = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${i % 2 ? '#bfc9ce' : '#d1c7be'}"/><circle cx="${width / 2}" cy="${height * .22}" r="${Math.min(width, height) * .12}" fill="#b79680"/><path d="M${width * .3} ${height * .44}Q${width / 2} ${height * .3} ${width * .7} ${height * .44}L${width * .64} ${height * .77}H${width * .36}Z" fill="#3b4659"/><path d="M${width * .36} ${height * .77}L${width * .34} ${height * .94}M${width * .64} ${height * .77}L${width * .66} ${height * .94}" stroke="#333b4b" stroke-width="${width * .12}"/><text x="20" y="35" fill="#31404c" font-family="sans-serif" font-size="24">REFERENCE ${i + 1} · ${width} × ${height}</text></svg>`;
        return {id: i + 1, name: names[i], kind: 'image', path: `/fixture/image-${i + 1}.svg`, preview_url: `data:image/svg+xml,${encodeURIComponent(drawing)}`, created_at: '0'};
      });
      const audio = {id: 8, name: '魏来音色—平静叙述与低声耳语参考.wav', kind: 'audio', path: '/fixture/voice.wav', created_at: '0'};
      media.push(audio);
      const project = {id: 'qa-asset-editor-layout', name: '素材界面隔离回归', path: '/fixture', updated_at: '刚刚'};
      const asset = {id: 1, name: '未来', category: 'person', description: ('身份：故事中的高中生。\n外形：校服外套、深色长裤，服装与五官保持一致。\n性格与表演：思考时摩挲笔帽，关键时刻语速变慢。\n').repeat(8), enabled: true, design_media_id: 1, images: media.slice(0, 6), audios: [audio]};
      const data = {project, assets: [asset], media, episodes: [], prompts: [], settings: {}};
      window.__qaData = data;
      window.__qaCalls = [];
      window.__TAURI_INTERNALS__ = {invoke: async (command, args) => {
        if (command !== 'api_request') return null;
        const {path, payload} = args;
        window.__qaCalls.push({path, payload});
        if (path === '/projects') return [project];
        if (path === '/project' || path === '/project/changes') return structuredClone(data);
        if (path === '/tasks') return {items: [], has_more: false};
        if (path === '/media/list') return {items: data.media.map(m => ({...m, usage_count: 0})), total: data.media.length};
        if (path === '/assets/update') Object.assign(asset, payload);
        if (path === '/media/rename') {
          data.media.find(m => m.id === payload.id).name = payload.name;
          asset.images.filter(m => m.id === payload.id).forEach(m => {m.name = payload.name;});
        }
        if (path === '/assets/media/add') {
          const media = data.media.find(m => m.id === payload.media_id);
          if (payload.name) media.name = payload.name;
          if (!asset.images.some(m => m.id === media.id)) asset.images.push(media);
        }
        if (path === '/assets/media/delete') {
          asset.images = asset.images.filter(m => m.id !== payload.media_id);
          if (asset.design_media_id === payload.media_id) asset.design_media_id = null;
        }
        return {ok: true};
      }};
    });
    await require('./http-fixture.cjs')(page);
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
    await page.getByRole('menuitem', {name: '资产库', exact: true}).click();
    await page.getByRole('button', {name: '查看未来的资产详情', exact: true}).click();
    const gallery = page.getByRole('region', {name: '资产图片', exact: true});
    const drawer = page.locator('.role-editor-drawer:visible');
    const picker = page.locator('.asset-picker-modal:visible');
    const editorCard = name => drawer.locator('.role-editor-image-card').filter({has: page.getByRole('button', {name: `编辑图片名称 ${name}`, exact: true})});
    const mediaNames = await page.evaluate(() => window.__qaData.assets[0].images.map(m => m.name));
    const checkViewport = async (scope, label) => {
      await page.waitForFunction(element => {
        const bounds = element.getBoundingClientRect();
        return bounds.left >= -1 && bounds.right <= innerWidth + 1;
      }, await scope.elementHandle(), {timeout: 4000});
      const bounds = await scope.boundingBox();
      const width = page.viewportSize().width;
      assert(bounds && bounds.x >= -1 && bounds.x + bounds.width <= width + 1, `${label} should fit ${width}px viewport: ${JSON.stringify(bounds)}`);
      assert(await scope.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${label} should not scroll horizontally at ${width}px`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Page should not overflow horizontally');
    };
    assert.equal(await gallery.locator('figure').count(), 6);
    for (const width of [1975, 1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({width, height: 1000});
      await checkViewport(gallery, 'Gallery');
      const cards = await gallery.locator('figure').evaluateAll(elements => elements.map(element => {
        const bounds = element.getBoundingClientRect();
        const image = element.querySelector('img');
        const caption = element.querySelector('figcaption');
        return {left: bounds.left, right: bounds.right, width: bounds.width, fit: getComputedStyle(image).objectFit, title: caption?.title, buttons: [...element.querySelectorAll('button')].map(button => {const rect = button.getBoundingClientRect(); return {left: rect.left, right: rect.right, width: rect.width, height: rect.height};})};
      }));
      cards.forEach(card => {
        assert.equal(card.fit, 'contain', 'Reference images must preserve the full source image');
        assert(card.title, 'Long captions should expose the full source name');
        card.buttons.forEach(button => {
          assert(button.width > 0 && button.height > 0, 'Card actions should remain visible');
          assert(button.left >= card.left - 1 && button.right <= card.right + 1, `Card actions must fit ${width}px: ${JSON.stringify({card, button})}`);
        });
      });
    }
    await page.setViewportSize({width: 1440, height: 1000});
    await gallery.scrollIntoViewIfNeeded();
    await page.screenshot({path: path.join(screenshots, 'gallery-desktop-dark.png'), animations: 'disabled'});
    await page.getByRole('button', {name: '切换到浅色模式', exact: true}).click();
    await page.screenshot({path: path.join(screenshots, 'gallery-desktop-light.png'), animations: 'disabled'});
    await page.getByRole('button', {name: '切换到暗夜模式', exact: true}).click();
    await page.setViewportSize({width: 390, height: 844});
    await gallery.locator('figure').first().scrollIntoViewIfNeeded();
    await page.screenshot({path: path.join(screenshots, 'gallery-mobile-dark.png'), animations: 'disabled'});
    await page.setViewportSize({width: 1440, height: 1000});
    const waitDrawerReady = () => page.waitForFunction(() => {
      const bounds = document.querySelector('.role-editor-drawer')?.getBoundingClientRect();
      return bounds && bounds.left >= 0 && bounds.right <= innerWidth + 1;
    });
    const openEditor = async () => {
      await page.getByRole('button', {name: '编辑设定', exact: true}).click();
      await waitDrawerReady();
    };
    await gallery.getByRole('button', {name: '管理参考素材', exact: true}).click();
    await drawer.waitFor();
    await waitDrawerReady();
    assert.equal(await drawer.locator('.arco-drawer-content').evaluate(element => getComputedStyle(element).padding), '0px', 'Drawer content should not add a second padding around the editor form');
    const checkSectionPosition = async name => {
      await page.waitForFunction(name => {
        const drawer = document.querySelector('.role-editor-drawer');
        const nav = drawer?.querySelector('.role-editor-nav')?.getBoundingClientRect();
        const heading = [...(drawer?.querySelectorAll('h2') || [])].find(element => element.textContent === name)?.getBoundingClientRect();
        return nav && heading && nav.left >= 0 && nav.right <= innerWidth + 1 && heading.top >= nav.bottom - 1 && heading.top < 600;
      }, name);
      const nav = await drawer.getByRole('navigation', {name: '资产设定章节', exact: true}).boundingBox();
      const heading = await drawer.getByRole('heading', {name, exact: true}).boundingBox();
      assert(heading && heading.y >= nav.y + nav.height - 1 && heading.y < 600, `${name} should appear below the sticky chapter navigation: ${JSON.stringify({nav, heading})}`);
    };
    await checkSectionPosition('参考素材');
    await drawer.getByRole('navigation', {name: '资产设定章节', exact: true}).getByRole('button', {name: '基本信息', exact: true}).click();
    await checkSectionPosition('基本信息');
    await drawer.getByRole('navigation', {name: '资产设定章节', exact: true}).getByRole('button', {name: /^参考素材/}).click();
    await checkSectionPosition('参考素材');
    await drawer.locator('.arco-drawer-close-icon').click();
    await drawer.waitFor({state: 'hidden'});
    await openEditor();
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({width, height: 1000});
      await drawer.getByRole('navigation', {name: '资产设定章节', exact: true}).getByRole('button', {name: /^参考素材/}).click();
      await checkSectionPosition('参考素材');
      await checkViewport(drawer, 'Editor drawer');
      await checkViewport(drawer.locator('.arco-drawer-content'), 'Editor scroll area');
      await checkViewport(drawer.getByRole('region', {name: '音频参考', exact: true}), 'Editor audio references');
      assert.equal(await drawer.locator('button button, button [role="button"], [role="button"] button').count(), 0, 'Editor controls should not nest interactive elements');
      if (width === 390) await page.screenshot({path: path.join(screenshots, 'editor-mobile-dark.png'), animations: 'disabled'});
    }
    await page.setViewportSize({width: 1440, height: 1000});
    await drawer.getByRole('navigation', {name: '资产设定章节', exact: true}).getByRole('button', {name: /^参考素材/}).click();
    await checkSectionPosition('参考素材');
    await page.screenshot({path: path.join(screenshots, 'editor-desktop-dark.png'), animations: 'disabled'});
    await drawer.getByRole('button', {name: `设为主图 ${mediaNames[1]}`, exact: true}).click();
    assert(await editorCard(mediaNames[1]).evaluate(element => element.classList.contains('selected')));
    assert.equal(await page.evaluate(() => window.__qaData.assets[0].design_media_id), 1, 'Choosing a main image is a draft until save');
    await drawer.locator('.arco-drawer-close-icon').click();
    await drawer.waitFor({state: 'hidden'});
    await openEditor();
    assert(await editorCard(mediaNames[0]).evaluate(element => element.classList.contains('selected')), 'Closing restores the saved main image');
    await drawer.getByRole('button', {name: `设为主图 ${mediaNames[1]}`, exact: true}).click();
    await drawer.getByRole('button', {name: '保存资产', exact: true}).click();
    await drawer.waitFor({state: 'hidden'});
    assert.equal(await page.evaluate(() => window.__qaData.assets[0].design_media_id), 2);
    await openEditor();
    await drawer.getByRole('button', {name: `放大预览 ${mediaNames[0]}`, exact: true}).click();
    const preview = page.locator('.image-preview-modal:visible');
    await preview.waitFor();
    await page.keyboard.press('Escape');
    await preview.waitFor({state: 'hidden'});
    assert(await drawer.isVisible(), 'Escape closes the preview and preserves the parent editor');
    await drawer.getByRole('button', {name: `编辑图片名称 ${mediaNames[2]}`, exact: true}).click();
    const rename = page.locator('.arco-modal:visible').filter({hasText: '编辑资产图片名称'});
    await rename.getByRole('textbox').fill('穿越前—侧面改名参考');
    await rename.getByRole('button', {name: '保存名称', exact: true}).click();
    await rename.waitFor({state: 'hidden'});
    await editorCard('穿越前—侧面改名参考').waitFor();
    await drawer.getByRole('button', {name: `删除 ${mediaNames[5]}`, exact: true}).click();
    await page.locator('.arco-popconfirm:visible').getByRole('button', {name: '移除图片', exact: true}).click();
    await editorCard(mediaNames[5]).waitFor({state: 'hidden'});
    assert.equal(await page.evaluate(() => window.__qaData.media.length), 8, 'Removing a reference preserves the source file');
    await drawer.getByRole('button', {name: '从素材库选择', exact: true}).click();
    await picker.waitFor();
    await page.getByText('资产图片名称已更新，可用 @资产.图片名 引用', {exact: true}).waitFor({state: 'hidden'});
    await page.getByText('已从资产中删除图片，素材文件已保留', {exact: true}).waitFor({state: 'hidden'});
    assert.equal(await picker.locator('.media-option-select').count(), 7, 'Image picker excludes audio');
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({width, height: 1000});
      await checkViewport(picker, 'Image picker');
      if (width === 390) await page.screenshot({path: path.join(screenshots, 'picker-mobile-dark.png'), animations: 'disabled'});
    }
    await page.setViewportSize({width: 1440, height: 1000});
    await picker.getByLabel('搜索图片素材名称', {exact: true}).fill('不存在的素材');
    await picker.getByText('没有匹配的图片素材', {exact: true}).waitFor();
    await picker.getByLabel('搜索图片素材名称', {exact: true}).fill('');
    await picker.getByRole('button', {name: '放大预览 尚未关联的造型参考.png', exact: true}).click();
    await preview.waitFor();
    await page.keyboard.press('Escape');
    await preview.waitFor({state: 'hidden'});
    assert(await picker.isVisible(), 'Escape closes the enlarged image and preserves the picker');
    assert(await drawer.isVisible(), 'Escape preserves the parent editor under the picker');
    await page.screenshot({path: path.join(screenshots, 'picker-desktop-dark.png'), animations: 'disabled'});
    await picker.getByRole('button', {name: '选择素材 尚未关联的造型参考.png', exact: true}).click();
    await picker.waitFor({state: 'hidden'});
    const naming = page.locator('.arco-modal:visible').filter({hasText: '设置资产图片名称'});
    await naming.waitFor();
    assert.equal(await page.locator('.image-preview-modal:visible').count(), 0, 'Single-click selection should not open a preview');
    assert(await naming.getByRole('button', {name: '确认添加', exact: true}).isDisabled());
    await naming.getByLabel('资产图片名称', {exact: true}).fill('新的造型参考');
    await naming.getByRole('button', {name: '确认添加', exact: true}).click();
    await naming.waitFor({state: 'hidden'});
    await editorCard('新的造型参考').waitFor();
    assert.equal(await drawer.locator('.role-editor-image-card').count(), 6);
    await drawer.getByRole('button', {name: '从素材库选择', exact: true}).click();
    await picker.getByRole('button', {name: `选择素材 ${mediaNames[0]}`, exact: true}).click();
    await picker.waitFor({state: 'hidden'});
    assert.equal(await naming.count(), 0, 'Selecting an existing reference must not rename it');
    assert(await editorCard(mediaNames[0]).evaluate(element => element.classList.contains('selected')));
    await drawer.getByRole('button', {name: '保存资产', exact: true}).click();
    await drawer.waitFor({state: 'hidden'});
    assert.equal(await page.evaluate(() => window.__qaData.assets[0].design_media_id), 1);
    assert.equal(await gallery.locator('figure').count(), 6);
    assert.deepEqual(errors, []);
    console.log('PASS: mixed-ratio gallery, full-image previews, action boundaries, long captions, editor layout, main-image save/cancel, nested Escape, rename/removal, direct selection, existing-reference selection, light/dark and 320–1975px responsive layout');
    console.log('Screenshots: ' + screenshots);
  } catch (error) {
    await page.screenshot({path: path.join(screenshots, 'failure.png'), fullPage: true}).catch(() => {});
    console.error('Screenshots: ' + screenshots);
    throw error;
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
