// Browser fixtures only: no real project or backend service is changed.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'spielberg-project-config-'));
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  try {
    await page.addInitScript(() => {
      const saved = localStorage.getItem('qa-project-config-fixture');
      // Deliberately omit timelines to exercise pre-feature project compatibility.
      const project = saved ? JSON.parse(saved) : {
        id: 'qa-project-config', name: '故事设定验证', path: '/fixture', updated_at: '1',
        outline: '故事从一次重逢开始。', agents_md: '保持角色设定一致。',
        documents: [{ id: 'world', title: '世界观', content: '# 世界观\n城市建立于海边。' }, { id: 'characters', title: '人物关系', content: '林与周是同学。' }],
      };
      const data = { project, assets: [], episodes: [], prompts: [], media: [], settings: {} };
      window.__qaData = data;
      window.__qaCalls = [];
      const original = window.fetch.bind(window);
      window.fetch = async (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (!url.pathname.startsWith('/api/v1/')) return original(input, init);
        let pathname = url.pathname.slice('/api/v1'.length);
        if (pathname.startsWith('/actions/')) pathname = pathname.slice('/actions'.length);
        const payload = init.body ? JSON.parse(init.body) : {};
        window.__qaCalls.push({ path: pathname, method: init.method || 'GET', payload });
        let result = { ok: true };
        if (pathname === '/projects') result = [data.project];
        if (pathname === '/project' || pathname === '/project/changes') result = structuredClone(data);
        if (pathname === '/tasks') result = { items: [], has_more: false };
        if (pathname === '/app/settings/load') result = { projects_directory: '/fixture' };
        if (pathname === '/skills/list') result = { items: [], directory: '/fixture/skills' };
        if (pathname === '/projects/qa-project-config' && init.method === 'PATCH') {
          if (window.__qaFailSave) return new Response(JSON.stringify({ error: '模拟保存失败' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
          if (window.__qaHoldSave) await new Promise(resolve => { window.__qaFinishSave = resolve; });
          data.project = { ...data.project, ...structuredClone(payload) };
          localStorage.setItem('qa-project-config-fixture', JSON.stringify(data.project));
          result = structuredClone(data.project);
        }
        return new Response(JSON.stringify({ data: result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    });
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
    const config = page.locator('.project-config-page');
    const tab = name => config.getByRole('tab', { name: new RegExp(`^${name}`) });
    const save = () => config.getByRole('button', { name: '保存配置', exact: true });
    const open = async () => {
      await page.locator('[data-workspace-nav="project-config"]').click();
      await config.getByRole('heading', { name: '项目配置', exact: true }).waitFor();
    };
    const payloads = () => page.evaluate(() => window.__qaCalls.filter(call => call.method === 'PATCH' && call.path === '/projects/qa-project-config').map(call => call.payload));
    const lastPayload = async () => (await payloads()).at(-1);
    const confirm = async text => page.locator('.arco-popconfirm:visible').getByRole('button', { name: text, exact: true }).click();
    await open();
    assert.equal(await config.getByRole('tabpanel').filter({ visible: true }).count(), 1);
    assert.equal(await config.getByLabel('项目名称', { exact: true }).inputValue(), '故事设定验证');
    await config.getByLabel('项目名称', { exact: true }).fill('改写后的故事');
    await config.getByLabel('项目大纲', { exact: true }).fill('主线围绕重逢、调查与和解展开。');
    await tab('项目文档').click();
    assert.equal(await config.getByLabel('文档标题', { exact: true }).inputValue(), '世界观', 'The first document opens automatically');
    await config.getByLabel('文档标题', { exact: true }).fill('海边城市');
    await tab('Agent 规范').click();
    await config.getByLabel('AGENTS.md', { exact: true }).fill('使用中文，保持角色设定一致。');
    await tab('基本设置').click();
    assert.equal(await config.getByLabel('项目名称', { exact: true }).inputValue(), '改写后的故事');
    await tab('时间线').click();
    assert.equal(await config.locator('.project-timeline-option').count(), 0);
    await config.getByRole('button', { name: '创建第一条时间线', exact: true }).click();
    const field = name => config.getByLabel(name, { exact: true });
    const button = name => config.getByRole('button', { name, exact: true });
    const selectTimeline = title => config.locator('.project-timeline-option').filter({ hasText: title }).click();
    await field('时间线名称').fill('故事主线');
    await field('时间线说明').fill('主角从重逢到和解的经历');
    await button('添加第一个时间点').click();
    await field('时间点 1').fill('2008 年 9 月 · 开学日');
    await field('时间点 1 的事件 1').fill('林在校门口遇见多年未见的周。');
    await button('为时间点 1 添加事件').click();
    await field('时间点 1 的事件 2').fill('与此同时，老师在办公室收到一封匿名信。');
    await button('添加时间点').click();
    await field('时间点 2').fill('第三天');
    await field('时间点 2 的事件 1').fill('两人决定一起调查匿名信。');
    assert(await button('上移时间点 1').isDisabled());
    assert(await button('下移时间点 2').isDisabled());
    await button('上移时间点 2').click();
    assert.equal(await field('时间点 1').inputValue(), '第三天');
    assert.equal(await field('时间点 2 的事件 2').inputValue(), '与此同时，老师在办公室收到一封匿名信。');
    await button('下移时间点 1').click();
    assert.equal(await field('时间点 1').inputValue(), '2008 年 9 月 · 开学日');

    // Deletion confirms at event, time-point, and timeline level.
    await button('为时间点 1 添加事件').click();
    await field('时间点 1 的事件 3').fill('待删除的草稿');
    await button('删除时间点 1 的事件 3').click();
    await confirm('取消');
    assert.equal(await field('时间点 1 的事件 3').inputValue(), '待删除的草稿');
    await button('删除时间点 1 的事件 3').click();
    await confirm('删除事件');
    await field('时间点 1 的事件 3').waitFor({ state: 'detached' });
    await button('添加时间点').click();
    await field('时间点 3').fill('待删除的时间');
    await button('删除时间点 3').click();
    await confirm('取消');
    assert.equal(await field('时间点 3').inputValue(), '待删除的时间');
    await button('删除时间点 3').click();
    await confirm('删除时间点');
    await field('时间点 3').waitFor({ state: 'detached' });

    await button('新建时间线').click();
    await field('时间线名称').fill('人物成长线');
    await button('添加第一个时间点').click();
    await field('时间点 1').fill('十年前');
    await field('时间点 1 的事件 1').fill('林第一次离开海边城市。');
    await button('新建时间线').click();
    await field('时间线名称').fill('待删除的支线');
    await button('删除时间线').click();
    await confirm('取消');
    assert.equal(await field('时间线名称').inputValue(), '待删除的支线');
    await button('删除时间线').click();
    await confirm('删除时间线');
    assert.equal(await config.locator('.project-timeline-option').count(), 2);
    assert.equal(await field('时间线名称').inputValue(), '人物成长线');
    await tab('项目文档').click();
    assert.equal(await field('文档标题').inputValue(), '海边城市');
    await tab('时间线').click();
    assert.equal(await field('时间线名称').inputValue(), '人物成长线', 'Switching categories preserves selected timeline');

    // Invalid drafts never leave the browser, and keep the input editable.
    const validateNoRequest = async () => {
      const count = (await payloads()).length;
      await save().click();
      await page.locator('.arco-message-warning').last().waitFor();
      assert.equal((await payloads()).length, count);
    };
    await field('时间线名称').fill('   ');
    await validateNoRequest();
    await field('时间线名称').fill('人物成长线');
    await field('时间点 1').fill('');
    await validateNoRequest();
    await field('时间点 1').fill('十年前');
    await field('时间点 1 的事件 1').fill('   ');
    await validateNoRequest();
    await field('时间点 1 的事件 1').fill('林第一次离开海边城市。');
    await button('删除时间点 1 的事件 1').click();
    await confirm('删除事件');
    await validateNoRequest();
    await button('为时间点 1 添加事件').click();
    await field('时间点 1 的事件 1').fill('林第一次离开海边城市。');
    await selectTimeline('故事主线');
    await field('时间点 1 的事件 1').fill('');
    await selectTimeline('人物成长线');
    await tab('基本设置').click();
    await validateNoRequest();
    await page.waitForFunction(() => document.querySelector('input[aria-label="时间线名称"]')?.value === '故事主线');
    assert.equal(await tab('时间线').getAttribute('aria-selected'), 'true');
    assert.equal(await field('时间线名称').inputValue(), '故事主线', 'Validation reveals the timeline containing the error');
    await field('时间点 1 的事件 1').fill('林在校门口遇见多年未见的周。');
    await selectTimeline('人物成长线');

    // A failed save preserves drafts; a held successful save disables mutation controls.
    await page.evaluate(() => { window.__qaFailSave = true; });
    await save().click();
    await page.getByText('Error: 模拟保存失败', { exact: true }).waitFor();
    assert.equal(await field('时间点 1 的事件 1').inputValue(), '林第一次离开海边城市。');
    assert(await save().isEnabled());
    await page.evaluate(() => { window.__qaFailSave = false; window.__qaHoldSave = true; });
    await save().click();
    await page.waitForFunction(() => typeof window.__qaFinishSave === 'function');
    assert(await field('时间线名称').isDisabled());
    assert(await field('时间点 1').isDisabled());
    assert(await button('新建时间线').isDisabled());
    assert(await button('删除时间线').isDisabled());
    await page.evaluate(() => { window.__qaFinishSave(); });
    await page.getByText('项目配置已保存', { exact: true }).waitFor();
    const saved = await lastPayload();
    assert.equal(saved.name, '改写后的故事');
    assert.equal(saved.outline, '主线围绕重逢、调查与和解展开。');
    assert.equal(saved.agents_md, '使用中文，保持角色设定一致。');
    assert.equal(saved.documents[0].title, '海边城市');
    assert.equal(saved.timelines.length, 2);
    assert.deepEqual(saved.timelines.map(timeline => timeline.title), ['故事主线', '人物成长线']);
    assert.deepEqual(saved.timelines[0].entries.map(entry => entry.time), ['2008 年 9 月 · 开学日', '第三天']);
    assert.equal(saved.timelines[0].entries[0].events.length, 2);
    assert.equal(saved.timelines[1].entries[0].events[0].content, '林第一次离开海边城市。');
    assert(saved.timelines.every(timeline => timeline.id && timeline.entries.every(entry => entry.id && entry.events.every(event => event.id))));
    await page.reload();
    await open();
    await tab('时间线').click();
    assert.equal(await config.locator('.project-timeline-option').count(), 2);
    assert.equal(await field('时间点 1').inputValue(), '2008 年 9 月 · 开学日');
    assert.equal(await field('时间点 1 的事件 2').inputValue(), '与此同时，老师在办公室收到一封匿名信。');
    await selectTimeline('人物成长线');
    assert.equal(await field('时间点 1 的事件 1').inputValue(), '林第一次离开海边城市。');
    await selectTimeline('故事主线');

    // Render every category at desktop, tablet, and phone widths in both themes.
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByRole('button', { name: '切换到暗夜模式', exact: true }).click();
      for (const [width, height] of [[1440, 1000], [1024, 768], [768, 900], [390, 844], [1440, 600], [1024, 600], [700, 650]]) {
        await page.setViewportSize({ width, height });
        for (const name of ['基本设置', '项目文档', 'Agent 规范', '时间线']) {
          await tab(name).click();
          assert.equal(await config.getByRole('tabpanel').filter({ visible: true }).count(), 1);
          assert(await config.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${theme} ${name} fits at ${width}px`);
          const panel = config.getByRole('tabpanel').filter({ visible: true });
          assert(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${theme} ${name} panel fits at ${width}px`);
          if (name === '项目文档') {
            const source = await field('文档正文').boundingBox();
            assert(source && source.height >= 110, `Document source retains usable height at ${width}x${height}`);
            assert(await panel.locator('.screenplay-panels').evaluate(element => element.scrollHeight <= element.clientHeight + 1), `Document panels are not clipped at ${width}x${height}`);
          }
          if (width === 1440 || width === 390 || height === 600) await page.screenshot({ animations: 'disabled', path: path.join(screenshots, `${theme}-${width}x${height}-${name}.png`) });
        }
        await field('时间点 2 的事件 1').scrollIntoViewIfNeeded();
        await button('继续添加时间点').scrollIntoViewIfNeeded();
        const addBounds = await button('继续添加时间点').boundingBox();
        assert(addBounds && addBounds.y >= 0 && addBounds.y + addBounds.height <= height, `The last time point stays reachable at ${width}x${height}`);
        await page.screenshot({ animations: 'disabled', path: path.join(screenshots, `${theme}-${width}x${height}.png`) });
      }
    }

    // Removing the final timeline produces the empty state and an explicit [] payload.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await button('删除时间线').click();
    await confirm('删除时间线');
    assert.equal(await field('时间线名称').inputValue(), '人物成长线');
    await button('删除时间线').click();
    await confirm('删除时间线');
    await button('创建第一条时间线').waitFor();
    await save().click();
    await page.getByText('项目配置已保存', { exact: true }).last().waitFor();
    assert.deepEqual((await lastPayload()).timelines, []);

    assert.deepEqual(errors, []);
    console.log(`PASS: project tabs, legacy defaults, document selection, multi-timeline/event CRUD, reorder, confirmations, validation, save failure/retry/busy, PATCH payload, reload and responsive themes; screenshots: ${screenshots}`);
  } catch (error) {
    await page.screenshot({ animations: 'disabled', path: path.join(screenshots, 'failure.png'), fullPage: true }).catch(() => {});
    console.error(`Failure screenshot: ${path.join(screenshots, 'failure.png')}`);
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
