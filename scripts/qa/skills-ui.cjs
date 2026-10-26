// Real browser + disposable HTTP backend. All Skills installs use local fixture files.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const playwrightPath = process.env.PLAYWRIGHT_PATH || [
  'playwright',
  path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'),
].find(candidate => { try { require.resolve(candidate); return true; } catch { return false; } });
assert(playwrightPath, 'Set PLAYWRIGHT_PATH to the installed Playwright package');
const { chromium } = require(playwrightPath);

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spielberg-skills-ui-'));
  const screenshots = path.join(temp, 'screenshots');
  const folder = path.join(temp, 'story-workflow');
  fs.mkdirSync(screenshots);
  fs.mkdirSync(path.join(folder, 'references'), { recursive: true });
  const skill = (name, text) => `---\nname: ${name}\ndescription: ${text}\n---\n# ${name}\n\nRead references/guide.md when present.\n`;
  const single = path.join(temp, 'SKILL.md');
  fs.writeFileSync(single, skill('qa-single-skill', 'A single-file workflow for planning a scene.'));
  fs.writeFileSync(path.join(folder, 'SKILL.md'), skill('qa-folder-skill', 'A folder workflow for rain-night film writing.'));
  fs.writeFileSync(path.join(folder, 'references/guide.md'), '# 雨夜参考\n\n主角走进车站，灯光映在湿地上。🎬\n');
  const invalid = path.join(temp, 'invalid', 'SKILL.md');
  fs.mkdirSync(path.dirname(invalid));
  fs.writeFileSync(invalid, '# Invalid Skill without frontmatter\n');
  const binary = process.env.SPIELBERG_TEST_BINARY || path.resolve(__dirname, '../../backend/target/debug/spielberg-backend');
  const server = spawn(binary, [], { env: { ...process.env, SPIELBERG_DATA_DIR: path.join(temp, 'data'), SPIELBERG_BIND: '127.0.0.1:0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  let backendErrors = '';
  server.stderr.on('data', value => { backendErrors += String(value); });
  try {
    const base = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Backend startup timed out: ' + backendErrors)), 15000);
      server.stdout.on('data', data => { const match = String(data).match(/Spielberg listening at (http:\/\/\S+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
      server.on('error', error => { clearTimeout(timeout); reject(error); });
      server.on('exit', code => { clearTimeout(timeout); reject(Error(`Backend exited ${code}: ${backendErrors}`)); });
    });
    const api = async (route, data, method = 'POST') => {
      const response = await fetch(base + '/api/v1' + route, { method, headers: { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
      const result = await response.json();
      assert(response.ok, JSON.stringify(result));
      return result.data;
    };
    const list = async () => (await api('/actions/skills/list', {})).items;
    const until = async (read, predicate, description) => {
      const deadline = Date.now() + 10000;
      let last;
      while (Date.now() < deadline) {
        last = await read();
        if (predicate(last)) return last;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw Error(`Timed out waiting for ${description}: ${JSON.stringify(last)}`);
    };
    await api('/projects', { name: 'Skills 浏览器验证' });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    await page.goto(base);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const panel = page.getByTestId('skills-settings');
    await panel.waitFor();
    const singleInput = page.getByTestId('skills-file-input');
    await until(() => panel.getByRole('button', { name: '上传 SKILL.md', exact: true }).isEnabled(), value => value, 'upload controls ready');
    await singleInput.setInputFiles(single);
    const installedSingle = (await until(list, values => values.some(item => item.name === 'qa-single-skill'), 'single-file install')).find(item => item.name === 'qa-single-skill');
    await page.getByTestId(`skill-row-${installedSingle.id}`).waitFor();
    await until(() => panel.getByRole('button', { name: '上传文件夹', exact: true }).isEnabled(), value => value, 'directory upload ready');
    await page.getByTestId('skills-directory-input').setInputFiles(folder);
    const installedFolder = (await until(list, values => values.some(item => item.name === 'qa-folder-skill'), 'directory install')).find(item => item.name === 'qa-folder-skill');
    const folderRow = page.getByTestId(`skill-row-${installedFolder.id}`);
    await folderRow.waitFor();
    assert.equal(installedFolder.files_count, 2);

    await page.getByTestId('skills-search').fill('rain-night');
    await until(() => panel.locator('[data-testid^="skill-row-"]').count(), count => count === 1, 'search description');
    assert(await folderRow.isVisible());
    await page.getByTestId('skills-search').fill('does-not-exist');
    await until(() => panel.locator('[data-testid^="skill-row-"]').count(), count => count === 0, 'empty search');
    await page.getByTestId('skills-search').fill('');
    await page.locator('.arco-message-success').last().waitFor({ state: 'hidden', timeout: 10000 });
    await page.getByTestId(`skill-detail-${installedFolder.id}`).click();
    const detail = page.getByTestId('skill-detail');
    await detail.waitFor();
    await detail.getByText('references/guide.md', { exact: true }).waitFor();
    assert((await detail.innerText()).includes('qa-folder-skill'));
    assert((await detail.innerText()).includes('references/guide.md'));
    await page.screenshot({ path: path.join(screenshots, 'detail.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
    await detail.waitFor({ state: 'hidden' });

    await page.getByTestId(`skill-toggle-${installedFolder.id}`).click();
    await until(list, values => values.find(item => item.id === installedFolder.id)?.enabled === false, 'disable Skill');
    await page.reload();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByTestId(`skill-toggle-${installedFolder.id}`).waitFor();
    assert.equal((await list()).find(item => item.id === installedFolder.id).enabled, false);
    // Reimport a full local folder while disabled, then a standalone file while enabled.
    fs.writeFileSync(path.join(folder, 'SKILL.md'), skill('qa-folder-skill', 'An updated folder workflow for rain-night film writing.') + '\nFolder reinstall completed.\n');
    fs.writeFileSync(path.join(folder, 'references/guide.md'), '# 新版雨夜参考\n\n保留停用状态，替换参考文件。🎬\n');
    await page.getByTestId(`skill-reinstall-${installedFolder.id}`).click();
    await page.getByTestId('skill-reinstall-dialog').waitFor();
    const [folderChooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('skills-reinstall-folder').click()]);
    await folderChooser.setFiles(folder);
    await page.getByTestId('skill-reinstall-dialog').waitFor({ state: 'hidden' });
    const replacedFolder = (await list()).find(item => item.id === installedFolder.id);
    assert.equal(replacedFolder.enabled, false);
    assert.equal(replacedFolder.installed_at, installedFolder.installed_at);
    assert.equal(replacedFolder.files_count, 2);
    assert((await api('/actions/skills/detail', { id: installedFolder.id })).content.includes('Folder reinstall completed.'));
    fs.writeFileSync(single, skill('qa-single-skill', 'An updated single-file workflow for planning a scene.') + '\nFile reinstall completed.\n');
    await page.getByTestId(`skill-reinstall-${installedSingle.id}`).click();
    const [fileChooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('skills-reinstall-file').click()]);
    await fileChooser.setFiles(single);
    await page.getByTestId('skill-reinstall-dialog').waitFor({ state: 'hidden' });
    assert.equal((await list()).find(item => item.id === installedSingle.id).enabled, true);
    assert((await api('/actions/skills/detail', { id: installedSingle.id })).content.includes('File reinstall completed.'));
    await page.getByTestId(`skill-toggle-${installedFolder.id}`).click();
    await until(list, values => values.find(item => item.id === installedFolder.id)?.enabled === true, 'enable Skill');

    // Invalid uploaded content and GitHub source validation must display a visible failure.
    await until(() => panel.getByRole('button', { name: '上传 SKILL.md', exact: true }).isEnabled(), value => value, 'upload ready after toggle');
    await singleInput.setInputFiles(invalid);
    await panel.getByRole('alert').waitFor();
    assert((await panel.getByRole('alert').innerText()).includes('YAML'));
    assert.equal((await list()).length, 2);
    await page.getByTestId('skills-source').fill('https://example.com/owner/repo');
    await page.getByTestId('skills-install').click();
    await until(() => panel.getByRole('alert').innerText(), value => value.includes('https://github.com/'), 'GitHub source failure');
    assert.equal((await list()).length, 2);
    await page.screenshot({ path: path.join(screenshots, 'invalid-source.png'), fullPage: true, animations: 'disabled' });
    await page.getByTestId('skills-source').fill('');
    // Recover after a failed install and leave clean, enabled rows for layout screenshots.
    await page.getByTestId(`skill-toggle-${installedFolder.id}`).click();
    await until(list, values => values.find(item => item.id === installedFolder.id)?.enabled === false, 'disable after failed install');
    await page.getByTestId(`skill-toggle-${installedFolder.id}`).click();
    await until(list, values => values.find(item => item.id === installedFolder.id)?.enabled === true, 'recover after failed install');
    await page.locator('.arco-message-success').last().waitFor({ state: 'hidden', timeout: 10000 });
    await page.screenshot({ path: path.join(screenshots, 'desktop.png'), fullPage: true, animations: 'disabled' });

    for (const width of [1024, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await panel.scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `horizontal overflow at ${width}`);
      for (const testId of ['skills-source', 'skills-install', 'skills-search']) {
        const bounds = await page.getByTestId(testId).boundingBox();
        assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `${testId} exceeds viewport at ${width}`);
      }
      await page.screenshot({ path: path.join(screenshots, `width-${width}.png`), fullPage: true, animations: 'disabled' });
      if (width === 390) {
        await page.getByTestId(`skill-delete-${installedSingle.id}`).evaluate(element => element.scrollIntoView({ block: 'center' }));
        const action = await page.getByTestId(`skill-delete-${installedSingle.id}`).boundingBox();
        const nav = await page.locator('.side').boundingBox();
        assert(action && nav && action.y + action.height < nav.y, 'Skill actions are hidden under mobile navigation');
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: '切换到暗夜模式', exact: true }).click();
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(screenshots, 'dark.png'), fullPage: true, animations: 'disabled' });

    await page.getByTestId(`skill-delete-${installedFolder.id}`).click();
    await page.getByRole('dialog').getByRole('button', { name: '卸载', exact: true }).click();
    await until(list, values => !values.some(item => item.id === installedFolder.id), 'uninstall Skill');
    await folderRow.waitFor({ state: 'hidden' });
    assert.equal((await list()).length, 1);
    assert.deepEqual(failures, []);
    console.log('PASS: real Skills settings install/reinstall SKILL.md/folder, preserve ID/disabled preference, search, content/files detail, toggle persistence, uninstall, failure/recovery, desktop/mobile/dark layouts');
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
    fs.rmSync(path.join(temp, 'data'), { recursive: true, force: true });
    console.log('Screenshots: ' + screenshots);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
