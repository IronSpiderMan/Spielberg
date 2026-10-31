// Isolated UI fixture: no real projects or generation services are accessed.
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({headless: true});
  const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'spielberg-role-enabled-'));
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const project = {id: 'qa', name: '角色启用测试', path: '/fixture', updated_at: '刚刚'};
      const image = {id: 1, name: '正面.png', path: '/spielberg-logo-s.png', kind: 'image', created_at: '0'};
      const data = JSON.parse(localStorage.getItem('qa-role-enabled') || 'null') || {project, media: [image], roles: [
        {id: 1, name: '主角', description: '角色描述', images: [image], design_media_id: 1},
        {id: 2, name: '配角', description: '', images: [], design_media_id: null, enabled: true},
      ], episodes: [], prompts: [], settings: {}};
      window.__TAURI_INTERNALS__ = {invoke: async (command, args) => {
        const {path, payload} = args;
        if (path === '/projects') return [project];
        if (path === '/project' || path === '/project/changes') return structuredClone(data);
        if (path === '/tasks') return {items: [], has_more: false};
        if (path === '/roles/update') {
          assertEnabled(payload);
          Object.assign(data.roles.find(role => role.id === payload.id), payload);
          localStorage.setItem('qa-role-enabled', JSON.stringify(data));
          return {ok: true};
        }
        return null;
      }};
      function assertEnabled(payload) {
        if (typeof payload.enabled !== 'boolean') throw Error('保存角色时必须传递 enabled 布尔值');
      }
    });
    await require('./http-fixture.cjs')(page);
    const roles = () => page.getByRole('menuitem', {name: '角色设定', exact: true}).click();
    const edit = () => page.locator('.role-card').filter({hasText: '主角'}).getByRole('button', {name: '设定', exact: true}).click();
    const drawer = page.locator('.arco-drawer:visible');
    const toggle = drawer.getByRole('switch', {name: '启用角色', exact: true});
    const save = async () => {
      await drawer.getByRole('button', {name: '保存角色', exact: true}).click();
      await drawer.waitFor({state: 'hidden'});
    };
    const verifyMentions = async enabled => {
      await page.getByRole('button', {name: '打开生图模态框', exact: true}).click();
      const modal = page.locator('.image-generator-modal:visible');
      await modal.getByRole('textbox', {name: '画面描述', exact: true}).fill('@');
      await modal.getByRole('option').filter({hasText: '@配角'}).waitFor();
      assert.equal(await modal.getByRole('option').filter({hasText: '@主角'}).count(), enabled ? 2 : 0);
      await modal.locator('.arco-modal-close-icon').click();
      await modal.waitFor({state: 'hidden'});
    };
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
    await roles();
    await verifyMentions(true);
    await edit();
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    await toggle.click();
    await drawer.locator('[role="switch"][aria-checked="false"]').waitFor();
    await page.screenshot({path: path.join(screenshots, 'disabled-editor.png'), fullPage: true, animations: 'disabled'});
    await save();
    await page.locator('.role-card').filter({hasText: '主角'}).getByText('已禁用', {exact: true}).waitFor();
    await verifyMentions(false);
    await page.getByRole('button', {name: '查看主角的角色详情', exact: true}).click();
    await page.locator('.role-detail-meta').getByText('已禁用', {exact: true}).waitFor();
    await page.reload();
    await roles();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('qa-role-enabled')).roles[0].enabled), false);
    await edit();
    await drawer.locator('[role="switch"][aria-checked="false"]').waitFor();
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    await page.setViewportSize({width: 390, height: 1000});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({path: path.join(screenshots, 'disabled-editor-mobile.png'), fullPage: true, animations: 'disabled'});
    await toggle.click();
    await save();
    await page.setViewportSize({width: 1440, height: 1000});
    assert.equal(await page.locator('.role-card').filter({hasText: '主角'}).getByText('已禁用', {exact: true}).count(), 0);
    await verifyMentions(true);
    assert.deepEqual(errors, []);
    console.log('PASS: default enabled; disabled state saved through HTTP; role and named-image @ suggestions hidden; disabled status shown; reload preserves state; reenable restores mentions; mobile layout');
    console.log('Screenshots: ' + screenshots);
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
