// Isolated browser fixtures: never read or mutate real projects or call a model.
// Run against Vite with QA_URL and an installed PLAYWRIGHT_PATH if needed.
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {})});
  const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'spielberg-keyboard-'));
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const project = {id: 'qa-keyboard', name: '键盘交互测试', path: '/fixture', updated_at: '1'};
      const media = Array.from({length: 65}, (_, index) => ({id: index + 1, name: `素材-${String(index + 1).padStart(2, '0')}.png`, kind: 'image', path: '/spielberg-logo-s.png', created_at: '1789990000', usage_count: 0}));
      const data = {project, media, assets: [], episodes: [], prompts: [], settings: {
        llm: {provider: 'openai', base_url: 'https://fixture.invalid/v1', api_key: 'fixture', model: 'qa-model'},
      }, revisions: {media: 0, assets: 0, episodes: 0, settings: 0}};
      const sessions = [1, 2, 3].map(id => ({id: `session-${id}`, title: `会话 ${id}`, status: 'completed', updated_at: '1', messages: [
        {role: 'user', content: `请求 ${id}`},
        {role: 'assistant', content: Array.from({length: 45}, (_, line) => `会话 ${id} 的第 ${line + 1} 段回复。`).join('\n\n')},
      ]}));
      window.__qaCalls = [];
      window.__qaSlowSession = null;
      window.__qaHoldMedia = false;
      const original = window.fetch.bind(window);
      window.fetch = async (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (!url.pathname.startsWith('/api/v1/')) return original(input, init);
        let route = url.pathname.slice('/api/v1'.length);
        if (route.startsWith('/actions/')) route = route.slice('/actions'.length);
        let payload = init.body ? JSON.parse(init.body) : {};
        if (route === `/projects/${project.id}/media`) {
          route = '/media/list';
          payload = Object.fromEntries(url.searchParams);
        }
        window.__qaCalls.push({path: route, payload});
        let result = {ok: true};
        if (route === '/projects') result = [project];
        if (route === '/project') result = structuredClone(data);
        if (route === '/project/changes') result = {project, revisions: data.revisions};
        if (route === '/tasks') result = {items: [], has_more: false};
        if (route === '/scripts/load') result = null;
        if (route === '/app/settings/load') result = {projects_directory: '/fixture'};
        if (route === '/skills/list') result = {items: [], directory: '/fixture/skills'};
        if (route === '/media/thumbnail') result = {path: '/spielberg-logo-s.png'};
        if (route === '/media/list') {
          if (window.__qaHoldMedia) await new Promise(resolve => {window.__qaResolveMedia = resolve;});
          const filtered = media.filter(item => (payload.kind === 'all' || item.kind === payload.kind) && item.name.includes(payload.query || ''));
          result = {items: filtered.slice((Number(payload.page) - 1) * Number(payload.limit), Number(payload.page) * Number(payload.limit)), total: filtered.length};
        }
        if (route === '/agent/sessions') result = {items: sessions.map(session => ({...session, messages: []}))};
        if (route === '/agent/config') result = {inherit_llm: true, base_url: '', model: '', has_api_key: false, search_provider: 'duckduckgo', has_search_api_key: false, max_steps: 16, request_timeout_seconds: 600};
        if (route === '/agent/session') {
          if (window.__qaSlowSession === payload.session_id) await new Promise(resolve => {window.__qaResolveSession = resolve;});
          result = sessions.find(session => session.id === payload.session_id);
        }
        return new Response(JSON.stringify({data: result}), {status: 200, headers: {'Content-Type': 'application/json'}});
      };
    });
    await page.route('**/media?*', route => route.fulfill({status: 302, headers: {Location: '/spielberg-logo-s.png'}}));
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
    const nav = label => page.locator('[data-workspace-nav]').filter({hasText: label});
    const session = id => page.getByTestId(`agent-session-session-${id}`);
    const composer = page.getByTestId('agent-composer');
    const log = page.locator('[data-keyboard-region="conversation"]');
    const focused = async locator => {
      await page.waitForFunction(element => element === document.activeElement, await locator.elementHandle());
      return true;
    };
    const selectedSession = async id => {
      await page.waitForFunction(id => document.querySelector(`[data-testid="agent-session-session-${id}"]`)?.getAttribute('aria-current') === 'page', id);
    };
    const readySession = async id => {
      await selectedSession(id);
      await page.waitForFunction(() => !document.querySelector('[data-testid="agent-composer"]')?.disabled);
    };

    // Main navigation is one keyboard stop; arrow selection opens the page.
    await nav('工作台').focus();
    await page.keyboard.press('ArrowUp');
    await readySession(1);
    assert(await focused(nav('Agent 助手')));
    await page.keyboard.press('ArrowRight');
    assert(await focused(session(1)));
    await page.keyboard.press('ArrowDown');
    await readySession(2);
    assert(await focused(session(2)));
    await page.keyboard.press('ArrowLeft');
    assert(await focused(nav('Agent 助手')));
    await page.keyboard.press('ArrowRight');
    assert(await focused(session(2)), 'Returning to conversations keeps the selected session');
    await page.keyboard.press('End');
    await readySession(3);
    await page.keyboard.press('Home');
    await readySession(1);

    // An old asynchronous response must never replace the last chosen session.
    await page.evaluate(() => {window.__qaSlowSession = 'session-2';});
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => typeof window.__qaResolveSession === 'function');
    await page.keyboard.press('ArrowDown');
    await readySession(3);
    await page.evaluate(() => {window.__qaResolveSession(); window.__qaSlowSession = null;});
    await page.waitForFunction(() => document.querySelector('.agent-message-content')?.textContent.includes('请求 3'));
    await selectedSession(3);
    assert(await focused(session(3)));
    await page.keyboard.press('Home');
    await readySession(1);
    await session(1).dispatchEvent('keydown', {key: 'ArrowDown', isComposing: true});
    await selectedSession(1);
    await page.keyboard.press('Control+ArrowDown');
    await selectedSession(1);

    await page.keyboard.press('ArrowRight');
    assert(await focused(log));
    await page.keyboard.press('Home');
    await page.waitForFunction(() => document.querySelector('[data-keyboard-region="conversation"]').scrollTop === 0);
    await page.keyboard.press('PageDown');
    await page.waitForFunction(() => document.querySelector('[data-keyboard-region="conversation"]').scrollTop > 0);
    await page.keyboard.press('/');
    assert(await focused(composer));
    await composer.fill('第一行草稿\n第二行草稿');
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) await page.keyboard.press(key);
    assert.equal(await composer.inputValue(), '第一行草稿\n第二行草稿');
    await selectedSession(1);
    await page.keyboard.press('F6');
    assert(await focused(nav('Agent 助手')), 'F6 can leave the composer without changing its draft');
    await page.keyboard.press('F6');
    assert(await focused(session(1)));
    await page.keyboard.press('ArrowDown');
    await readySession(2);
    await page.keyboard.press('ArrowUp');
    await readySession(1);
    assert.equal(await composer.inputValue(), '第一行草稿\n第二行草稿');
    await page.keyboard.press('Shift+F6');
    assert(await focused(nav('Agent 助手')));
    await page.keyboard.press('?');
    const help = page.getByRole('dialog').filter({visible: true});
    await help.waitFor();
    await page.keyboard.press('ArrowDown');
    assert.equal(await nav('Agent 助手').getAttribute('aria-current'), 'page');
    await page.keyboard.press('Escape');
    await help.waitFor({state: 'hidden'});
    await page.screenshot({path: path.join(screenshots, 'agent-keyboard.png'), animations: 'disabled'});

    await nav('素材库').click();
    const library = page.locator('.asset-library');
    const scroll = library.locator(':scope > .arco-spin');
    const search = library.getByRole('textbox', {name: '搜索素材名称', exact: true});
    const countMediaRequests = () => page.evaluate(() => window.__qaCalls.filter(call => call.path === '/media/list').length);
    const readyPage = async (firstId, count) => {
      await page.getByRole('button', {name: `预览 素材-${String(firstId).padStart(2, '0')}.png`, exact: true}).waitFor();
      await page.waitForFunction(count => document.querySelector('.asset-library')?.getAttribute('aria-busy') === 'false' && document.querySelectorAll('.asset-library .library-card').length === count, count);
      assert.equal(await library.locator('.library-card').count(), count);
    };
    await readyPage(1, 24);
    await nav('素材库').focus();
    await page.keyboard.press('ArrowRight');
    assert(await focused(library));
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.querySelector('.asset-library > .arco-spin').scrollTop > 0);
    const arrowScroll = await scroll.evaluate(element => element.scrollTop);
    await page.keyboard.press('PageDown');
    await page.waitForFunction(previous => document.querySelector('.asset-library > .arco-spin').scrollTop > previous, arrowScroll);
    await page.keyboard.press('Home');
    await page.waitForFunction(() => document.querySelector('.asset-library > .arco-spin').scrollTop === 0);
    let requests = await countMediaRequests();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await countMediaRequests(), requests, 'First page cannot paginate backwards');
    await page.keyboard.press('ArrowRight');
    await readyPage(25, 24);
    assert(await library.evaluate(element => element.contains(document.activeElement)), 'Paging keeps keyboard focus in the library');
    await page.keyboard.press('ArrowRight');
    await readyPage(49, 17);
    requests = await countMediaRequests();
    await page.keyboard.press('ArrowRight');
    assert.equal(await countMediaRequests(), requests, 'Last page cannot paginate forwards');
    await page.keyboard.press('ArrowLeft');
    await readyPage(25, 24);

    // Loading requests are not multiplied by held/repeated keys.
    await page.evaluate(() => {window.__qaHoldMedia = true;});
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => typeof window.__qaResolveMedia === 'function');
    requests = await countMediaRequests();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    assert.equal(await countMediaRequests(), requests, 'Pagination stays locked until the held response completes');
    await page.evaluate(() => {window.__qaHoldMedia = false; window.__qaResolveMedia();});
    await readyPage(1, 24);
    await page.keyboard.press('/');
    assert(await focused(search));
    await search.fill('素材-0');
    await readyPage(1, 9);
    requests = await countMediaRequests();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    assert.equal(await countMediaRequests(), requests, 'Search cursor keys do not paginate');
    assert.equal(await search.inputValue(), '素材-0');
    await search.fill('');
    await readyPage(1, 24);
    await page.keyboard.press('Escape');
    assert(!(await search.evaluate(element => element === document.activeElement)), 'Escape leaves search without losing its value');

    await library.getByLabel('素材类型', {exact: true}).click();
    await page.locator('.arco-select-popup:visible').waitFor();
    requests = await countMediaRequests();
    await page.keyboard.press('ArrowRight');
    assert.equal(await countMediaRequests(), requests, 'Open selects keep ownership of arrow keys');
    await page.keyboard.press('Escape');
    await page.getByRole('button', {name: '预览 素材-01.png', exact: true}).click();
    await page.locator('.image-preview-modal:visible').waitFor();
    requests = await countMediaRequests();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    assert.equal(await countMediaRequests(), requests, 'Preview navigation does not paginate underneath');
    await page.keyboard.press('Escape');
    await page.locator('.image-preview-modal:visible').waitFor({state: 'hidden'});
    await nav('素材库').focus();
    await page.keyboard.press('F6');
    assert(await focused(library));
    await page.keyboard.press('Shift+F6');
    assert(await focused(nav('素材库')));
    await page.screenshot({path: path.join(screenshots, 'library-keyboard.png'), animations: 'disabled'});
    await page.getByRole('button', {name: '切换到暗夜模式', exact: true}).click();
    await nav('素材库').focus();
    await page.keyboard.press('ArrowRight');
    assert(await focused(library));
    await page.screenshot({path: path.join(screenshots, 'library-dark-keyboard.png'), animations: 'disabled'});

    // Page arrows must honor the existing unsaved-change dialog and recover focus.
    await nav('项目配置').click();
    const projectName = page.getByRole('textbox', {name: '项目名称', exact: true});
    await projectName.fill('保留这份未保存的项目名称');
    await nav('项目配置').focus();
    await page.keyboard.press('ArrowDown');
    const confirm = page.locator('.studio-confirm-modal:visible');
    await confirm.waitFor();
    await confirm.getByRole('button', {name: '继续编辑', exact: true}).click();
    await confirm.waitFor({state: 'hidden'});
    assert.equal(await projectName.inputValue(), '保留这份未保存的项目名称');
    assert.equal(await nav('项目配置').getAttribute('aria-current'), 'page');
    await nav('项目配置').focus();
    await page.keyboard.press('ArrowDown');
    await confirm.waitFor();
    await confirm.getByRole('button', {name: '放弃修改', exact: true}).click();
    await confirm.waitFor({state: 'hidden'});
    assert(await focused(nav('后台任务')), 'Confirming page navigation keeps focus on the destination');
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.querySelector('[data-workspace-nav="prompts"]')?.getAttribute('aria-current') === 'page');

    // Hidden mobile sidebars must not receive focus from region cycling.
    await page.setViewportSize({width: 390, height: 844});
    await page.locator('#workspace-content').focus();
    await page.keyboard.press('F6');
    assert(await page.evaluate(() => {
      const target = document.activeElement;
      const box = target.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.left >= 0 && box.left < innerWidth;
    }), 'F6 only focuses visible mobile regions');
    await page.getByRole('button', {name: '切换导航', exact: true}).click();
    const mobileNav = page.getByRole('dialog', {name: '工作室导航', exact: true});
    await mobileNav.waitFor();
    assert(await focused(mobileNav.getByRole('button', {name: '关闭导航', exact: true})));
    await nav('Agent 助手').focus();
    await page.keyboard.press('Tab');
    assert(await focused(nav('工作台')), 'Mobile Tab can reach inactive pages while the dialog owns arrow keys');
    await page.getByRole('button', {name: '键盘快捷键', exact: true}).click();
    await page.locator('.keyboard-help-modal:visible').waitFor();
    await mobileNav.waitFor({state: 'hidden'});
    await page.screenshot({path: path.join(screenshots, 'mobile-keyboard-help.png'), animations: 'disabled'});
    await page.keyboard.press('Escape');
    await page.locator('.keyboard-help-modal:visible').waitFor({state: 'hidden'});
    assert(await focused(page.getByRole('button', {name: '切换导航', exact: true})), 'Closing mobile help returns focus to a visible trigger');
    await page.screenshot({path: path.join(screenshots, 'mobile-keyboard.png'), animations: 'disabled'});
    assert.equal(await page.evaluate(() => window.__qaCalls.filter(call => /\/agent\/(send|create|delete)|\/generations\/|\/projects\/update/.test(call.path)).length), 0, 'Keyboard navigation must not submit or mutate project content');
    assert.deepEqual(errors, []);
    console.log(`PASS: sidebar/session arrows, async race, drafts/IME, focus regions/help, media pagination/loading/search/scroll/overlay guards and mobile focus; screenshots: ${screenshots}`);
  } catch (error) {
    console.error(JSON.stringify(await page.evaluate(() => ({focus: document.activeElement?.outerHTML.slice(0, 300), loading: document.querySelector('.asset-library')?.getAttribute('aria-busy'), calls: window.__qaCalls?.filter(call => call.path === '/media/list' || call.path === '/agent/session').slice(-12)})).catch(() => null), null, 2));
    await page.screenshot({path: path.join(screenshots, 'failure.png'), fullPage: true, animations: 'disabled'}).catch(() => {});
    console.error(`Failure screenshot: ${path.join(screenshots, 'failure.png')}`);
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error); process.exit(1);});
