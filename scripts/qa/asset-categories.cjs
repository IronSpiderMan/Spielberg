// Isolated UI fixtures: no real projects or generation services are accessed.
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({headless: true});
  const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'spielberg-asset-categories-'));
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const project = {id: 'qa', name: '资产分类测试', path: '/fixture', updated_at: '刚刚'};
      const image = {id: 1, name: '正面.png', path: '/spielberg-logo-s.png', kind: 'image', created_at: '0'};
      const data = JSON.parse(localStorage.getItem('qa-asset-categories') || 'null') || {project, media: [image], roles: [
        {id: 1, name: '原有角色', description: '原有描述', enabled: true, design_media_id: 1, images: [image]},
        {id: 2, name: '旧车站', description: '停用地点', category: 'location', enabled: false, design_media_id: null, images: []},
      ], episodes: [], prompts: [], settings: {}};
      const persist = () => localStorage.setItem('qa-asset-categories', JSON.stringify(data));
      window.__qaCategoryUpdates = [];
      window.__TAURI_INTERNALS__ = {invoke: async (command, args) => {
        const {path, payload} = args;
        if (path === '/projects') return [project];
        if (path === '/project' || path === '/project/changes') return structuredClone(data);
        if (path === '/tasks') return {items: [], has_more: false};
        if (path === '/media/list') return {items: data.media, total: data.media.length};
        if (path === '/roles') {
          const role = {id: Math.max(...data.roles.map(role => role.id)) + 1, name: payload.name, category: payload.category || 'person',
            description: '', enabled: true, images: [], design_media_id: null};
          data.roles.push(role); persist(); return structuredClone(role);
        }
        if (path === '/roles/update') {
          if (payload.category !== undefined) window.__qaCategoryUpdates.push(structuredClone(payload));
          Object.assign(data.roles.find(role => role.id === payload.id), payload); persist(); return {ok: true};
        }
        return null;
      }};
    });
    await require('./http-fixture.cjs')(page);
    const categories = ['人物', '地点', '物品', '生物', '载具', '其他'];
    const values = ['person', 'location', 'object', 'creature', 'vehicle', 'other'];
    const names = ['林秋月', '高三教室', '旧手机', '小狐狸', '校车', '其他参考'];
    const drawer = page.locator('.arco-drawer:visible');
    const card = name => page.locator('.role-card').filter({has: page.getByRole('heading', {name, exact: true})});
    const choose = async (label, value) => {
      await page.getByLabel(label, {exact: true}).click();
      await page.getByRole('option', {name: value, exact: true}).click();
    };
    const save = async () => {
      await drawer.getByRole('button', {name: '保存资产', exact: true}).click();
      await drawer.waitFor({state: 'hidden'});
    };
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
    await page.getByRole('menuitem', {name: '资产库', exact: true}).click();
    await page.getByRole('heading', {name: '资产库', exact: true}).waitFor();
    assert.equal(await card('原有角色').locator('.role-kind').textContent(), '人物');
    assert.equal(await card('旧车站').count(), 0);
    for (let i = 0; i < categories.length; i++) {
      // Creating within a category inherits the filter; every category can be saved.
      await choose('资产类别筛选', categories[i]);
      await page.getByRole('button', {name: '创建资产', exact: true}).first().click();
      await drawer.getByLabel('资产名称', {exact: true}).fill(names[i]);
      assert((await drawer.getByLabel('资产类别', {exact: true}).textContent()).includes(categories[i]));
      await drawer.getByLabel('资产描述', {exact: true}).fill(`${categories[i]}的外观与故事背景`);
      await save();
      assert.equal(await card(names[i]).locator('.role-kind').textContent(), categories[i]);
      const updates = await page.evaluate(() => window.__qaCategoryUpdates);
      assert.equal(updates.at(-1).category, values[i]);
    }
    await choose('资产类别筛选', '全部类别');
    assert.equal(await page.locator('.role-card:not(.role-create)').count(), 7);
    await page.screenshot({path: path.join(screenshots, 'all-categories.png'), fullPage: true, animations: 'disabled'});
    // Editing a subject keeps the same ID and name, updates its category, and survives reload.
    await card('旧手机').getByRole('button', {name: '设定', exact: true}).click();
    await choose('资产类别', '其他');
    await save();
    assert.equal(await card('旧手机').locator('.role-kind').textContent(), '其他');
    await page.reload();
    await page.getByRole('menuitem', {name: '资产库', exact: true}).click();
    await card('旧手机').locator('.role-kind').filter({hasText: '其他'}).waitFor();
    await page.getByRole('button', {name: '打开生图模态框', exact: true}).click();
    const modal = page.locator('.image-generator-modal:visible');
    await modal.getByRole('textbox', {name: '画面描述', exact: true}).fill('@');
    for (let i = 0; i < names.length; i++) {
      const option = modal.getByRole('option').filter({has: page.locator('b').filter({hasText: `@${names[i]}`})});
      await option.waitFor();
      assert((await option.locator('small').textContent()).includes(i === 2 ? '其他' : categories[i]));
    }
    assert.equal(await modal.getByRole('option').filter({hasText: '@旧车站'}).count(), 0);
    await modal.locator('.arco-modal-close-icon').click();
    await page.locator('label.arco-checkbox').filter({hasText: '显示已禁用资产'}).click();
    await card('旧车站').locator('.role-kind').filter({hasText: '地点 · 已禁用'}).waitFor();
    await page.getByRole('button', {name: '切换到暗夜模式', exact: true}).click();
    await page.screenshot({path: path.join(screenshots, 'categories-dark.png'), fullPage: true, animations: 'disabled'});
    await page.setViewportSize({width: 390, height: 1000});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({path: path.join(screenshots, 'categories-mobile.png'), fullPage: true, animations: 'disabled'});
    await page.setViewportSize({width: 1440, height: 1000});
    await page.getByRole('menuitem', {name: '素材库', exact: true}).click();
    await page.getByRole('heading', {name: '素材库', exact: true}).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: asset/media naming; legacy people; six categories and inherited creation; category persistence/editing; typed @ mentions; disabled categories; dark/mobile layout');
    console.log('Screenshots: ' + screenshots);
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
