// Mock only the native reveal operation; exercise real UI and HTTP adapters.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const platform of ['MacIntel', 'Win32', 'remote']) {
      const page = await browser.newPage({ viewport: { width: 1420, height: 920 }, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(platform => {
        Object.defineProperty(navigator, 'platform', { value: platform === 'remote' ? 'MacIntel' : platform });
        if (platform === 'remote') window.__SPIELBERG_API_URL__ = 'http://192.0.2.1:8080';
        const project = { id: 'qa', name: '文件定位测试', path: '/fixture', updated_at: '刚刚' };
        const root = platform === 'Win32' ? 'C:\\项目 素材\\' : '/fixture/项目 素材/';
        const images = [1, 2].map(id => ({ id, name: `参考图-${id}.png`, path: `${root}参考图-${id}.png`, kind: 'image', created_at: '1789990000', usage_count: 1 }));
        const audio = { id: 3, name: '声音.wav', path: `${root}声音.wav`, kind: 'audio', created_at: '1789990000', usage_count: 1 };
        const assets = [
          { id: 1, name: '测试人物', category: 'person', description: '两张参考图片', design_media_id: 2, images, audios: [audio], enabled: true },
          { id: 2, name: '无文件资产', category: 'object', description: '', design_media_id: null, images: [], audios: [], enabled: true },
        ];
        const data = { project, assets, media: [...images, audio], episodes: [], prompts: [], settings: {} };
        window.__revealCalls = [];
        window.__revealFail = false;
        window.__qaImages = images;
        window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
          if (command === 'plugin:opener|reveal_item_in_dir') {
            window.__revealCalls.push(args);
            if (window.__revealFail) throw '文件不存在';
            return null;
          }
          if (command !== 'api_request') return null;
          const { path } = args;
          if (path === '/projects') return [project];
          if (path === '/project' || path === '/project/changes') return data;
          if (path === '/tasks') return { items: [], has_more: false, next_cursor: null };
          if (path === '/media/list') return { items: data.media, total: data.media.length };
          return null;
        } };
      }, platform);
      await require('./http-fixture.cjs')(page);
      await page.goto(process.env.QA_URL || 'http://127.0.0.1:1425');
      await page.getByRole('menuitem', { name: '资产库', exact: true }).click();
      await page.getByRole('button', { name: '查看测试人物的资产详情', exact: true }).click();
      const label = platform === 'Win32' ? '在文件资源管理器中显示' : '在 Finder 中显示';
      const topbar = page.locator('.role-detail-topbar');
      if (platform === 'remote') {
        assert.equal(await page.getByRole('button', { name: label, exact: true }).count(), 0);
      } else {
        await topbar.getByRole('button', { name: label, exact: true }).click();
        await page.waitForFunction(() => window.__revealCalls.length === 1);
        assert.deepEqual(await page.evaluate(() => window.__revealCalls[0]), { paths: [await page.evaluate(() => window.__qaImages[1].path)] });
        await page.locator('.role-detail-images figure').filter({ hasText: '参考图-1.png' }).getByRole('button', { name: label, exact: true }).click();
        await page.waitForFunction(() => window.__revealCalls.length === 2);
        assert.equal(await page.evaluate(() => window.__revealCalls[1].paths[0]), await page.evaluate(() => window.__qaImages[0].path));
        await page.getByRole('button', { name: '放大查看测试人物的资产图', exact: true }).click();
        const preview = page.locator('.image-preview-modal:visible');
        const reveal = preview.getByRole('button', { name: label, exact: true });
        await page.evaluate(() => { window.__revealFail = true; });
        await reveal.click();
        await page.getByText('打开文件位置失败：文件不存在', { exact: true }).waitFor();
        await page.evaluate(() => { window.__revealFail = false; });
        await page.getByRole('button', { name: '下一张图片', exact: true }).click();
        await reveal.click();
        await page.waitForFunction(() => window.__revealCalls.length === 4);
        assert.equal(await page.evaluate(() => window.__revealCalls[3].paths[0]), await page.evaluate(() => window.__qaImages[0].path));
        const bounds = await reveal.boundingBox();
        const info = await page.locator('.image-preview-info').boundingBox();
        assert(bounds && info && bounds.x + bounds.width <= info.x + info.width + 1, 'Reveal button must fit the info sidebar');
        await page.screenshot({ path: `/tmp/spielberg-reveal-${platform}.png` });
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: '资产列表', exact: true }).click();
        await page.getByRole('button', { name: '查看无文件资产的资产详情', exact: true }).click();
        assert(await topbar.getByRole('button', { name: label, exact: true }).isDisabled());
      }
      await page.getByRole('menuitem', { name: '素材库', exact: true }).click();
      await page.getByRole('button', { name: '更多操作 参考图-1.png', exact: true }).click();
      if (platform === 'remote') {
        assert.equal(await page.getByRole('menuitem', { name: label, exact: true }).count(), 0);
      } else {
        await page.getByRole('menuitem', { name: label, exact: true }).click();
        await page.waitForFunction(() => window.__revealCalls.length === 5);
        await page.getByRole('menuitem', { name: label, exact: true }).waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => window.__revealCalls[4].paths[0]), await page.evaluate(() => window.__qaImages[0].path));
      }
      const revealCount = await page.evaluate(() => window.__revealCalls.length);
      if (platform !== 'remote') {
        await page.getByRole('button', { name: '更多操作 声音.wav', exact: true }).click();
        await page.getByRole('menuitem', { name: label, exact: true }).click();
        await page.waitForFunction(count => window.__revealCalls.length === count + 1, revealCount);
        assert.match(await page.evaluate(() => window.__revealCalls.at(-1).paths[0]), /声音\.wav$/);
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS: macOS/Windows labels, main/reference file paths, preview navigation, native errors/retry, missing-file disable, media menu, remote hiding, sidebar layout');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
