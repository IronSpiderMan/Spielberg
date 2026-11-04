// Real HTTP/SQLite and browser regression; all project data is disposable.
// Run after npm run build && cargo build --manifest-path backend/Cargo.toml.
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spielberg-asset-relations-'));
  const binary = process.env.SPIELBERG_TEST_BINARY || path.resolve(__dirname, '../../backend/target/debug/spielberg-backend');
  const server = spawn(binary, [], {
    env: { ...process.env, SPIELBERG_DATA_DIR: path.join(temp, 'data'), SPIELBERG_BIND: '127.0.0.1:0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let browser;
  let page;
  let serverOutput = '';
  server.stderr.on('data', chunk => { serverOutput += String(chunk); });
  try {
    const url = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Backend startup timed out: ' + serverOutput)), 15000);
      server.stdout.on('data', chunk => {
        serverOutput += String(chunk);
        const match = serverOutput.match(/Spielberg listening at (http:\/\/\S+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
      server.on('error', error => { clearTimeout(timeout); reject(error); });
      server.on('exit', code => { clearTimeout(timeout); reject(Error(`Backend exited ${code}: ${serverOutput}`)); });
    });
    const api = async (method, suffix, body, expected = method === 'POST' ? 201 : 200) => {
      const response = await fetch(url + '/api/v1' + suffix, {
        method,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      const result = await response.json();
      assert.equal(response.status, expected, `${method} ${suffix}: ${JSON.stringify(result)}`);
      assert.ok(expected >= 400 ? 'error' in result : 'data' in result, JSON.stringify(result));
      return expected >= 400 ? result : result.data;
    };
    const project = await api('POST', '/projects', { name: '资产关系图验证' });
    const scope = '/projects/' + project.id;
    const createAsset = (name, category, enabled = true) => api('POST', scope + '/assets', { name, category, enabled });
    const hero = await createAsset('魏来', 'person');
    const sister = await createAsset('魏宁', 'person');
    const home = await createAsset('魏来老家', 'location');
    const disabled = await createAsset('旧仓库', 'location', false);
    const relationsPath = scope + '/asset-relations';
    const graphPath = scope + '/asset-graph';
    assert.deepEqual(await api('GET', relationsPath), []);
    assert.deepEqual(await api('GET', graphPath), { positions: {}, revision: 0 });
    const hometown = await api('POST', relationsPath, {
      source_asset_id: home.id, target_asset_id: hero.id, label: '故乡', directed: true, description: '魏来从小长大的地方',
    });
    assert.equal(hometown.directed, true);
    const sibling = await api('POST', relationsPath, {
      source_asset_id: sister.id, target_asset_id: hero.id, label: 'API 兄妹',
    });
    assert.equal(sibling.source_asset_id, hero.id);
    assert.equal(sibling.target_asset_id, sister.id);
    assert.equal(sibling.directed, false);
    await api('POST', relationsPath, { source_asset_id: hero.id, target_asset_id: sister.id, label: 'API 兄妹' }, 409);
    await api('POST', relationsPath, { source_asset_id: hero.id, target_asset_id: hero.id, label: '自己' }, 400);
    await api('POST', relationsPath, { source_asset_id: hero.id, target_asset_id: 999999, label: '不存在' }, 404);
    await api('POST', relationsPath, { source_asset_id: hero.id, target_asset_id: sister.id, label: '   ' }, 400);
    await api('POST', relationsPath, { source_asset_id: hero.id, target_asset_id: sister.id, label: 'x'.repeat(81) }, 400);
    await api('POST', relationsPath, { source_asset_id: hero.id, target_asset_id: sister.id, label: '错误字段', extra: 'wrong' }, 400);
    const changed = await api('PATCH', relationsPath + '/' + sibling.id, { label: 'API 家人', description: '保留两端资产' });
    assert.equal(changed.source_asset_id, hero.id);
    assert.equal(changed.description, '保留两端资产');
    assert.equal((await api('GET', relationsPath + '/' + sibling.id)).label, 'API 家人');
    await api('DELETE', relationsPath + '/' + sibling.id);
    await api('GET', relationsPath + '/' + sibling.id, undefined, 404);

    const positions = {
      [hero.id]: { x: 80, y: 100 }, [sister.id]: { x: 420, y: 100 },
      [home.id]: { x: 80, y: 360 }, [disabled.id]: { x: 420, y: 360 },
    };
    const initialGraph = await api('PATCH', graphPath, { positions, revision: 0 });
    assert.equal(initialGraph.revision, 1);
    assert.deepEqual(initialGraph.positions, positions);
    await api('PATCH', graphPath, { positions: {}, revision: 0 }, 409);
    await api('PATCH', graphPath, { positions: { [hero.id]: { x: 'bad', y: 0 } }, revision: 1 }, 400);
    await api('PATCH', graphPath, { positions: { 999999: { x: 0, y: 0 } }, revision: 1 }, 404);
    const other = await api('POST', '/projects', { name: '关系隔离验证' });
    assert.deepEqual(await api('GET', '/projects/' + other.id + '/asset-relations'), []);
    assert.deepEqual(await api('GET', '/projects/' + other.id + '/asset-graph'), { positions: {}, revision: 0 });
    await api('POST', '/projects/' + other.id + '/asset-relations', { source_asset_id: hero.id, target_asset_id: sister.id, label: '跨项目' }, 404);
    await api('DELETE', '/projects/' + other.id);

    // The project database uses assets and has valid foreign-key references.
    const schema = JSON.parse(execFileSync('python3', ['-c', [
      'import json, sqlite3, sys',
      'c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True)',
      'print(json.dumps({"tables":[r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type=\'table\'")],"foreign_key_errors":c.execute("PRAGMA foreign_key_check").fetchall()}))',
    ].join('\n'), path.join(project.path, 'spielberg.sqlite')], { encoding: 'utf8' }));
    assert.ok(schema.tables.includes('assets'));
    assert.ok(schema.tables.includes('asset_relations'));
    assert.ok(!schema.tables.includes('roles'));
    assert.deepEqual(schema.foreign_key_errors, []);

    // Backups preserve relationship identities and graph positions without path remapping.
    const backup = await api('POST', scope + '/backup', { include_api_keys: false });
    const archive = await (await fetch(url + backup.url)).arrayBuffer();
    const restoredResponse = await fetch(url + '/api/v1/projects/restore-upload', { method: 'POST', body: archive });
    assert.equal(restoredResponse.status, 201);
    const restored = (await restoredResponse.json()).data;
    assert.deepEqual(await api('GET', '/projects/' + restored.id + '/asset-relations'), [hometown]);
    assert.deepEqual(await api('GET', '/projects/' + restored.id + '/asset-graph'), initialGraph);
    await api('DELETE', '/projects/' + restored.id);

    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15000);
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
    page.on('response', response => {
      if (response.url().includes('/api/') && response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
    });
    await page.addInitScript(pid => localStorage.setItem('spielberg-last-project', pid), project.id);
    const openGraph = async () => {
      await page.getByRole('menuitem', { name: '资产库', exact: true }).click();
      await page.getByRole('button', { name: '关系图', exact: true }).click();
      await page.getByRole('region', { name: '资产关系图', exact: true }).waitFor();
      await page.locator(`[data-asset-node="${hero.id}"]`).waitFor();
    };
    await page.goto(url);
    await openGraph();
    assert.equal(await page.locator('[data-asset-node]').count(), 3);
    await page.getByRole('button', { name: '适应画布', exact: true }).click();
    const zoomBefore = await page.locator('.asset-graph-view-controls > span').textContent();
    const canvas = await page.getByLabel('资产关系画布', { exact: true }).boundingBox();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await page.waitForFunction(before => document.querySelector('.asset-graph-view-controls > span').textContent !== before, zoomBefore);
    await page.getByRole('button', { name: '适应画布', exact: true }).click();
    await page.getByRole('button', { name: '连接 魏来', exact: true }).click();
    await page.getByRole('button', { name: '连接 魏宁', exact: true }).click();
    const modal = page.locator('.arco-modal:visible');
    await modal.getByLabel('关系名称', { exact: true }).fill('兄妹');
    await modal.getByLabel('关系说明', { exact: true }).fill('魏来是哥哥，魏宁是妹妹');
    await modal.getByRole('button', { name: '保存关系', exact: true }).click();
    await modal.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '编辑关系 兄妹', exact: true }).waitFor();
    const fromUi = (await api('GET', relationsPath)).find(relation => relation.label === '兄妹');
    assert.ok(fromUi);
    assert.equal(fromUi.source_asset_id, hero.id);
    assert.equal(fromUi.target_asset_id, sister.id);
    assert.equal(fromUi.description, '魏来是哥哥，魏宁是妹妹');
    await page.getByRole('button', { name: '编辑关系 兄妹', exact: true }).click();
    await modal.getByLabel('关系名称', { exact: true }).fill('兄妹（亲生）');
    await modal.getByRole('button', { name: '保存关系', exact: true }).click();
    await modal.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '编辑关系 兄妹（亲生）', exact: true }).waitFor();
    assert.equal((await api('GET', relationsPath + '/' + fromUi.id)).label, '兄妹（亲生）');

    // Drag a node, save, and reopen to confirm persisted coordinates.
    const beforeDrag = await api('GET', graphPath);
    const grip = page.locator(`[data-asset-node="${hero.id}"] .asset-graph-node-copy`);
    const box = await grip.boundingBox();
    assert.ok(box && box.width > 0);
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y + 75, { steps: 10 });
    await page.mouse.up();
    await Promise.all([
      page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith('/asset-graph') && response.status() === 200),
      page.getByRole('button', { name: /^保存布局/ }).click(),
    ]);
    const afterDrag = await api('GET', graphPath);
    assert.notDeepEqual(afterDrag.positions[hero.id], beforeDrag.positions[hero.id]);
    await page.reload();
    await openGraph();
    assert.deepEqual((await api('GET', graphPath)).positions, afterDrag.positions);
    await page.getByRole('button', { name: '编辑关系 兄妹（亲生）', exact: true }).waitFor();
    const disabledToggle = page.locator('label.arco-checkbox').filter({ hasText: '显示已禁用资产' });
    await disabledToggle.click();
    await page.locator(`[data-asset-node="${disabled.id}"]`).waitFor();
    assert.equal(await page.locator('[data-asset-node]').count(), 4);
    await disabledToggle.click();
    assert.equal(await page.locator('[data-asset-node]').count(), 3);
    await page.getByLabel('搜索关系图资产', { exact: true }).fill('魏宁');
    assert.equal(await page.locator('[data-asset-node]').count(), 1);
    await page.getByLabel('搜索关系图资产', { exact: true }).fill('');
    assert.equal(await page.locator('[data-asset-node]').count(), 3);
    assert.equal(await page.locator('.asset-graph-edge-line[marker-end]').count(), 1);
    await page.screenshot({ path: path.join(temp, 'relationships-desktop.png'), fullPage: true, animations: 'disabled' });

    // Delete a relationship through the graph, retaining the asset nodes.
    await page.getByRole('button', { name: '删除关系 兄妹（亲生）', exact: true }).click();
    const confirmation = page.locator('.arco-popconfirm:visible, .arco-modal:visible').last();
    await confirmation.getByRole('button', { name: /^(删除|确定|删除关系)$/ }).click();
    await page.getByRole('button', { name: '编辑关系 兄妹（亲生）', exact: true }).waitFor({ state: 'hidden' });
    assert.equal((await api('GET', relationsPath)).length, 1);
    assert.equal((await api('GET', scope + '/assets')).length, 4);
    await page.getByRole('button', { name: '切换到暗夜模式', exact: true }).click();
    await page.screenshot({ path: path.join(temp, 'relationships-dark.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '适应画布', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Graph must fit a phone viewport');
    await page.screenshot({ path: path.join(temp, 'relationships-mobile.png'), fullPage: true, animations: 'disabled' });
    assert.deepEqual(failures, []);

    // Deleting an asset cascades its relationship and removes its graph position.
    await api('DELETE', scope + '/assets/' + hero.id);
    assert.deepEqual(await api('GET', relationsPath), []);
    assert.ok(!(String(hero.id) in (await api('GET', graphPath)).positions));
    console.log('PASS: renamed assets schema, relationship CRUD and validation, isolation, graph revisions, backup/restore, UI connect/edit/delete, drag/layout persistence, disabled assets, dark/mobile rendering, asset deletion cascade');
    console.log('Screenshots: ' + temp);
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(temp, 'failure.png'), fullPage: true }).catch(() => {});
    console.error('QA artifacts: ' + temp);
    throw error;
  } finally {
    if (browser) await browser.close();
    if (server.pid && server.exitCode === null && server.signalCode === null) {
      const exited = new Promise(resolve => server.once('exit', resolve));
      server.kill('SIGTERM');
      await exited;
    }
    // Keep screenshots and server output for inspecting failures; project data stays isolated.
    fs.writeFileSync(path.join(temp, 'server.log'), serverOutput);
    fs.rmSync(path.join(temp, 'data'), { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
