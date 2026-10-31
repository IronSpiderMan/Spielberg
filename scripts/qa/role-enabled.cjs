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
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const project = {id: 'qa', name: '角色启用测试', path: '/fixture', updated_at: '刚刚'};
      const image = {id: 1, name: '正面.png', path: '/spielberg-logo-s.png', kind: 'image', created_at: '0'};
      const data = JSON.parse(localStorage.getItem('qa-role-enabled') || 'null') || {project, media: [image], assets: [
        {id: 1, name: '主角', description: '角色描述', images: [image], design_media_id: 1},
        {id: 2, name: '配角', description: '', images: [], design_media_id: null, enabled: true},
        {id: 3, name: '停用角色', description: '', images: [], design_media_id: null, enabled: false},
      ], episodes: [], prompts: [], settings: {}};
      window.__qaRoleUpdates = [];
      window.__qaFailRoleUpdate = false;
      window.__TAURI_INTERNALS__ = {invoke: async (command, args) => {
        const {path, payload} = args;
        if (path === '/projects') return [project];
        if (path === '/project' || path === '/project/changes') return structuredClone(data);
        if (path === '/tasks') return {items: [], has_more: false};
        if (path === '/assets/update') {
          window.__qaRoleUpdates.push(structuredClone(payload));
          if (window.__qaFailRoleUpdate) throw Error('测试保存失败');
          assertEnabled(payload);
          Object.assign(data.assets.find(role => role.id === payload.id), payload);
          localStorage.setItem('qa-role-enabled', JSON.stringify(data));
          return {ok: true};
        }
        return null;
      }};
      function assertEnabled(payload) {
        if (typeof payload.enabled !== 'boolean') throw Error('保存资产时必须传递 enabled 布尔值');
      }
    });
    await require('./http-fixture.cjs')(page);
    const roles = () => page.getByRole('menuitem', {name: '资产库', exact: true}).click();
    const edit = () => page.locator('.role-card').filter({hasText: '主角'}).getByRole('button', {name: '设定', exact: true}).click();
    const drawer = page.locator('.arco-drawer:visible');
    const toggle = drawer.getByRole('switch', {name: '启用资产', exact: true});
    const save = async () => {
      await drawer.getByRole('button', {name: '保存资产', exact: true}).click();
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
    const card = name => page.locator('.role-card').filter({has: page.getByRole('heading', {name, exact: true})});
    const showDisabled = page.getByRole('checkbox', {name: '显示已禁用资产', exact: true});
    const setShowDisabled = async checked => {
      if (await showDisabled.isChecked() !== checked) await page.locator('label.arco-checkbox').filter({hasText: '显示已禁用资产'}).click();
      assert.equal(await showDisabled.isChecked(), checked);
    };
    const confirmation = page.locator('.arco-modal:visible').filter({hasText: '确认禁用'});
    const confirm = async () => {
      await confirmation.getByRole('button', {name: '确认禁用', exact: true}).click();
      await confirmation.waitFor({state: 'hidden'});
    };
    const updateCount = () => page.evaluate(() => window.__qaRoleUpdates.length);
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:1420');
    await roles();
    assert.equal(await showDisabled.isChecked(), false);
    assert.equal(await card('停用角色').count(), 0);
    await verifyMentions(true);

    // Cancelling and failed saves must leave the role visible and enabled.
    await card('主角').getByRole('button', {name: '禁用', exact: true}).click();
    await confirmation.waitFor();
    assert.equal(await updateCount(), 0);
    await confirmation.getByRole('button', {name: '取消', exact: true}).click();
    await confirmation.waitFor({state: 'hidden'});
    assert.equal(await card('主角').count(), 1);
    assert.equal(await updateCount(), 0);
    await page.evaluate(() => { window.__qaFailRoleUpdate = true; });
    await card('主角').getByRole('button', {name: '禁用', exact: true}).click();
    await confirm();
    await page.getByText('Error: 测试保存失败', {exact: true}).waitFor();
    assert.equal(await card('主角').count(), 1);
    await page.evaluate(() => { window.__qaFailRoleUpdate = false; });

    await card('主角').getByRole('button', {name: '禁用', exact: true}).click();
    await page.screenshot({path: path.join(screenshots, 'disable-confirmation.png'), fullPage: true, animations: 'disabled'});
    await confirm();
    await card('主角').waitFor({state: 'hidden'});
    await verifyMentions(false);
    await setShowDisabled(true);
    await card('主角').locator('.role-kind').filter({hasText: '已禁用'}).waitFor();
    assert.equal(await card('停用角色').count(), 1);
    await page.screenshot({path: path.join(screenshots, 'show-disabled-roles.png'), fullPage: true, animations: 'disabled'});
    await card('主角').getByRole('button', {name: '启用', exact: true}).click();
    await card('主角').getByRole('button', {name: '禁用', exact: true}).waitFor();
    await verifyMentions(true);
    await setShowDisabled(false);

    // Disabling through the editor also requires confirmation before saving.
    await edit();
    await drawer.locator('[role="switch"][aria-checked="true"]').waitFor();
    await toggle.click();
    const countBeforeEditor = await updateCount();
    await drawer.getByRole('button', {name: '保存资产', exact: true}).click();
    await confirmation.getByRole('button', {name: '取消', exact: true}).click();
    await confirmation.waitFor({state: 'hidden'});
    assert(await drawer.isVisible());
    assert.equal(await updateCount(), countBeforeEditor);
    await drawer.getByRole('button', {name: '保存资产', exact: true}).click();
    await confirm();
    await drawer.waitFor({state: 'hidden'});
    await card('主角').waitFor({state: 'hidden'});
    await verifyMentions(false);
    await setShowDisabled(true);
    await page.getByRole('button', {name: '查看主角的资产详情', exact: true}).click();
    await page.locator('.role-detail-meta').getByText('已禁用', {exact: true}).waitFor();
    await page.reload();
    await roles();
    assert.equal(await showDisabled.isChecked(), false);
    assert.equal(await card('主角').count(), 0);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('qa-role-enabled')).assets[0].enabled), false);
    await setShowDisabled(true);
    await edit();
    await drawer.locator('[role="switch"][aria-checked="false"]').waitFor();
    await page.setViewportSize({width: 390, height: 1000});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({path: path.join(screenshots, 'disabled-editor-mobile.png'), fullPage: true, animations: 'disabled'});
    await toggle.click();
    await save();
    await page.setViewportSize({width: 1440, height: 1000});
    await verifyMentions(true);
    await setShowDisabled(false);
    for (const name of ['主角', '配角']) {
      await card(name).getByRole('button', {name: '禁用', exact: true}).click();
      await confirm();
      await card(name).waitFor({state: 'hidden'});
    }
    await page.getByText('当前没有启用的资产，可勾选“显示已禁用资产”查看并重新启用。', {exact: true}).waitFor();
    await page.setViewportSize({width: 390, height: 1000});
    await page.screenshot({path: path.join(screenshots, 'hidden-roles-mobile.png'), fullPage: true, animations: 'disabled'});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await setShowDisabled(true);
    assert.equal(await page.locator('.role-card:not(.role-create)').count(), 3);
    await page.screenshot({path: path.join(screenshots, 'show-disabled-mobile.png'), fullPage: true, animations: 'disabled'});
    assert.deepEqual(errors, []);
    console.log('PASS: default hides disabled roles; card disable confirmation/cancel/retry; editor disable confirmation/cancel; show disabled and reenable; @ suggestions follow status; reload resets filter and preserves status; all-disabled hint; mobile layout');
    console.log('Screenshots: ' + screenshots);
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
