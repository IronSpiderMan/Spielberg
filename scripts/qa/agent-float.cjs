// A real disposable backend and model fixture; speech is deterministic and never opens a microphone.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const tool = (name, args, id) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = async server => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spielberg-agent-float-'));
  const screenshots = path.join(temp, 'screenshots'); fs.mkdirSync(screenshots);
  const model = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const userIndex = body.messages.findLastIndex(message => message.role === 'user');
      const prompt = body.messages[userIndex].content;
      const results = body.messages.slice(userIndex + 1).filter(message => message.role === 'tool');
      if (prompt.includes('停止测试')) await delay(2000);
      const message = prompt.includes('创建语音角色') && !results.length
        ? { role: 'assistant', content: null, tool_calls: [tool('app_request', { method: 'POST', resource: 'assets', data: { name: '语音创建的角色', description: '来自浮动语音助手' } }, 'voice-create')] }
        : { role: 'assistant', content: `已完成：${prompt}` };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }));
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await listen(model);
  const binary = process.env.SPIELBERG_TEST_BINARY || path.resolve(__dirname, '../../backend/target/debug/spielberg-backend');
  const backend = spawn(binary, [], { env: { ...process.env, SPIELBERG_DATA_DIR: path.join(temp, 'data'), SPIELBERG_BIND: '127.0.0.1:0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser, page, frontend;
  try {
    const backendUrl = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Backend startup timed out')), 15000);
      backend.stdout.on('data', data => { const match = String(data).match(/Spielberg listening at (http:\/\/\S+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
      backend.on('error', reject); backend.on('exit', code => { clearTimeout(timeout); reject(Error(`Backend exited ${code}`)); });
    });
    const api = async (route, data, method = 'POST') => {
      const response = await fetch(backendUrl + '/api/v1' + route, { method, headers: { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
      const result = await response.json(); assert(response.ok, JSON.stringify(result)); return result.data;
    };
    const project = await api('/projects', { name: '浮动语音测试 A' });
    const second = await api('/projects', { name: '浮动语音测试 B' });
    for (const item of [project, second]) await api('/actions/settings', { project_id: item.id, settings: { llm: { base_url: `http://127.0.0.1:${model.address().port}/v1`, model: 'voice-fixture', api_key: 'local-test-only' } } });
    // Serve the latest frontend build without rebuilding the backend's embedded assets.
    const dist = path.resolve(__dirname, '../../dist');
    frontend = http.createServer((req, res) => {
      if (req.url.startsWith('/api/')) {
        const headers = { ...req.headers }; delete headers.origin; delete headers.host;
        const proxy = http.request(backendUrl + req.url, { method: req.method, headers }, upstream => { res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res); });
        proxy.on('error', error => { res.writeHead(502); res.end(String(error)); }); req.pipe(proxy); return;
      }
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = path.resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime }); fs.createReadStream(file).pipe(res);
    });
    await listen(frontend);
    const base = `http://127.0.0.1:${frontend.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(12000);
    const failures = [], runs = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/v1/actions/agent/run') runs.push(request.postDataJSON()); });
    await page.addInitScript(({ projectId }) => {
      if (!localStorage.getItem('spielberg-last-project')) localStorage.setItem('spielberg-last-project', projectId);
      window.__speechStarts = 0;
      window.__speech = null;
      class MockSpeechRecognition {
        start() { window.__speechStarts++; window.__speech = this; setTimeout(() => this.onstart?.({}), 0); }
        stop() { this.onend?.({}); }
        abort() { this.onend?.({}); }
        emit(text, final = false) { const result = Object.assign([{ transcript: text, confidence: 1 }], { isFinal: final }); this.onresult?.({ resultIndex: 0, results: Object.assign([result], { item: index => index === 0 ? result : null }) }); }
      }
      window.__MockSpeechRecognition = MockSpeechRecognition;
      Object.defineProperty(window, 'SpeechRecognition', { configurable: true, writable: true, value: MockSpeechRecognition });
      Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, writable: true, value: undefined });
    }, { projectId: project.id });
    const orb = () => page.getByTestId('agent-float-button');
    const panel = () => page.getByTestId('agent-float-panel');
    const input = () => page.getByTestId('agent-float-input');
    const send = () => page.getByTestId('agent-float-send');
    const closePanel = async () => page.getByRole('button', { name: '收起语音助手', exact: true }).click();
    const start = async () => { const count = await page.evaluate(() => window.__speechStarts); await orb().click(); await page.waitForFunction(count => window.__speechStarts > count, count); };
    const emit = async (text, final = false) => page.evaluate(({ text, final }) => window.__speech.emit(text, final), { text, final });
    const end = async () => page.evaluate(() => window.__speech.onend?.({}));
    const waitRuns = async count => { for (let i = 0; i < 100 && runs.length < count; i++) await delay(50); assert.equal(runs.length, count); };
    await page.goto(base); await orb().waitFor();
    await page.getByRole('button', { name: '切换到暗夜模式', exact: true }).click();
    await page.screenshot({ path: path.join(screenshots, 'default-dark.png'), fullPage: true, animations: 'disabled' });

    // A pointer drag never starts dictation and survives reloads and viewport changes.
    const original = await orb().boundingBox();
    await page.mouse.move(original.x + original.width / 2, original.y + original.height / 2); await page.mouse.down();
    await page.mouse.move(1080, 600, { steps: 12 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => window.__speechStarts), 0);
    assert.equal(await panel().count(), 0);
    const moved = await orb().boundingBox(); assert(Math.abs(moved.x - original.x) > 50);
    assert(await page.evaluate(() => localStorage.getItem('spielberg-agent-float-position')));
    await page.reload(); await orb().waitFor();
    const restored = await orb().boundingBox(); assert(Math.abs(restored.x - moved.x) < 3 && Math.abs(restored.y - moved.y) < 3);
    await page.setViewportSize({ width: 600, height: 700 }); await delay(100);
    const clamped = await orb().boundingBox(); assert(clamped.x >= 0 && clamped.y >= 0 && clamped.x + clamped.width <= 600 && clamped.y + clamped.height <= 700);
    await page.screenshot({ path: path.join(screenshots, 'mobile-orb.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 1440, height: 1000 });

    // Partial and final recognition are displayed; only one actual Agent run is submitted.
    await start(); await emit('请创建语音'); await input().waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="agent-float-input"]')?.value === '请创建语音');
    assert.equal(await input().inputValue(), '请创建语音');
    await page.screenshot({ path: path.join(screenshots, 'listening.png'), fullPage: true, animations: 'disabled' });
    await emit('请创建语音角色', true); await end(); await waitRuns(1);
    await panel().getByText('已完成：请创建语音角色', { exact: false }).waitFor();
    assert.equal(runs[0].project_id, project.id);
    const assets = await api(`/projects/${project.id}/assets`, undefined, 'GET'); assert.equal(assets.length, 1); assert.equal(assets[0].name, '语音创建的角色');
    const firstSession = runs[0].session_id;
    await page.screenshot({ path: path.join(screenshots, 'completed.png'), fullPage: true, animations: 'disabled' });
    await panel().getByRole('button', { name: '打开完整对话', exact: true }).click();
    await page.getByTestId('agent-workspace').waitFor();
    await page.getByTestId(`agent-session-${firstSession}`).waitFor();
    assert.equal(await page.getByTestId(`agent-session-${firstSession}`).getAttribute('aria-current'), 'page');
    await page.locator('[data-workspace-nav="roles"]').click();
    await page.getByText('语音创建的角色', { exact: true }).first().waitFor();
    assert(await orb().isVisible());

    // Dismissal cancels partial dictation; late recognition events cannot send a command.
    if (await panel().isVisible()) await closePanel();
    await start(); await emit('取消的口述不会执行'); await closePanel(); await end(); await delay(150);
    assert.equal(runs.length, 1);

    // Recognition errors retain a text fallback and subsequent runs share the voice session.
    await start(); await page.evaluate(() => window.__speech.onerror?.({ error: 'not-allowed' }));
    await panel().getByText(/权限|麦克风/).first().waitFor();
    await input().fill('权限拒绝后手动输入'); await send().click(); await waitRuns(2);
    await panel().getByText('已完成：权限拒绝后手动输入', { exact: false }).waitFor();
    assert.equal(runs[1].session_id, firstSession);
    await input().fill('停止测试'); await send().click(); await waitRuns(3);
    await page.getByTestId('agent-float-stop').click();
    await page.getByTestId('agent-float-stop').waitFor({ state: 'hidden' });
    await send().waitFor();
    const stopped = await api('/actions/agent/session', { project_id: project.id, session_id: firstSession });
    assert.equal(stopped.status, 'cancelled');

    // Switching projects cancels dictation and isolates the next Agent conversation.
    await closePanel(); await start(); await emit('跨项目取消的口述');
    await page.getByRole('button', { name: `切换项目：${project.name}`, exact: true }).click();
    await page.getByRole('button', { name: `打开项目 ${second.name}`, exact: true }).click();
    await page.waitForFunction(id => localStorage.getItem('spielberg-last-project') === id, second.id);
    await end(); await delay(150); assert.equal(runs.length, 3);
    await start(); await emit('第二个项目的语音', true); await end(); await waitRuns(4);
    await panel().getByText('已完成：第二个项目的语音', { exact: false }).waitFor();
    assert.equal(runs[3].project_id, second.id); assert.notEqual(runs[3].session_id, firstSession);

    // Clicking the orb a second time finishes dictation instead of starting another listener.
    await closePanel(); await start(); await emit('再次点击结束听写');
    const startsBeforeStop = await page.evaluate(() => window.__speechStarts);
    await orb().click(); await waitRuns(5);
    await panel().getByText('已完成：再次点击结束听写', { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => window.__speechStarts), startsBeforeStop);

    // Unsupported environments still expose a usable typed command path.
    await closePanel();
    await page.evaluate(() => { window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; });
    await orb().click(); await input().waitFor();
    await panel().getByText(/不支持|不可用/).first().waitFor();
    await input().fill('不支持语音时手动执行'); await send().click(); await waitRuns(6);
    await panel().getByText('已完成：不支持语音时手动执行', { exact: false }).waitFor();
    await page.getByRole('button', { name: '切换到浅色模式', exact: true }).click();
    await page.screenshot({ path: path.join(screenshots, 'text-fallback.png'), fullPage: true, animations: 'disabled' });

    // A denied microphone preserves text; a fresh utterance replaces stale/cancelled dictation.
    await page.evaluate(() => { window.SpeechRecognition = window.__MockSpeechRecognition; });
    await input().fill('保留原有草稿');
    await panel().getByRole('button', { name: '开始语音输入', exact: true }).click();
    await page.evaluate(() => window.__speech.onerror?.({ error: 'not-allowed' }));
    await panel().getByText(/权限|麦克风/).first().waitFor();
    assert.equal(await input().inputValue(), '保留原有草稿');
    assert.equal(runs.length, 6);
    await panel().getByRole('button', { name: '开始语音输入', exact: true }).click();
    await emit('新一次语音指令', true); await end(); await waitRuns(7);
    assert.equal(runs[6].message, '新一次语音指令');
    await panel().getByText('已完成：新一次语音指令', { exact: false }).waitFor();

    // A run started in the full workspace is reflected in the orb and can be stopped there.
    await panel().getByRole('button', { name: '打开完整对话', exact: true }).click();
    await page.getByTestId('agent-composer').fill('完整页面停止测试');
    await page.getByTestId('agent-send').click(); await waitRuns(8);
    await page.waitForFunction(() => document.querySelector('[data-testid="agent-float-button"]')?.getAttribute('data-state') === 'working');
    const startsBeforeOpen = await page.evaluate(() => window.__speechStarts);
    await orb().click(); await page.getByTestId('agent-float-stop').waitFor();
    assert.equal(await page.evaluate(() => window.__speechStarts), startsBeforeOpen);
    await page.screenshot({ path: path.join(screenshots, 'workspace-run-sync.png'), fullPage: true, animations: 'disabled' });
    await page.getByTestId('agent-float-stop').click();
    await page.getByTestId('agent-float-stop').waitFor({ state: 'hidden' });
    await page.getByTestId('agent-stop').waitFor({ state: 'hidden' });
    assert.equal((await api('/actions/agent/session', { project_id: second.id, session_id: runs[7].session_id })).status, 'cancelled');
    assert.deepEqual(failures, []);
    console.log('PASS: global draggable orb; persisted/clamped placement; exactly-once speech dispatch; real Agent operations; full-conversation navigation; cancellation and permission fallback; session isolation; stopping; unsupported text input; draft preservation; bidirectional workspace synchronization.');
    console.log('Screenshots: ' + screenshots);
  } catch (error) {
    if (page && !page.isClosed()) { await page.screenshot({ path: path.join(screenshots, 'failure.png'), fullPage: true }).catch(() => {}); console.error('Failure screenshot: ' + path.join(screenshots, 'failure.png')); }
    throw error;
  } finally {
    if (browser) await browser.close();
    if (frontend) await close(frontend);
    backend.kill('SIGTERM'); await new Promise(resolve => backend.exitCode !== null || backend.signalCode !== null ? resolve() : backend.once('exit', resolve));
    await close(model);
    fs.rmSync(path.join(temp, 'data'), { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
