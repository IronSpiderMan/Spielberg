// Isolated fixtures: no real projects, files, credentials, or model services.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const output = '/tmp/spielberg-ui-details';

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const project = { id: 'qa-details', name: '长安十二时辰 · 雨夜追踪与角色命运的交汇', path: '/fixture/' + 'long-project-directory/'.repeat(8), updated_at: '2026-11-04' };
      const image = { id: 1, name: '雨夜长街'.repeat(12) + '.png', kind: 'image', path: '/spielberg-logo-s.png', created_at: '1793700000' };
      const data = { project, media: [image], assets: [], episodes: [], prompts: [{ id: 1, name: '雨夜场景', content: '长安雨夜，冷色灯光，湿润的石板路。', category: '场景' }], settings: { image: { channels: [{ id: 'fixture-channel', name: '图像创作', provider: 'openai', base_url: 'https://example.invalid', models: [{ id: 'gpt-image-1', name: '图像模型', profile: 'openai-image' }], default_model_id: 'gpt-image-1' }], default_channel_id: 'fixture-channel' } } };
      window.__qaCalls = [];
      window.__qaFailSave = false;
      window.__qaDelaySave = false;
      window.__TAURI_INTERNALS__ = { convertFileSrc: value => value, invoke: async (command, args) => {
        if (command !== 'api_request') return null;
        const { path, payload, method } = args;
        window.__qaCalls.push({ path, payload, method });
        if (path === '/projects') return [project, { ...project, id: 'second', name: '第二个故事' }];
        if (path === '/project' || path === '/project/changes') return structuredClone(data);
        if (path === '/media/list') return { items: [image], total: 1 };
        if (path === '/media/thumbnail') return { path: '/spielberg-logo-s.png' };
        if (path === '/media/usage') return { items: [] };
        if (path === '/tasks') return { items: payload.status && payload.status !== 'all' ? [] : [{ id: 1, project_id: project.id, project_name: project.name, status: 'failed', operation: 'image', prompt: '雨夜长街镜头。'.repeat(60), error: '服务暂时不可用。'.repeat(50), created_at: '1793700000', updated_at: '1793700000' }], has_more: false };
        if (path === '/app/settings/load') return { projects_directory: '/fixture/projects' };
        if (path === '/skills/list') return { items: [], directory: '/fixture/skills' };
        if (path === '/screenplays' || path === '/editor/projects') return [];
        if (path === '/scripts/load') return null;
        if (path === '/prompts' || path === '/prompts/update') {
          if (window.__qaDelaySave) await new Promise(resolve => setTimeout(resolve, 250));
          if (window.__qaFailSave) throw new Error('模拟保存失败，请稍后重试');
          const prompt = { ...payload, id: payload.id || data.prompts.length + 1 };
          data.prompts = [...data.prompts.filter(item => item.id !== prompt.id), prompt];
          return prompt;
        }
        return { ok: true };
      } };
    });
    await require('./http-fixture.cjs')(page);
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
    await page.locator('.creation-desk').waitFor();
    const nav = async name => {
      if (page.viewportSize().width <= 600) await page.getByRole('button', { name: '切换导航', exact: true }).click();
      if (name === '最近项目') await page.locator('.project-switch').click();
      else if (name === '设置') await page.getByRole('button', { name, exact: true }).click();
      else await page.locator('.nav .arco-menu-item').filter({ hasText: name }).click();
    };
    const checkOverflow = async name => {
      const result = await page.locator('.content').evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
      assert(result.scroll <= result.client + 1, `${name}: content overflows ${JSON.stringify(result)}`);
      const root = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert(root.scroll <= root.width + 1, `${name}: viewport overflows`);
    };

    // Cancelling a new draft must not create a persisted blank Prompt.
    await nav('Prompt 库');
    await page.getByRole('button', { name: '新建 Prompt', exact: true }).click();
    assert(await page.getByRole('button', { name: '保存 Prompt', exact: true }).isDisabled());
    await page.locator('.arco-modal').getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__qaCalls.filter(call => call.path === '/prompts').length), 0);
    await page.getByLabel('搜索 Prompt', { exact: true }).fill('雨夜');
    assert.equal(await page.locator('.prompt-card').count(), 1);
    await page.getByLabel('搜索 Prompt', { exact: true }).fill('不存在的关键词');
    await page.getByText('没有找到匹配的 Prompt', { exact: true }).waitFor();
    await page.locator('.empty-state').getByRole('button', { name: '清除筛选', exact: true }).click();
    assert.equal(await page.getByLabel('搜索 Prompt', { exact: true }).inputValue(), '');

    await page.getByRole('button', { name: '新建 Prompt', exact: true }).click();
    await page.getByLabel('Prompt 名称', { exact: true }).fill('  新的镜头提示词  ');
    await page.getByLabel('Prompt 内容', { exact: true }).fill('保留草稿，保存失败时可继续编辑。');
    await page.evaluate(() => { window.__qaFailSave = true; window.__qaDelaySave = true; });
    await page.getByRole('button', { name: '保存 Prompt', exact: true }).click();
    await page.locator('.prompt-save-error').waitFor();
    assert.equal(await page.getByLabel('Prompt 内容', { exact: true }).inputValue(), '保留草稿，保存失败时可继续编辑。');
    await page.evaluate(() => { window.__qaFailSave = false; });
    await page.getByRole('button', { name: '保存 Prompt', exact: true }).click();
    await page.locator('.arco-modal').waitFor({ state: 'hidden' });
    await page.getByLabel('搜索 Prompt', { exact: true }).fill('新的镜头提示词');
    await page.locator('.prompt-card').getByText('新的镜头提示词', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__qaCalls.filter(call => call.path === '/prompts').length), 2);

    // Main pages, long content, both themes, and desktop/tablet/phone sizes.
    const checks = [];
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.locator('.theme-toggle').click();
      for (const width of [1440, 1024, 768, 390, 320]) {
        await page.setViewportSize({ width, height: width >= 768 ? 900 : 760 });
        for (const name of ['工作台', '剧集', '素材库', '资产库', '后台任务', 'Prompt 库', '最近项目', '设置']) {
          await nav(name);
          await page.locator('.page-loading').waitFor({ state: 'hidden' });
          if (name === '后台任务') await page.locator('.task-list[aria-busy="false"] .task-card').waitFor();
          if (name === '素材库') await page.locator('.asset-library[aria-busy="false"] .library-card').waitFor();
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await checkOverflow(`${theme}/${width}/${name}`);
          checks.push({ theme, width, name });
          if (width === 1440 || width === 390) await page.screenshot({ path: `${output}/${theme}-${width}-${name}.png`, animations: 'disabled' });
        }
      }
    }

    // The phone drawer owns focus, closes on Escape, and resets on desktop resize.
    await page.setViewportSize({ width: 390, height: 760 });
    await page.getByRole('button', { name: '切换导航', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.app-main').hasAttribute('inert'));
    assert(await page.getByRole('dialog', { name: '工作室导航' }).isVisible());
    await page.screenshot({ path: `${output}/mobile-navigation.png` });
    await page.getByRole('button', { name: '设置', exact: true }).focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '关闭导航');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '设置');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.app-main').hasAttribute('inert'));
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '切换导航');
    await page.getByRole('button', { name: '切换导航', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('.mobile-nav-backdrop').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.app-main').getAttribute('inert'), null);

    // An unsaved-edit confirmation must own focus after leaving the phone drawer.
    await page.setViewportSize({ width: 390, height: 760 });
    await nav('设置');
    await page.getByRole('tab', { name: /^图片生成/ }).click();
    await page.getByLabel('图片渠道名称', { exact: true }).fill('尚未保存的渠道');
    await page.getByRole('button', { name: '切换导航', exact: true }).click();
    await page.locator('.mobile-project-actions').getByRole('button', { name: '新建项目', exact: true }).click();
    await page.getByText('放弃未保存的修改？', { exact: true }).waitFor();
    await page.locator('.mobile-nav-backdrop').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '继续编辑', exact: true }).focus();
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => !!document.activeElement.closest('.arco-modal')), 'Confirmation must retain keyboard focus');
    await page.getByRole('button', { name: '继续编辑', exact: true }).click();
    await page.getByLabel('图片渠道名称', { exact: true }).fill('图像创作');
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await page.getByRole('button', { name: '保存配置', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.settings-pending-dot'));

    // A long Prompt editor must leave the footer in view on a short phone screen.
    await page.setViewportSize({ width: 390, height: 568 });
    await nav('Prompt 库');
    await page.getByRole('button', { name: '新建 Prompt', exact: true }).click();
    await page.getByLabel('Prompt 内容', { exact: true }).fill('很长的镜头描述\n'.repeat(100));
    const bounds = await page.locator('.prompt-editor-modal').boundingBox();
    assert(bounds.y >= 0 && bounds.y + bounds.height <= 569, 'Prompt modal exceeds phone viewport');
    await page.screenshot({ path: `${output}/mobile-prompt-editor.png` });
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${output}/report.json`, JSON.stringify({ checks, errors }, null, 2));
    console.log(`Passed ${checks.length} page/theme/viewport checks; Prompt drafts, failure/retry, filtering, mobile focus and resize behavior. Screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
