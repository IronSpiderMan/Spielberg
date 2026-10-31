// Isolated fixtures: no real projects, source files or generation services are changed.
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({headless: true});
  const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'spielberg-asset-references-'));
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const image = {id: 1, name: '空间全景.png', path: '/spielberg-logo-s.png', kind: 'image', created_at: '0'};
      const second = {...image, id: 2, name: '布局细节.png'};
      const audio = {...image, id: 3, name: '历史音频.wav', path: '/fixture.wav', kind: 'audio'};
      const project = {id: 'qa', name: '参考资料测试', path: '/fixture', updated_at: '刚刚'};
      const data = JSON.parse(localStorage.getItem('qa-asset-references') || 'null') || {
        project, media: [image, second, audio], assets: [
          {id: 1, name: '未来家', category: 'location', design_media_id: 1, images: [image, second]},
          ...['person', 'creature', 'object', 'vehicle', 'other'].map((category, i) => ({id: i + 2, category, name: category, images: [image]})),
          {id: 7, name: '旧版人物', images: []},
        ].map(asset => ({description: '参考资料', enabled: true, audios: [audio], ...asset})),
        episodes: [], prompts: [], settings: {},
      };
      window.__qaData = data;
      window.__qaFailUnlink = false;
      window.__TAURI_INTERNALS__ = {invoke: async (command, args) => {
        const {path, payload} = args;
        if (path === '/projects') return [project];
        if (path === '/project' || path === '/project/changes') return structuredClone(data);
        if (path === '/tasks') return {items: [], has_more: false};
        if (path === '/assets/media/delete') {
          if (window.__qaFailUnlink) throw Error('测试取消关联失败');
          const asset = data.assets.find(a => a.id === payload.asset_id);
          asset.images = asset.images.filter(m => m.id !== payload.media_id);
          if (asset.design_media_id === payload.media_id) asset.design_media_id = null;
        }
        if (path === '/assets/update') Object.assign(data.assets.find(a => a.id === payload.id), payload);
        localStorage.setItem('qa-asset-references', JSON.stringify(data));
        return {ok: true};
      }};
    });
    await require('./http-fixture.cjs')(page);
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
    await page.getByRole('menuitem', {name: '资产库', exact: true}).click();
    const drawer = page.locator('.arco-drawer:visible');
    const audioSection = scope => scope.getByRole('region', {name: '音频参考', exact: true});
    const openDetail = name => page.getByRole('button', {name: `查看${name}的资产详情`, exact: true}).click();
    const back = () => page.getByRole('button', {name: '资产列表', exact: true}).click();
    // Existing audio data on non-voice assets must not expose audio controls or counts.
    for (const name of ['未来家', 'person', 'creature', 'object', 'vehicle', 'other', '旧版人物']) {
      const supportsAudio = ['person', 'creature', '旧版人物'].includes(name);
      const card = page.locator('.role-card').filter({has: page.getByRole('heading', {name, exact: true})});
      assert.equal((await card.locator('.role-asset-count').textContent()).includes('音频参考'), supportsAudio);
      await openDetail(name);
      assert.equal(await audioSection(page.locator('.role-detail-page')).count(), supportsAudio ? 1 : 0);
      await page.getByRole('heading', {name: /^图片参考/}).waitFor();
      await page.getByRole('button', {name: '编辑设定', exact: true}).click();
      assert.equal(await audioSection(drawer).count(), supportsAudio ? 1 : 0);
      if (name === 'person') {
        await drawer.getByLabel('资产类别', {exact: true}).click();
        await page.getByRole('option', {name: '地点', exact: true}).click();
        assert.equal(await audioSection(drawer).count(), 0);
      }
      await drawer.locator('.arco-drawer-close-icon').click();
      await back();
    }
    await openDetail('未来家');
    const gallery = page.getByRole('region', {name: '资产图片', exact: true});
    assert.equal(await gallery.locator('figure').count(), 2);
    await gallery.getByRole('button', {name: '预览 空间全景.png', exact: true}).click();
    await page.locator('.image-preview-modal:visible').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.image-preview-modal:visible').waitFor({state: 'hidden'});
    await gallery.scrollIntoViewIfNeeded();
    await page.screenshot({path: path.join(screenshots, 'references-light.png'), fullPage: true});
    await page.getByRole('button', {name: '切换到暗夜模式', exact: true}).click();
    await page.screenshot({path: path.join(screenshots, 'references-dark.png'), fullPage: true});
    await page.setViewportSize({width: 390, height: 1000});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    const size = await gallery.getByRole('button', {name: '取消关联 空间全景.png', exact: true}).boundingBox();
    assert(size.height < 50, 'Unlink control must not inherit the image preview height');
    await page.screenshot({path: path.join(screenshots, 'references-mobile.png'), fullPage: true});
    await page.setViewportSize({width: 1440, height: 1000});
    const unlink = async name => {
      await gallery.getByRole('button', {name: `取消关联 ${name}`, exact: true}).click();
      await page.locator('.arco-popconfirm:visible').getByRole('button', {name: '取消关联', exact: true}).click();
    };
    await page.evaluate(() => {window.__qaFailUnlink = true;});
    await unlink('空间全景.png');
    await page.getByText('Error: 测试取消关联失败', {exact: true}).waitFor();
    assert.equal(await gallery.locator('figure').count(), 2);
    await page.evaluate(() => {window.__qaFailUnlink = false;});
    await unlink('空间全景.png');
    await gallery.locator('figure').filter({hasText: '空间全景.png'}).waitFor({state: 'hidden'});
    assert.deepEqual(await page.evaluate(() => ({
      main: window.__qaData.assets[0].design_media_id,
      files: window.__qaData.media.length,
      shared: window.__qaData.assets[1].images.length,
      legacyAudio: window.__qaData.assets[0].audios.length,
    })), {main: null, files: 3, shared: 1, legacyAudio: 1});
    await page.reload();
    await page.getByRole('menuitem', {name: '资产库', exact: true}).click();
    await openDetail('未来家');
    assert.equal(await gallery.locator('figure').count(), 1);
    await unlink('布局细节.png');
    await gallery.getByText('添加参考图片，记录资产的外观与细节', {exact: true}).waitFor();
    await page.locator('.role-detail-no-image').waitFor();
    assert.equal(await page.evaluate(() => window.__qaData.media.length), 3);
    assert.deepEqual(errors, []);
    console.log('PASS: category-specific audio in cards/detail/editor; draft category switching; image preview; unlink retry, main-image clearing, shared media preservation, persistence, last-image empty state; light/dark/mobile layout');
    console.log('Screenshots: ' + screenshots);
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
