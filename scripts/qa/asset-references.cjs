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
      window.__qaFailRename = false;
      window.__qaFailPrimary = false;
      window.__TAURI_INTERNALS__ = {invoke: async (command, args) => {
        const {path, payload} = args;
        if (path === '/projects') return [project];
        if (path === '/project' || path === '/project/changes') return structuredClone(data);
        if (path === '/tasks') return {items: [], has_more: false};
        if (path === '/media/rename') {
          if (window.__qaFailRename) throw Error('测试重命名失败');
          data.media.find(m => m.id === payload.id).name = payload.name;
          for (const asset of data.assets) {
            for (const image of asset.images) if (image.id === payload.id) image.name = payload.name;
          }
        }
        if (path === '/assets/media/delete') {
          if (window.__qaFailUnlink) throw Error('测试删除失败');
          const asset = data.assets.find(a => a.id === payload.asset_id);
          asset.images = asset.images.filter(m => m.id !== payload.media_id);
          if (asset.design_media_id === payload.media_id) asset.design_media_id = null;
        }
        if (path === '/assets/update') {
          if (window.__qaFailPrimary && payload.design_media_id !== undefined) throw Error('测试主图设置失败');
          Object.assign(data.assets.find(a => a.id === payload.id), payload);
        }
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
    const checkActionRows = async () => {
      const rows = await page.locator('.role-detail-image-actions').evaluateAll(elements => elements.map(element => {
        const row = element.getBoundingClientRect();
        const buttons = [...element.querySelectorAll('button')].map(button => {
          const rect = button.getBoundingClientRect();
          return {top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, scroll: button.scrollWidth, client: button.clientWidth};
        });
        return {left: row.left, right: row.right, buttons};
      }));
      assert(rows.length > 0);
      for (const row of rows) {
        assert.equal(row.buttons.length, 2);
        const [rename, remove] = row.buttons;
        assert(Math.abs(rename.top - remove.top) < 1, 'Rename and delete must stay on the same row');
        assert(rename.right <= remove.left, 'Action buttons must not overlap');
        for (const button of row.buttons) {
          assert(button.left >= row.left - 1 && button.right <= row.right + 1, 'Actions must fit the card');
          assert(button.scroll <= button.client, 'Action labels must fit without clipping');
        }
      }
    };
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
    assert.equal(await gallery.getByRole('button', {name: '设为主图 空间全景.png', exact: true}).count(), 0);
    await page.evaluate(() => {window.__qaFailPrimary = true;});
    await gallery.getByRole('button', {name: '设为主图 布局细节.png', exact: true}).click();
    await page.getByText('Error: 测试主图设置失败', {exact: true}).waitFor();
    assert.equal(await page.evaluate(() => window.__qaData.assets[0].design_media_id), 1);
    await page.evaluate(() => {window.__qaFailPrimary = false;});
    await gallery.getByRole('button', {name: '设为主图 布局细节.png', exact: true}).click();
    await gallery.locator('figure').first().getByRole('button', {name: '预览 布局细节.png', exact: true}).waitFor();
    assert.equal(await gallery.locator('figure').first().locator('.role-detail-main-badge').count(), 1);
    assert.equal(await gallery.locator('figure').first().getByRole('button', {name: /^设为主图/}).count(), 0);
    await page.reload();
    await page.getByRole('menuitem', {name: '资产库', exact: true}).click();
    await openDetail('未来家');
    assert.equal(await page.evaluate(() => window.__qaData.assets[0].design_media_id), 2);
    await gallery.locator('figure').first().getByRole('button', {name: '预览 布局细节.png', exact: true}).waitFor();
    await gallery.getByRole('button', {name: '设为主图 空间全景.png', exact: true}).click();
    await gallery.locator('figure').first().getByRole('button', {name: '预览 空间全景.png', exact: true}).waitFor();
    assert.deepEqual(await page.evaluate(() => {
      const asset = window.__qaData.assets[0];
      return {description: asset.description, category: asset.category, enabled: asset.enabled, images: asset.images.length, audios: asset.audios.length};
    }), {description: '参考资料', category: 'location', enabled: true, images: 2, audios: 1});
    await gallery.getByRole('button', {name: '重命名 空间全景.png', exact: true}).click();
    const renameModal = page.locator('.arco-modal:visible').filter({has: page.getByText('重命名素材', {exact: true})});
    const nameInput = renameModal.getByRole('textbox', {name: '素材名称', exact: true});
    assert.equal(await nameInput.inputValue(), '空间全景.png');
    await nameInput.fill('   ');
    assert(await renameModal.getByRole('button', {name: '保存名称', exact: true}).isDisabled());
    await renameModal.getByRole('button', {name: '取消', exact: true}).click();
    await renameModal.waitFor({state: 'hidden'});
    assert.equal(await page.evaluate(() => window.__qaData.media[0].name), '空间全景.png');
    await gallery.getByRole('button', {name: '重命名 空间全景.png', exact: true}).click();
    await nameInput.fill(' 客厅全景.png ');
    await page.evaluate(() => {window.__qaFailRename = true;});
    await renameModal.getByRole('button', {name: '保存名称', exact: true}).click();
    await page.getByText('Error: 测试重命名失败', {exact: true}).waitFor();
    assert.equal(await nameInput.inputValue(), ' 客厅全景.png ');
    await page.evaluate(() => {window.__qaFailRename = false;});
    await nameInput.press('Enter');
    await renameModal.waitFor({state: 'hidden'});
    await gallery.getByRole('button', {name: '重命名 客厅全景.png', exact: true}).waitFor();
    assert.deepEqual(await page.evaluate(() => ({
      mediaName: window.__qaData.media[0].name,
      sharedName: window.__qaData.assets[1].images[0].name,
      main: window.__qaData.assets[0].design_media_id,
    })), {mediaName: '客厅全景.png', sharedName: '客厅全景.png', main: 1});
    await gallery.getByRole('button', {name: '预览 客厅全景.png', exact: true}).click();
    await page.locator('.image-preview-modal:visible').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.image-preview-modal:visible').waitFor({state: 'hidden'});
    // Cover the seven-column width in the report plus narrow cards on mobile.
    for (const width of [1975, 1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({width, height: 1000});
      await checkActionRows();
    }
    await page.setViewportSize({width: 1975, height: 1000});
    await gallery.scrollIntoViewIfNeeded();
    await page.getByText('Error: 测试重命名失败', {exact: true}).waitFor({state: 'hidden'});
    await page.getByText('素材名称已更新', {exact: true}).waitFor({state: 'hidden'});
    await page.screenshot({path: path.join(screenshots, 'references-light.png'), fullPage: true});
    await page.getByRole('button', {name: '切换到暗夜模式', exact: true}).click();
    await page.screenshot({path: path.join(screenshots, 'references-dark.png'), fullPage: true});
    await page.setViewportSize({width: 390, height: 1000});
    await gallery.locator('figure').first().scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    const size = await gallery.getByRole('button', {name: '删除 客厅全景.png', exact: true}).boundingBox();
    assert(size.height < 50, 'Delete control must not inherit the image preview height');
    await page.screenshot({path: path.join(screenshots, 'references-mobile.png'), fullPage: true});
    await page.setViewportSize({width: 1440, height: 1000});
    const unlink = async name => {
      await gallery.getByRole('button', {name: `删除 ${name}`, exact: true}).click();
      await page.locator('.arco-popconfirm:visible').getByRole('button', {name: '删除', exact: true}).click();
    };
    await page.evaluate(() => {window.__qaFailUnlink = true;});
    await unlink('客厅全景.png');
    await page.getByText('Error: 测试删除失败', {exact: true}).waitFor();
    assert.equal(await gallery.locator('figure').count(), 2);
    await page.evaluate(() => {window.__qaFailUnlink = false;});
    await unlink('客厅全景.png');
    await gallery.locator('figure').filter({hasText: '客厅全景.png'}).waitFor({state: 'hidden'});
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
    assert.equal(await page.evaluate(() => window.__qaData.media[0].name), '客厅全景.png');
    await gallery.getByRole('button', {name: '设为主图 布局细节.png', exact: true}).click();
    await gallery.locator('.role-detail-main-badge').waitFor();
    assert.equal(await page.evaluate(() => window.__qaData.assets[0].design_media_id), 2);
    await unlink('布局细节.png');
    await gallery.getByText('添加参考图片，记录资产的外观与细节', {exact: true}).waitFor();
    await page.locator('.role-detail-no-image').waitFor();
    assert.equal(await page.evaluate(() => window.__qaData.media.length), 3);
    assert.deepEqual(errors, []);
    console.log('PASS: primary-image switching, failure retry, badge/order updates, persistence and setting after deletion; category-specific audio in cards/detail/editor; draft category switching; rename validation, cancellation, retry, shared names and persistence; image preview; unlink retry, main-image clearing, shared media preservation, last-image empty state; single-row actions across six viewport widths; light/dark/mobile layout');
    console.log('Screenshots: ' + screenshots);
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
