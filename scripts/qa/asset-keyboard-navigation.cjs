// Isolated asset fixtures: no real project data or generation services are used.
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {})});
  const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'spielberg-asset-keyboard-'));
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const project = {id: 'qa-asset-keyboard', name: '资产方向键测试', path: '/fixture', updated_at: '1'};
      const image = {id: 1, name: '参考图.png', path: '/spielberg-logo-s.png', kind: 'image', created_at: '1'};
      const assets = Array.from({length: 11}, (_, index) => ({
        id: index + 1, name: `资产-${String(index + 1).padStart(2, '0')}`, description: `第 ${index + 1} 个资产的描述`,
        category: index % 2 ? 'location' : 'person', enabled: index < 10,
        images: [image], audios: [], design_media_id: 1,
      }));
      const data = {project, media: [image], assets, episodes: [], prompts: [], settings: {}, revisions: {assets: 0, media: 0, episodes: 0, settings: 0}};
      window.__qaAssetCalls = [];
      window.__TAURI_INTERNALS__ = {invoke: async (command, args) => {
        const {path, payload} = args;
        window.__qaAssetCalls.push({path, payload});
        if (path === '/projects') return [project];
        if (path === '/project') return structuredClone(data);
        if (path === '/project/changes') return {project, revisions: data.revisions};
        if (path === '/tasks') return {items: [], has_more: false};
        if (path === '/scripts/load') return null;
        if (path === '/app/settings/load') return {projects_directory: '/fixture'};
        if (path === '/skills/list') return {items: [], directory: '/fixture/skills'};
        if (path === '/media/thumbnail') return {path: image.path};
        if (path === '/assets/update') {
          Object.assign(data.assets.find(asset => asset.id === payload.id), payload);
          data.revisions.assets++;
          return {ok: true};
        }
        if (path === '/assets/delete') {
          data.assets = data.assets.filter(asset => asset.id !== payload.id);
          data.revisions.assets++;
          return {ok: true};
        }
        return null;
      }};
    });
    await require('./http-fixture.cjs')(page);
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
    const nav = page.locator('[data-workspace-nav="roles"]');
    const card = id => page.locator(`[data-asset-card="${id}"]`);
    const cards = page.locator('[data-asset-card]');
    const search = page.getByRole('textbox', {name: '搜索资产名称或描述', exact: true});
    const focused = async locator => {
      await page.waitForFunction(element => element === document.activeElement, await locator.elementHandle());
    };
    const press = async (key, id) => {
      await page.keyboard.press(key);
      await focused(card(id));
    };
    const enter = async (id = 1) => {
      await nav.focus();
      await page.keyboard.press('ArrowRight');
      await focused(card(id));
    };
    const columns = () => cards.evaluateAll(elements => {
      const top = elements[0]?.getBoundingClientRect().top;
      return elements.filter(element => Math.abs(element.getBoundingClientRect().top - top) < 2).length;
    });
    const visualFocus = async () => {
      const indicator = await card(1).evaluate(element => {
        const style = getComputedStyle(element);
        const other = getComputedStyle(document.querySelector('[data-asset-card="2"]'));
        return element.matches(':focus-visible') && (
          (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 1) ||
          style.boxShadow !== other.boxShadow || style.borderColor !== other.borderColor
        );
      });
      assert(indicator, 'Keyboard selection visibly marks the focused asset card');
    };

    await nav.click();
    await card(1).waitFor();
    assert.equal(await cards.count(), 10, 'Disabled assets are excluded from navigation');
    assert.equal(await columns(), 4);
    await enter();
    await visualFocus();
    await page.mouse.move(0, 0);
    await page.screenshot({path: path.join(screenshots, 'asset-selection-light.png'), animations: 'disabled'});
    await press('ArrowUp', 1);
    await press('ArrowRight', 2);
    await press('ArrowRight', 3);
    await press('ArrowRight', 4);
    await press('ArrowRight', 4); // The last column must not wrap to the next row.
    await press('ArrowDown', 8);
    await press('ArrowDown', 10); // A short last row chooses the closest existing column.
    await press('ArrowRight', 10);
    await press('ArrowDown', 10);
    assert(await card(10).evaluate(element => {
      const box = element.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= innerHeight + 1;
    }), 'The focused lower row scrolls into view');
    await press('ArrowLeft', 9);
    await page.keyboard.press('ArrowLeft');
    await focused(nav);
    await enter(); // Returning from any row starts at the first visible asset.
    await press('ArrowDown', 5);
    await page.keyboard.press('ArrowLeft');
    await focused(nav);
    await enter();
    await page.keyboard.press('Control+ArrowRight');
    await focused(card(1));
    await page.keyboard.press('Shift+F6');
    await focused(nav);
    await page.keyboard.press('F6');
    await focused(card(1));

    // Enter opens the selected asset, and returning restores the originating card.
    await press('ArrowRight', 2);
    await page.keyboard.press('Enter');
    await page.locator('.role-detail-page').waitFor();
    await page.locator('.role-detail-page').getByRole('heading', {name: '资产-02', exact: true}).waitFor();
    await page.getByRole('button', {name: '资产列表', exact: true}).click();
    await focused(card(2));

    // Search and portalled controls own their arrow keys.
    await search.fill('资产-09');
    await page.waitForFunction(() => document.querySelectorAll('[data-asset-card]').length === 1);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowDown');
    await focused(search);
    assert.equal(await search.inputValue(), '资产-09');
    await enter(9);
    await press('ArrowRight', 9);
    await press('ArrowDown', 9);
    await search.fill('');
    await page.waitForFunction(() => document.querySelectorAll('[data-asset-card]').length === 10);
    await enter();
    await page.getByLabel('资产类别筛选', {exact: true}).click();
    await page.locator('.arco-select-popup:visible').waitFor();
    await page.keyboard.press('ArrowDown');
    assert(await page.locator('.arco-select-popup:visible').count(), 'Category popup retains its keyboard interaction');
    assert.equal(await card(1).evaluate(element => element === document.activeElement), false);
    await page.keyboard.press('Escape');

    await card(1).getByRole('button', {name: '放大查看资产-01的资产图', exact: true}).click();
    await page.locator('.image-preview-modal:visible').waitFor();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    assert.equal(await cards.evaluateAll(elements => elements.some(element => element === document.activeElement)), false, 'Preview arrows never focus the underlying asset grid');
    await page.keyboard.press('Escape');
    await page.locator('.image-preview-modal:visible').waitFor({state: 'hidden'});
    await card(1).getByRole('button', {name: '设定', exact: true}).click();
    const drawer = page.locator('.arco-drawer:visible');
    await drawer.waitFor();
    const name = drawer.getByRole('textbox', {name: '资产名称', exact: true});
    await name.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await focused(name);
    await drawer.locator('.arco-drawer-close-icon').click();
    await drawer.waitFor({state: 'hidden'});

    // Column counts change with the viewport; navigation must follow the new layout.
    await page.setViewportSize({width: 1000, height: 1000});
    await enter();
    assert.equal(await columns(), 2);
    await press('ArrowDown', 3);
    await press('ArrowRight', 4);
    await press('ArrowRight', 4);
    await press('ArrowDown', 6);
    await press('ArrowUp', 4);
    await press('ArrowLeft', 3);
    await page.keyboard.press('ArrowLeft');
    await focused(nav);
    await page.setViewportSize({width: 1440, height: 1000});
    await page.getByRole('button', {name: '切换到暗夜模式', exact: true}).click();
    await enter();
    await visualFocus();
    await page.screenshot({path: path.join(screenshots, 'asset-selection-dark.png'), animations: 'disabled'});

    // Empty filters keep a useful entry target instead of dropping focus onto body.
    await search.fill('没有这个资产');
    await page.waitForFunction(() => document.querySelectorAll('[data-asset-card]').length === 0);
    await nav.focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.activeElement?.matches('.role-create-button, .role-create'));
    await page.keyboard.press('ArrowLeft');
    await focused(nav);
    assert.equal(await page.evaluate(() => window.__qaAssetCalls.filter(call => /\/assets\/(update|delete)$|\/generations\//.test(call.path)).length), 0, 'Navigation must not mutate assets or invoke generation');
    assert.deepEqual(errors, []);
    console.log(`PASS: first-card entry, visible focus, spatial arrows, row boundaries, sidebar return, responsive columns, filters, detail return, overlay guards and empty results; screenshots: ${screenshots}`);
  } catch (error) {
    console.error(JSON.stringify(await page.evaluate(() => ({focus: document.activeElement?.outerHTML.slice(0, 500), cards: [...document.querySelectorAll('[data-asset-card]')].map(element => ({id: element.dataset.assetCard, tabIndex: element.tabIndex}))})).catch(() => null), null, 2));
    await page.screenshot({path: path.join(screenshots, 'failure.png'), fullPage: true, animations: 'disabled'}).catch(() => {});
    console.error(`Failure screenshot: ${path.join(screenshots, 'failure.png')}`);
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
