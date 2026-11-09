// Isolated API fixtures: never read or modify real projects, files, or services.
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {})});
  const output = fs.mkdtempSync('/tmp/spielberg-confirmations-');
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  page.setDefaultTimeout(12000);
  const errors = [];
  const layoutErrors = [];
  const checks = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      localStorage.setItem('spielberg-theme', 'light');
      const project = {id: 'qa-confirmations', name: '确认弹窗测试', path: '/fixture', updated_at: '1', documents: [
        {id: 'outline', title: '故事总纲', content: '# 第一章\n一场雨夜中的重逢。'},
        {id: 'long', title: '世界观与人物关系'.repeat(14), content: '# 长名称测试'},
      ]};
      const image = {id: 1, name: '角色参考图.png', kind: 'image', path: '/spielberg-logo-s.png', created_at: '1', usage_count: 0};
      const data = {project, assets: [{id: 1, name: '林舟', description: '雨夜里的主角', enabled: true, category: 'person', design_media_id: 1, images: [image], audios: []}], episodes: [{id: 1, title: '第一集 · 雨夜重逢', description: '', scenes: [], clips: [], playback_units: []}], prompts: [], media: [image], settings: {}};
      window.__qaCalls = [];
      window.__qaData = data;
      window.__qaHoldDelete = false;
      window.__qaFailDelete = false;
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (!url.pathname.startsWith('/api/v1/')) return originalFetch(input, init);
        const resource = url.pathname.slice('/api/v1'.length);
        const action = resource.startsWith('/actions/') ? resource.slice('/actions'.length) : resource;
        const payload = init.body ? JSON.parse(init.body) : {};
        const method = init.method || 'GET';
        window.__qaCalls.push({resource, action, method, payload});
        let result = {ok: true};
        if (resource === '/projects' && method === 'GET') result = [project];
        if (action === '/project' || action === '/project/changes') result = structuredClone(data);
        if (action === '/tasks') result = {items: [], has_more: false};
        if (action === '/app/settings/load') result = {projects_directory: '/fixture'};
        if (action === '/skills/list') result = {items: [], directory: '/fixture/skills'};
        if (action === '/scripts/load') result = null;
        if (action === '/screenplays' || action === '/editor/projects') result = [];
        if (action === '/media/thumbnail') result = {path: image.path};
        if (resource === '/projects/qa-confirmations/media') result = {items: [image], total: 1};
        if (resource === '/projects/qa-confirmations' && method === 'PATCH') {Object.assign(project, payload); result = structuredClone(project);}
        if (resource === '/projects/qa-confirmations/episodes/1' && method === 'DELETE') {
          if (window.__qaHoldDelete) await new Promise(resolve => {window.__qaFinishDelete = resolve;});
          if (window.__qaFailDelete) return new Response(JSON.stringify({error: '模拟删除失败，请重试'}), {status: 500, headers: {'Content-Type': 'application/json'}});
          data.episodes = [];
        }
        return new Response(JSON.stringify({data: result}), {status: 200, headers: {'Content-Type': 'application/json'}});
      };
    });
    await page.route('**/media?*', route => route.fulfill({status: 302, headers: {Location: '/spielberg-logo-s.png'}}));
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
    await page.locator('.creation-desk').waitFor();
    const nav = async name => {
      if (page.viewportSize().width <= 600) await page.getByRole('button', {name: '切换导航', exact: true}).click();
      await page.locator('.nav .arco-menu-item').filter({hasText: name}).click();
    };
    const popup = page.locator('.studio-confirm-popover:visible');
    const docDelete = page.locator('.project-document-editor').getByRole('button', {name: '删除文档', exact: true});
    const docCount = () => page.getByRole('navigation', {name: '项目文档列表'}).getByRole('button').count();
    const updates = () => page.evaluate(() => window.__qaCalls.filter(call => call.resource === '/projects/qa-confirmations' && call.method === 'PATCH').length);
    const fit = async (locator, label) => {
      await locator.waitFor();
      // Arco mounts the portal at (0, 0), then positions it on the next frame.
      await page.waitForFunction(element => {
        const box = element.getBoundingClientRect();
        return box.x >= 7 && box.y >= 7;
      }, await locator.elementHandle());
      const box = await locator.boundingBox();
      const view = page.viewportSize();
      if (!(box && box.x >= 7 && box.y >= 7 && box.x + box.width <= view.width - 7 && box.y + box.height <= view.height - 7)) {
        layoutErrors.push(`${label}: popup must fit viewport gutters (${JSON.stringify({box, view})})`);
      }
      const overflowing = await locator.evaluate(element => element.scrollWidth > element.clientWidth + 1);
      assert(!overflowing, `${label}: popup must not overflow horizontally`);
      checks.push(label);
    };
    await nav('项目配置');
    await page.getByRole('navigation', {name: '项目文档列表'}).getByRole('button', {name: '故事总纲', exact: true}).click();
    await docDelete.click();
    await popup.waitFor();
    assert.match(await popup.locator('.arco-popconfirm-inner-content').innerText(), /保存配置/);
    assert.doesNotMatch(await popup.locator('.arco-popconfirm-title-text').innerText(), /保存配置/);
    const confirm = popup.getByRole('button', {name: '删除文档', exact: true});
    assert.match(await confirm.getAttribute('class'), /arco-btn-status-danger/);
    assert((await confirm.boundingBox()).height >= 32, 'Confirmation buttons should have comfortable hit targets');
    await page.waitForFunction(() => document.activeElement?.closest('.studio-confirm-popover'));
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => !!document.activeElement?.closest('.studio-confirm-popover')), 'Tab should remain inside the confirmation');
    await page.keyboard.press('Escape');
    await popup.waitFor({state: 'hidden'});
    await page.waitForFunction(() => document.activeElement?.textContent === '删除文档');
    assert.equal(await docCount(), 2);
    assert.equal(await updates(), 0);
    checks.push('keyboard focus, Escape, and cancellation preserve the draft');

    for (const viewport of [{width: 1440, height: 1000}, {width: 390, height: 568}]) {
      await page.setViewportSize(viewport);
      for (const theme of ['light', 'dark']) {
        if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('.theme-toggle').click();
        await docDelete.click();
        const label = `${theme}-${viewport.width}x${viewport.height}`;
        await fit(popup, label);
        await page.screenshot({path: path.join(output, `${label}.png`)});
        await popup.screenshot({path: path.join(output, `${label}-popup.png`)});
        const dangerColor = await confirm.evaluate(element => getComputedStyle(element).backgroundColor.match(/[\d.]+/g).map(Number));
        assert(dangerColor[0] > dangerColor[1] + 20 && dangerColor[0] > dangerColor[2] + 20, 'Danger actions should use a visibly red background');
        await popup.getByRole('button', {name: '取消', exact: true}).click();
        await popup.waitFor({state: 'hidden'});
      }
    }
    await page.getByRole('navigation', {name: '项目文档列表'}).getByRole('button').last().click();
    await docDelete.click();
    await fit(popup, 'long-name-phone');
    await page.screenshot({path: path.join(output, 'long-name-phone.png')});
    await popup.getByRole('button', {name: '取消', exact: true}).click();
    await popup.waitFor({state: 'hidden'});

    await page.setViewportSize({width: 1440, height: 1000});
    await page.getByRole('navigation', {name: '项目文档列表'}).getByRole('button', {name: '故事总纲', exact: true}).click();
    await docDelete.click();
    await popup.getByRole('button', {name: '删除文档', exact: true}).click();
    await popup.waitFor({state: 'hidden'});
    assert.equal(await docCount(), 1);
    assert.equal(await updates(), 0, 'Confirming document removal must only edit the local draft');
    await page.getByRole('button', {name: '保存配置', exact: true}).click();
    await page.waitForFunction(() => window.__qaCalls.some(call => call.resource === '/projects/qa-confirmations' && call.method === 'PATCH'));
    assert.equal(await page.evaluate(() => window.__qaData.project.documents.length), 1);
    checks.push('document deletion persists only after Save configuration');

    await page.getByRole('button', {name: '新建文档', exact: true}).click();
    await nav('剧集');
    const modal = page.locator('.studio-confirm-modal:visible');
    await fit(modal, 'discard-modal');
    assert.match(await modal.innerText(), /放弃未保存/);
    await page.screenshot({path: path.join(output, 'discard-modal.png')});
    await modal.getByRole('button', {name: '继续编辑', exact: true}).click();
    await modal.waitFor({state: 'hidden'});
    assert.equal(await docCount(), 2);
    await nav('剧集');
    await modal.getByRole('button', {name: '放弃修改', exact: true}).click();
    await modal.waitFor({state: 'hidden'});
    await page.locator('.episode-card').waitFor();

    await page.locator('.episode-card .arco-btn-status-danger').click();
    await popup.waitFor();
    await page.evaluate(() => {window.__qaHoldDelete = true; window.__qaFailDelete = true;});
    const deleteEpisode = popup.getByRole('button', {name: /删除.*集/});
    await deleteEpisode.click();
    await page.waitForFunction(() => typeof window.__qaFinishDelete === 'function');
    assert.match(await deleteEpisode.getAttribute('class'), /arco-btn-loading/);
    assert.equal(await page.locator('.episode-card').count(), 1, 'Pending delete must not remove the episode early');
    await page.evaluate(() => window.__qaFinishDelete());
    await page.waitForFunction(() => !document.querySelector('.studio-confirm-popover .arco-btn-loading'));
    await page.getByText('模拟删除失败，请重试', {exact: false}).waitFor();
    assert(await popup.isVisible(), 'A failed deletion should remain open for retry');
    assert.equal(await page.locator('.episode-card').count(), 1);
    await page.evaluate(() => {window.__qaHoldDelete = false; window.__qaFailDelete = false;});
    await deleteEpisode.click();
    await popup.waitFor({state: 'hidden'});
    await page.locator('.episode-card').waitFor({state: 'detached'});
    checks.push('async deletion stays pending, preserves data on failure, and succeeds on retry');

    await nav('资产库');
    await page.locator('.role-card').getByRole('button', {name: '设定', exact: true}).click();
    const drawer = page.locator('.arco-drawer:visible');
    await drawer.waitFor();
    const removeImage = drawer.getByRole('button', {name: '删除 角色参考图.png', exact: true});
    await removeImage.click();
    await fit(popup, 'nested-asset-drawer');
    await page.waitForFunction(() => document.activeElement?.closest('.studio-confirm-popover'));
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => !!document.activeElement?.closest('.studio-confirm-popover')), 'Parent drawer must not steal confirmation focus');
    await page.screenshot({path: path.join(output, 'nested-asset-drawer.png')});
    await page.keyboard.press('Escape');
    await popup.waitFor({state: 'hidden'});
    assert(await drawer.isVisible(), 'Escape must close only the confirmation, leaving the drawer open');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '删除 角色参考图.png');
    checks.push('nested confirmation retains focus and Escape preserves parent drawer');
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({checks, errors, layoutErrors}, null, 2));
    assert.deepEqual(errors, []);
    assert.deepEqual(layoutErrors, []);
    console.log(JSON.stringify({checks, errors, layoutErrors, screenshots: output}, null, 2));
  } catch (error) {
    await page.screenshot({path: path.join(output, 'failure.png')});
    console.error(`Failure screenshot: ${output}/failure.png`);
    throw error;
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exit(1);});
