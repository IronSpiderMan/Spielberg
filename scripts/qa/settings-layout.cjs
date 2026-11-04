// Isolated settings fixtures; never reads a real project or contacts a model service.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const screenshots = '/tmp/spielberg-settings';
fs.mkdirSync(screenshots, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const project = { id: 'qa-settings-layout', name: '设置布局验证', path: '/fixture', updated_at: '1' };
      const channels = Array.from({ length: 24 }, (_, index) => ({
        id: `channel-${index}`, name: index === 0 ? '主力创作渠道' : `创作渠道 ${index + 1}`,
        provider: 'openai', base_url: `https://fixture-${index}.example/v1`, api_key: `fixture-key-${index}`,
        models: Array.from({ length: 16 }, (_, model) => ({ id: `model-${index}-${model}`, name: `创作模型 ${model + 1}`, profile: 'openai-chat' })),
        default_model_id: `model-${index}-0`,
      }));
      const data = { project, assets: [], episodes: [], prompts: [], media: [], settings: { llm: { channels, default_channel_id: channels[0].id } } };
      window.__qaCalls = [];
      window.__qaFailDirectoryLoad = true;
      const original = window.fetch.bind(window);
      window.fetch = async (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (!url.pathname.startsWith('/api/v1/')) return original(input, init);
        let path = url.pathname.slice('/api/v1'.length);
        if (path.startsWith('/actions/')) path = path.slice('/actions'.length);
        const payload = init.body ? JSON.parse(init.body) : {};
        window.__qaCalls.push({ path, payload });
        let result = null;
        if (path === '/projects') result = [project];
        if (path === '/project' || path === '/project/changes') result = structuredClone(data);
        if (path === '/tasks') result = { items: [], has_more: false };
        if (path === '/app/settings/load') {
          if (window.__qaFailDirectoryLoad) return new Response(JSON.stringify({ error: '模拟路径读取失败' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
          result = { projects_directory: '/fixture/projects' };
        }
        if (path === '/app/settings/save') {
          if (window.__qaFailDirectorySave) return new Response(JSON.stringify({ error: '模拟路径保存失败' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
          result = { projects_directory: payload.projects_directory };
        }
        if (path === '/skills/list') result = { items: [], directory: '/fixture/skills' };
        if (path === '/settings') {
          if (window.__qaFailSave) return new Response(JSON.stringify({ error: '模拟保存失败' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
          data.settings = structuredClone(payload.settings);
          result = { ok: true };
        }
        return new Response(JSON.stringify({ data: result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    });
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const settings = page.locator('.studio-settings-page');
    const active = () => settings.locator('.studio-settings-panel:visible');
    const tab = name => settings.getByRole('tab', { name: new RegExp(`^${name}`) });
    const options = () => active().locator('.settings-channel-option');
    const save = () => settings.getByRole('button', { name: '保存配置', exact: true });
    await page.getByRole('heading', { name: '统一渠道配置', exact: true }).waitFor();
    assert.equal(await active().count(), 1);
    assert.equal(await options().count(), 24);
    assert.equal(await active().locator('.generation-channel-card').count(), 1);
    assert.equal(await active().locator('.generation-channel-model').count(), 16);
    assert.equal(await active().getByLabel('LLM模型 ID', { exact: true }).count(), 0, 'Models start collapsed');
    await page.screenshot({ path: `${screenshots}/desktop.png`, animations: 'disabled' });

    // A failed directory load has a persistent explanation and an enabled retry outside the form.
    await tab('项目存储').click();
    await active().getByRole('alert').getByText('无法读取项目存储路径', { exact: true }).waitFor();
    assert(await active().getByLabel('项目存储路径', { exact: true }).isDisabled());
    await page.evaluate(() => { window.__qaFailDirectoryLoad = false; });
    await active().getByRole('button', { name: '重新加载', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('input[aria-label="项目存储路径"]').value === '/fixture/projects');
    assert.equal(await active().getByRole('alert').count(), 0);
    await tab('文本与推理').click();

    // Both lists can grow while the category navigation and save action stay put.
    const list = active().locator('.settings-channel-list');
    const editor = active().locator('.settings-channel-editor-scroll');
    assert(await list.evaluate(element => element.scrollHeight > element.clientHeight));
    assert(await editor.evaluate(element => element.scrollHeight > element.clientHeight));
    await editor.evaluate(element => element.scrollTop = element.scrollHeight);
    assert(await tab('文本与推理').isVisible());
    const unchanged = await page.locator('.content').evaluate(element => element.scrollTop);
    assert.equal(unchanged, 0, 'The outer page does not scroll');
    await editor.evaluate(element => element.scrollTop = 0);

    // Search also matches model IDs, and switching channels keeps draft edits.
    await active().getByLabel('搜索LLM渠道', { exact: true }).fill('model-19-8');
    assert.equal(await options().count(), 1);
    await options().first().click();
    assert.equal(await active().getByLabel('LLM渠道名称', { exact: true }).inputValue(), '创作渠道 20');
    await active().getByLabel('LLM渠道名称', { exact: true }).fill('修改后的渠道');
    await active().getByLabel('LLM渠道 API Key', { exact: true }).fill('fixture-edited-key');
    await tab('图片生成').click();
    await active().getByRole('button', { name: '添加图片渠道', exact: true }).click();
    await active().getByLabel('图片渠道名称', { exact: true }).fill('新增图片服务');
    await tab('文本与推理').click();
    assert.equal(await active().getByLabel('LLM渠道名称', { exact: true }).inputValue(), '修改后的渠道');
    assert.equal(await active().getByLabel('LLM渠道 API Key', { exact: true }).inputValue(), 'fixture-edited-key');
    assert.equal(await settings.locator('.settings-pending-dot').count(), 2);
    await active().getByLabel('搜索LLM渠道', { exact: true }).fill('');

    // One model editor at a time; changing the default model ID preserves it.
    await active().getByLabel('搜索LLM模型', { exact: true }).fill('model-19-0');
    assert.equal(await active().locator('.generation-channel-model').count(), 1);
    await active().getByRole('button', { name: '编辑模型 创作模型 1', exact: true }).click();
    await active().getByLabel('LLM模型 ID', { exact: true }).fill('model-19-0-renamed');
    await active().getByLabel('搜索LLM模型', { exact: true }).fill('');
    await active().getByRole('button', { name: '编辑模型 创作模型 2', exact: true }).click();
    assert.equal(await active().locator('.settings-model-editor').count(), 1);
    await active().getByRole('button', { name: '编辑模型 创作模型 2', exact: true }).click();
    await active().locator('.generation-channel-heading').getByRole('button', { name: '设为默认', exact: true }).click();

    // An unsuccessful save keeps all drafts, then retry sends every category.
    await page.evaluate(() => { window.__qaFailSave = true; });
    await save().click();
    await page.getByText('Error: 模拟保存失败', { exact: true }).waitFor();
    assert(await settings.getByRole('alert').getByText('配置未能保存，修改已保留', { exact: true }).isVisible());
    assert(await save().isEnabled());
    assert.equal(await active().getByLabel('LLM渠道名称', { exact: true }).inputValue(), '修改后的渠道');
    await page.evaluate(() => { window.__qaFailSave = false; });
    await save().click();
    await page.getByText('接口配置已保存', { exact: true }).waitFor();
    assert.equal(await settings.getByRole('alert').count(), 0, 'A successful retry clears the persistent failure');
    const saved = await page.evaluate(() => window.__qaCalls.filter(call => call.path === '/settings').at(-1).payload.settings);
    assert.equal(saved.llm.channels.length, 24);
    assert.equal(saved.llm.channels[19].default_model_id, 'model-19-0-renamed');
    assert.equal(saved.llm.channels[19].api_key, 'fixture-edited-key');
    assert.equal(saved.llm.default_channel_id, 'channel-19');
    assert.equal(saved.image.channels[0].name, '新增图片服务');
    assert.equal(await settings.locator('.settings-pending-dot').count(), 0);

    // Deleting the default channel selects a remaining channel and updates the default.
    await active().getByRole('button', { name: '删除渠道 修改后的渠道', exact: true }).click();
    await page.locator('.arco-popconfirm').getByRole('button', { name: /确定|确认/ }).click();
    assert.equal(await options().count(), 23);
    assert.equal(await active().locator('.generation-channel-card').count(), 1);
    await save().click();
    await page.getByText('接口配置已保存', { exact: true }).last().waitFor();
    const afterDelete = await page.evaluate(() => window.__qaCalls.filter(call => call.path === '/settings').at(-1).payload.settings);
    assert.equal(afterDelete.llm.default_channel_id, 'channel-0');

    // Shared settings keep their own save behavior and input drafts across tabs.
    await tab('项目存储').click();
    await active().getByLabel('项目存储路径', { exact: true }).fill('/fixture/new-projects');
    assert.equal(await settings.locator('.settings-save-state').getAttribute('data-dirty'), 'false', 'Storage drafts do not mark channel configuration dirty');
    assert.equal(await active().locator('.settings-directory-state').getAttribute('data-dirty'), 'true');
    await tab('Skills 技能').click();
    await active().getByLabel('GitHub Skill 链接', { exact: true }).fill('https://github.com/fixture/skill');
    await tab('项目存储').click();
    assert.equal(await active().getByLabel('项目存储路径', { exact: true }).inputValue(), '/fixture/new-projects');
    await page.evaluate(() => { window.__qaFailDirectorySave = true; });
    await active().getByRole('button', { name: '保存项目路径', exact: true }).click();
    await active().getByRole('alert').getByText('项目路径未能保存', { exact: true }).waitFor();
    assert.equal(await active().getByLabel('项目存储路径', { exact: true }).inputValue(), '/fixture/new-projects');
    await page.evaluate(() => { window.__qaFailDirectorySave = false; });
    await active().getByRole('button', { name: '保存项目路径', exact: true }).click();
    await page.getByText('项目存储路径已保存', { exact: true }).waitFor();
    await tab('Skills 技能').click();
    assert.equal(await active().getByLabel('GitHub Skill 链接', { exact: true }).inputValue(), 'https://github.com/fixture/skill');
    await active().getByLabel('GitHub Skill 链接', { exact: true }).fill('');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => {
      const tab = document.querySelector('.settings-category-tabs [aria-selected="true"]').getBoundingClientRect();
      const list = document.querySelector('.settings-category-tabs').getBoundingClientRect();
      return tab.left >= list.left - 1 && tab.right <= list.right + 1;
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await tab('文本与推理').click();
    await options().filter({ hasText: '主力创作渠道' }).click();

    for (const [width, height] of [[1440, 900], [1280, 720], [1024, 768], [768, 900], [390, 844]]) {
      await page.setViewportSize({ width, height });
      for (const name of ['文本与推理', '图片生成', '视频生成', '语音合成', 'Skills 技能', '项目存储']) {
        await tab(name).click();
        assert.equal(await active().count(), 1);
        assert(await settings.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `Settings overflow at ${width}: ${name}`);
        assert(await active().evaluate(element => element.scrollWidth <= element.clientWidth + 1), `Panel overflow at ${width}: ${name}`);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Document overflow at ${width}`);
        const bounds = await settings.getByRole('button', { name: '保存配置', exact: true }).boundingBox();
        assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= height, `Save action offscreen at ${width}`);
        if (width === 390) {
          const title = await settings.getByRole('heading', { name: '工作室设置', exact: true }).boundingBox();
          assert(Math.abs(title.y - bounds.y) < 12, 'Narrow header keeps title and save action on one row');
        }
      }
      await tab('文本与推理').click();
      await active().getByRole('button', { name: '编辑模型 创作模型 1', exact: true }).click();
      await active().getByLabel('LLM模型名称', { exact: true }).scrollIntoViewIfNeeded();
      assert(await active().evaluate(element => element.scrollWidth <= element.clientWidth + 1), `Expanded model overflow at ${width}`);
      await page.screenshot({ path: `${screenshots}/width-${width}.png`, animations: 'disabled' });
      await active().getByRole('button', { name: '编辑模型 创作模型 1', exact: true }).click();
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await tab('文本与推理').focus();
    await page.keyboard.press('End');
    assert.equal(await tab('项目存储').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Home');
    assert.equal(await tab('文本与推理').getAttribute('aria-selected'), 'true');

    // The channel list is one tab stop and reveals keyboard selection in either layout.
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await active().locator('.settings-channel-option[tabindex="0"]').count(), 1);
      await options().first().focus();
      await page.keyboard.press('End');
      assert.equal(await options().last().getAttribute('aria-pressed'), 'true');
      await page.waitForFunction(() => {
        const list = document.querySelector('.studio-settings-panel:not([hidden]) .settings-channel-list');
        const selected = list.querySelector('[aria-pressed="true"]').getBoundingClientRect();
        const bounds = list.getBoundingClientRect();
        return selected.left >= bounds.left - 1 && selected.right <= bounds.right + 1 && selected.top >= bounds.top - 1 && selected.bottom <= bounds.bottom + 1;
      });
      await page.keyboard.press('Home');
      assert.equal(await options().first().getAttribute('aria-pressed'), 'true');
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await active().getByLabel('搜索LLM模型', { exact: true }).fill('no-such-model');
    await active().getByRole('button', { name: '清空搜索', exact: true }).click();
    assert.equal(await active().getByLabel('搜索LLM模型', { exact: true }).inputValue(), '');
    await active().getByRole('button', { name: '添加模型', exact: true }).click();
    await page.getByRole('menuitem', { name: '添加自定义模型', exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'LLM模型 ID');
    const addedInput = await active().getByLabel('LLM模型 ID', { exact: true }).boundingBox();
    assert(addedInput && addedInput.y >= 0 && addedInput.y + addedInput.height <= 900, 'New model editor is visible and ready for typing');
    await save().click();
    await page.getByText('接口配置已保存', { exact: true }).last().waitFor();
    await active().locator('.settings-channel-editor-scroll').evaluate(element => element.scrollTop = 0);
    await page.getByRole('button', { name: '切换到暗夜模式', exact: true }).click();
    await page.screenshot({ path: `${screenshots}/dark.png`, animations: 'disabled' });
    assert.deepEqual(errors, []);
    console.log('PASS: 24 channels × 16 models, drafts, model accordion/search/add focus, defaults/deletion, persistent save failure/retry, separate storage status, category/channel keyboard navigation, five viewport sizes and dark mode');
  } catch (error) {
    await page.screenshot({ path: `${screenshots}/failure.png`, animations: 'disabled' }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
