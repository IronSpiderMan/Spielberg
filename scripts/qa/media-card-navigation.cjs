// Isolated media fixture: exercises card navigation without touching real projects.
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {})});
  const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'spielberg-media-cards-'));
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const project = {id: 'qa-media-cards', name: '素材卡片方向键测试', path: '/fixture', updated_at: '1'};
      const media = Array.from({length: 34}, (_, index) => ({id: index + 1, name: `素材-${String(index + 1).padStart(2, '0')}.png`, kind: 'image', path: '/spielberg-logo-s.png', created_at: '1', usage_count: 0}));
      const data = {project, media, assets: [], episodes: [], prompts: [], settings: {}, revisions: {media: 0, assets: 0, episodes: 0, settings: 0}};
      window.__qaMediaCalls = [];
      window.__TAURI_INTERNALS__ = {invoke: async (command, args) => {
        const {path, payload} = args;
        window.__qaMediaCalls.push({path, payload});
        if (path === '/projects') return [project];
        if (path === '/project') return structuredClone(data);
        if (path === '/project/changes') return {project, revisions: data.revisions};
        if (path === '/tasks') return {items: [], has_more: false};
        if (path === '/scripts/load') return null;
        if (path === '/app/settings/load') return {projects_directory: '/fixture'};
        if (path === '/skills/list') return {items: [], directory: '/fixture/skills'};
        if (path === '/media/thumbnail') return {path: '/spielberg-logo-s.png'};
        if (path === '/media/list') {
          const filtered = media.filter(item => (payload.kind === 'all' || item.kind === payload.kind) && item.name.includes(payload.query || ''));
          return {items: filtered.slice((payload.page - 1) * payload.limit, payload.page * payload.limit), total: filtered.length};
        }
        return null;
      }};
    });
    await require('./http-fixture.cjs')(page);
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
    const nav = page.locator('[data-workspace-nav="assets"]');
    const card = id => page.locator(`[data-media-card="${id}"]`);
    const cards = page.locator('[data-media-card]');
    const focused = async locator => page.waitForFunction(element => element === document.activeElement, await locator.elementHandle());
    const press = async (key, id) => {await page.keyboard.press(key); await focused(card(id));};
    const enter = async (id = 1) => {await nav.focus(); await page.keyboard.press('ArrowRight'); await focused(card(id));};
    const columns = () => cards.evaluateAll(elements => {
      const top = elements[0].getBoundingClientRect().top;
      return elements.filter(element => Math.abs(element.getBoundingClientRect().top - top) < 2).length;
    });
    const visibleFocus = async id => {
      assert(await card(id).evaluate(element => {
        const style = getComputedStyle(element);
        return element.matches(':focus-visible') && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 1;
      }), 'Selected media has a visible card focus outline');
    };
    const ready = async (id, count) => {
      await card(id).waitFor();
      await page.waitForFunction(count => document.querySelector('.asset-library')?.getAttribute('aria-busy') === 'false' && document.querySelectorAll('[data-media-card]').length === count, count);
    };
    await nav.click();
    await ready(1, 24);
    await enter();
    assert.equal(await columns(), 4);
    await visibleFocus(1);
    await page.mouse.move(0, 0);
    await page.screenshot({path: path.join(screenshots, 'media-card-light.png'), animations: 'disabled'});
    await press('ArrowUp', 1);
    await press('ArrowRight', 2);
    await press('ArrowDown', 6);
    await press('ArrowUp', 2);
    await press('ArrowRight', 3);
    await press('ArrowRight', 4);
    await press('ArrowRight', 4);
    await press('ArrowDown', 8);
    await press('ArrowLeft', 7);
    await press('ArrowLeft', 6);
    await press('ArrowLeft', 5);
    await page.keyboard.press('ArrowLeft');
    await focused(nav);
    await enter();
    await press('End', 24);
    await press('ArrowRight', 24);
    await press('ArrowDown', 24);
    await press('Home', 1);
    assert.equal(await page.locator('.asset-pagination .arco-pagination-item-active').innerText(), '1', 'Card directions never paginate');

    // Enter and Space preview the chosen card and restore its focus on closing.
    await press('ArrowRight', 2);
    await page.keyboard.press('Enter');
    const preview = page.locator('.image-preview-modal:visible');
    await preview.waitFor();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    await preview.waitFor({state: 'hidden'});
    await focused(card(2));
    await page.keyboard.press('Space');
    await preview.waitFor();
    await page.keyboard.press('Escape');
    await preview.waitFor({state: 'hidden'});
    await focused(card(2));

    // Escape during the search debounce must not refocus a card about to disappear.
    const search = page.getByRole('textbox', {name: '搜索素材名称', exact: true});
    await search.fill('素材-03');
    await page.keyboard.press('Escape');
    await ready(3, 1);
    await focused(card(3));
    await search.fill('');
    await ready(1, 24);
    await enter();

    // A short last row stays in bounds and vertical movement chooses a real card.
    await page.locator('.asset-pagination .arco-pagination-item-next').click();
    await ready(25, 10);
    await focused(card(25));
    await press('ArrowRight', 26);
    await press('ArrowRight', 27);
    await press('ArrowRight', 28);
    await press('ArrowRight', 28);
    await press('ArrowDown', 32);
    await press('ArrowDown', 34);
    await press('ArrowDown', 34);
    await press('ArrowRight', 34);
    await press('ArrowLeft', 33);
    await page.keyboard.press('ArrowLeft');
    await focused(nav);
    await enter(25);

    await page.setViewportSize({width: 800, height: 1000});
    await enter(25);
    assert.equal(await columns(), 2);
    await press('ArrowDown', 27);
    await press('ArrowRight', 28);
    await press('ArrowRight', 28);
    await press('ArrowUp', 26);
    await press('ArrowLeft', 25);
    await page.setViewportSize({width: 1440, height: 1000});
    await page.getByRole('button', {name: '切换到暗夜模式', exact: true}).click();
    await enter(25);
    await visibleFocus(25);
    await page.screenshot({path: path.join(screenshots, 'media-card-dark.png'), animations: 'disabled'});
    assert.equal(await page.evaluate(() => window.__qaMediaCalls.filter(call => /\/media\/(import|rename|delete|restore|purge)|\/generations\//.test(call.path)).length), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS: media card entry, visible focus, four/two-column navigation, row boundaries, sidebar return, Home/End, preview return and pagination selection; screenshots: ${screenshots}`);
  } catch (error) {
    console.error(JSON.stringify(await page.evaluate(() => ({focus: document.activeElement?.outerHTML.slice(0, 500), count: document.querySelectorAll('[data-media-card]').length})).catch(() => null), null, 2));
    await page.screenshot({path: path.join(screenshots, 'failure.png'), fullPage: true, animations: 'disabled'}).catch(() => {});
    console.error(`Failure screenshot: ${path.join(screenshots, 'failure.png')}`);
    throw error;
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
