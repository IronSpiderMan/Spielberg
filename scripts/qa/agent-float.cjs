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
  const syntheses = [], transcriptions = [];
  let synthesisFailures = 0, synthesisDelay = 0;
  const wav = Buffer.alloc(44 + 4800);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(4800, 40);
  const model = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks);
      if (req.url.endsWith('/audio/transcriptions')) {
        transcriptions.push({ path: req.url, body: raw.toString() });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text: '来自指定 ASR 的识别结果' })); return;
      }
      const body = JSON.parse(raw.toString());
      if (req.url.endsWith('/audio/speech')) {
        syntheses.push({ path: req.url, ...body });
        if (synthesisDelay) await delay(synthesisDelay);
        if (synthesisFailures > 0) {
          synthesisFailures--; res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: '朗读服务暂时不可用，请重试' } })); return;
        }
        res.writeHead(200, { 'Content-Type': body.response_format === 'wav' ? 'audio/wav' : 'audio/mpeg' });
        res.end(body.response_format === 'wav' ? wav : Buffer.from('ID3fixture-audio')); return;
      }
      const userIndex = body.messages.findLastIndex(message => message.role === 'user');
      const prompt = body.messages[userIndex].content;
      const results = body.messages.slice(userIndex + 1).filter(message => message.role === 'tool');
      if (prompt.includes('停止测试')) await delay(2000);
      const message = prompt.includes('创建语音角色') && !results.length
        ? { role: 'assistant', content: null, tool_calls: [tool('app_request', { method: 'POST', resource: 'assets', data: { name: '语音创建的角色', description: '来自浮动语音助手' } }, 'voice-create')] }
        : prompt.includes('Markdown 回归')
          ? { role: 'assistant', content: `**时间线已整理**\n\n${Array.from({ length: 16 }, (_, i) => `${i + 1}. 第 ${i + 1} 幕：保留关键剧情并补全人物动机。`).join('\n')}\n\n[查看参考](https://example.com/reference)\n\n\`项目草稿\`` }
        : prompt.includes('长回复朗读')
          ? { role: 'assistant', content: Array.from({ length: 260 }, (_, i) => `第${i + 1}幕：人物走进工作室，补全故事时间线，确认下一场戏。`).join('\n') }
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
    const speechChannels = kind => ({ default_channel_id: `${kind}-default`, channels: ['default', 'selected'].map(name => ({
      id: `${kind}-${name}`, name: `${kind.toUpperCase()} ${name === 'default' ? '默认渠道' : '指定渠道'}`, provider: 'openai',
      base_url: `http://127.0.0.1:${model.address().port}/${name}/v1`, api_key: 'local-speech-fixture',
      models: [{ id: `${kind}-${name}-model`, name: `${kind.toUpperCase()} ${name === 'default' ? '默认模型' : '指定模型'}`, profile: `openai-${kind}` }],
    })) });
    for (const item of [project, second]) await api('/actions/settings', { project_id: item.id, settings: { llm: { base_url: `http://127.0.0.1:${model.address().port}/v1`, model: 'voice-fixture', api_key: 'local-test-only' }, asr: speechChannels('asr'), tts: speechChannels('tts') } });
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
    const failures = [], runs = [], speechRequests = [], asrRequests = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('request', request => {
      const route = new URL(request.url()).pathname;
      if (route === '/api/v1/actions/agent/run') runs.push(request.postDataJSON());
      if (route === '/api/v1/actions/speech/synthesize') speechRequests.push(request.postDataJSON());
      if (route === '/api/v1/actions/speech/transcribe') asrRequests.push(request.postDataJSON());
    });
    await page.addInitScript(({ projectId, secondId }) => {
      if (!localStorage.getItem('spielberg-last-project')) localStorage.setItem('spielberg-last-project', projectId);
      for (const id of [projectId, secondId]) {
        const key = `spielberg-agent-float-speech-${id}`;
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ asr: { provider: 'system' }, tts: { provider: 'cloud', voice: '', speed: 1 }, autoRead: false }));
      }
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
      window.__audioPlays = []; window.__audioInstances = []; window.__mediaStarts = []; window.__systemSpeaks = [];
      window.__audioFailNext = false;
      window.Audio = class extends EventTarget {
        constructor(src = '') { super(); this.src = src; this.paused = true; this.currentTime = 0; window.__audioInstances.push(this); }
        async play() {
          if (window.__audioFailNext) { window.__audioFailNext = false; throw new DOMException('Autoplay blocked by fixture', 'NotAllowedError'); }
          this.paused = false;
          this.record = { src: this.src, paused: false, finish: () => this.finish() };
          window.__audioPlays.push(this.record); this.dispatchEvent(new Event('play')); this.onplay?.();
        }
        pause() { this.paused = true; if (this.record) this.record.paused = true; }
        load() {}
        removeAttribute(name) { if (name === 'src') this.src = ''; }
        finish() { this.pause(); const event = new Event('ended'); this.dispatchEvent(event); this.onended?.(event); }
      };
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
        window.__mediaStarts.push({ playing: window.__audioInstances.filter(audio => !audio.paused).length });
        return { getTracks: () => [{ stop() {} }] };
      } });
      window.AudioContext = class {
        constructor() { this.sampleRate = 24000; this.state = 'running'; this.destination = {}; }
        async resume() { this.state = 'running'; }
        async close() { this.state = 'closed'; }
        createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
        createScriptProcessor() { const processor = { connect() {}, disconnect() {}, onaudioprocess: null }; window.__audioProcessor = processor; return processor; }
      };
      window.SpeechSynthesisUtterance = class extends EventTarget { constructor(text) { super(); this.text = text; } };
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        getVoices: () => [{ voiceURI: 'fixture-voice', name: '本机测试音色', lang: 'zh-CN' }],
        speak(utterance) { window.__systemSpeaks.push(utterance); utterance.onstart?.(); }, cancel() {},
        addEventListener() {}, removeEventListener() {},
      } });
    }, { projectId: project.id, secondId: second.id });
    const orb = () => page.getByTestId('agent-float-button');
    const panel = () => page.getByTestId('agent-float-panel');
    const input = () => page.getByTestId('agent-float-input');
    const send = () => page.getByTestId('agent-float-send');
    const closePanel = async () => page.getByRole('button', { name: '收起语音助手', exact: true }).click();
    const start = async () => { const count = await page.evaluate(() => window.__speechStarts); await orb().click(); await page.waitForFunction(count => window.__speechStarts > count, count); };
    const startMic = async () => { const count = await page.evaluate(() => window.__speechStarts); await panel().getByRole('button', { name: '开始语音输入', exact: true }).click(); await page.waitForFunction(count => window.__speechStarts > count, count); };
    const emit = async (text, final = false) => page.evaluate(({ text, final }) => window.__speech.emit(text, final), { text, final });
    const end = async () => page.evaluate(() => window.__speech.onend?.({}));
    const waitRuns = async count => { for (let i = 0; i < 100 && runs.length < count; i++) await delay(50); assert.equal(runs.length, count); };
    const playCount = () => page.evaluate(() => window.__audioPlays.length);
    const waitPlays = count => page.waitForFunction(count => window.__audioPlays.length >= count, count);
    const finishAudio = () => page.evaluate(() => window.__audioPlays.at(-1)?.finish());
    const startCloudMic = async () => {
      const before = await page.evaluate(() => window.__mediaStarts.length);
      await panel().getByRole('button', { name: '开始语音输入', exact: true }).click();
      await page.waitForFunction(before => window.__mediaStarts.length > before && window.__audioProcessor?.onaudioprocess, before);
      assert.equal(await page.evaluate(() => window.__mediaStarts.at(-1).playing), 0, 'All playback must stop before opening the microphone');
      await page.evaluate(() => window.__audioProcessor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(4096).fill(0.1) } }));
    };
    const assertPanelPlacement = async () => {
      await page.waitForFunction(() => {
        const panel = document.querySelector('[data-testid="agent-float-panel"]')?.getBoundingClientRect();
        const orb = document.querySelector('[data-testid="agent-float-button"]')?.getBoundingClientRect();
        return panel && orb && panel.left >= 0 && panel.top >= 0 && panel.right <= innerWidth + 1 && panel.bottom <= innerHeight + 1
          && (panel.right <= orb.left || panel.left >= orb.right || panel.bottom <= orb.top || panel.top >= orb.bottom);
      });
    };
    await page.goto(base); await orb().waitFor();
    await page.getByRole('button', { name: '切换到暗夜模式', exact: true }).click();
    await page.screenshot({ path: path.join(screenshots, 'default-dark.png'), fullPage: true, animations: 'disabled' });

    // The default action opens the composer without recording; Escape restores focus.
    await orb().click(); await panel().waitFor();
    assert.equal(await page.evaluate(() => window.__speechStarts), 0);
    await page.keyboard.press('Escape'); await panel().waitFor({ state: 'hidden' });
    assert(await orb().evaluate(element => element === document.activeElement));
    const keyboardStart = await orb().boundingBox();
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowUp');
    const keyboardMoved = await orb().boundingBox();
    assert(keyboardMoved.x < keyboardStart.x && keyboardMoved.y < keyboardStart.y);
    await page.keyboard.press('Enter'); await panel().waitFor();
    await orb().click(); await panel().waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__speechStarts), 0);
    await orb().click(); await panel().waitFor();
    await page.getByText('制作空间', { exact: true }).click();
    await panel().waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__speechStarts), 0);

    // A pointer drag never starts dictation and survives reloads and viewport changes.
    const original = await orb().boundingBox();
    await page.mouse.move(original.x + original.width / 2, original.y + original.height / 2); await page.mouse.down();
    await page.mouse.move(1080, 600, { steps: 12 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => window.__speechStarts), 0);
    assert.equal(await panel().count(), 0);
    const moved = await orb().boundingBox(); assert(Math.hypot(moved.x - original.x, moved.y - original.y) > 50);
    assert(await page.evaluate(() => localStorage.getItem('spielberg-agent-float-position')));
    await page.reload(); await orb().waitFor();
    const restored = await orb().boundingBox(); assert(Math.abs(restored.x - moved.x) < 3 && Math.abs(restored.y - moved.y) < 3);
    await page.setViewportSize({ width: 600, height: 700 }); await delay(100);
    const clamped = await orb().boundingBox(); assert(clamped.x >= 0 && clamped.y >= 0 && clamped.x + clamped.width <= 600 && clamped.y + clamped.height <= 700);
    await page.screenshot({ path: path.join(screenshots, 'mobile-orb.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 1440, height: 1000 });

    // Dictation is reviewed before sending, appends to the draft, and cancellation restores it.
    await orb().click(); await panel().waitFor();
    await input().fill('保留原有草稿'); await startMic(); await emit('取消的补充内容');
    await panel().getByRole('button', { name: '取消听写，改用文字', exact: true }).click();
    assert.equal(await input().inputValue(), '保留原有草稿');
    await end(); assert.equal(runs.length, 0);
    await startMic(); await emit('确认后再发送', true); await end();
    await page.waitForFunction(() => !document.querySelector('[data-testid="agent-float-input"]')?.readOnly);
    assert.match(await input().inputValue(), /^保留原有草稿\s+确认后再发送$/);
    assert.equal(runs.length, 0);

    // Shift+Enter and IME confirmation never submit; Enter sends one Markdown request.
    await input().fill('第一行'); await input().press('Shift+Enter');
    assert.equal(await input().inputValue(), '第一行\n');
    await input().evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
    assert.equal(runs.length, 0);
    await input().fill('Markdown 回归'); await input().press('Enter'); await waitRuns(1);
    await panel().locator('strong').filter({ hasText: '时间线已整理' }).waitFor();
    assert.equal(await panel().getByTestId('agent-float-reply').locator('li').count(), 16);
    assert.equal(await panel().getByRole('link', { name: '查看参考' }).getAttribute('target'), '_blank');
    await assertPanelPlacement();
    const openOrb = await orb().boundingBox();
    await page.mouse.move(openOrb.x + openOrb.width / 2, openOrb.y + openOrb.height / 2); await page.mouse.down();
    await page.mouse.move(740, 500, { steps: 12 }); await page.mouse.up();
    await assertPanelPlacement();
    await page.setViewportSize({ width: 380, height: 600 }); await assertPanelPlacement();
    await page.screenshot({ path: path.join(screenshots, 'compact-markdown.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 1440, height: 1000 }); await assertPanelPlacement();

    // Each project's draft and recognition provider survive reloads without leaking to another project.
    await input().fill('项目 A 的未发送草稿');
    await panel().getByRole('combobox', { name: '语音识别方式' }).selectOption('cloud');
    await page.reload(); await orb().click(); await panel().waitFor();
    assert.equal(await input().inputValue(), '项目 A 的未发送草稿');
    assert.equal(await panel().getByRole('combobox', { name: '语音识别方式' }).inputValue(), 'cloud');
    await closePanel();
    await page.getByRole('button', { name: `切换项目：${project.name}`, exact: true }).click();
    await page.getByRole('button', { name: `打开项目 ${second.name}`, exact: true }).click();
    await page.waitForFunction(id => localStorage.getItem('spielberg-last-project') === id, second.id);
    await orb().click(); await panel().waitFor();
    assert.equal(await input().inputValue(), '');
    assert.equal(await panel().getByRole('combobox', { name: '语音识别方式' }).inputValue(), 'system');
    await closePanel();
    await page.getByRole('button', { name: `切换项目：${second.name}`, exact: true }).click();
    await page.getByRole('button', { name: `打开项目 ${project.name}`, exact: true }).click();
    await page.waitForFunction(id => localStorage.getItem('spielberg-last-project') === id, project.id);
    await orb().click(); await panel().waitFor();
    assert.equal(await input().inputValue(), '项目 A 的未发送草稿');
    assert.equal(await panel().getByRole('combobox', { name: '语音识别方式' }).inputValue(), 'cloud');
    await panel().getByRole('combobox', { name: '语音识别方式' }).selectOption('system');

    // A failed restoration can be discarded instead of permanently locking the composer.
    await page.route('**/api/v1/actions/agent/session', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '测试恢复失败' }) }));
    await page.reload(); await orb().click(); await panel().getByText(/无法恢复/).waitFor();
    const fresh = panel().getByRole('button', { name: '新对话', exact: true });
    assert(await fresh.isEnabled()); await fresh.click();
    await panel().getByText(/无法恢复/).waitFor({ state: 'hidden' });
    assert(await input().isEnabled());
    await page.unroute('**/api/v1/actions/agent/session');
    await input().fill(''); await closePanel();
    await page.evaluate(() => {
      localStorage.setItem('spielberg-agent-float-preferences', JSON.stringify({ ...JSON.parse(localStorage.getItem('spielberg-agent-float-preferences') || '{}'), clickAction: 'voice', speechAutoSend: true }));
      localStorage.removeItem('spielberg-agent-float-position');
    });
    runs.length = 0;
    await page.reload(); await orb().waitFor();

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
    await page.getByRole('menuitem', { name: '资产库', exact: true }).click();
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
    await orb().click(); await panel().getByText(/不支持|不可用/).first().waitFor();
    await page.screenshot({ path: path.join(screenshots, 'text-fallback.png'), fullPage: true, animations: 'disabled' });

    // A denied microphone preserves text; a fresh utterance appends to the existing draft.
    await page.evaluate(() => { window.SpeechRecognition = window.__MockSpeechRecognition; });
    await input().fill('保留原有草稿');
    await panel().getByRole('button', { name: '开始语音输入', exact: true }).click();
    await page.evaluate(() => window.__speech.onerror?.({ error: 'not-allowed' }));
    await panel().getByText(/权限|麦克风/).first().waitFor();
    assert.equal(await input().inputValue(), '保留原有草稿');
    assert.equal(runs.length, 6);
    await panel().getByRole('button', { name: '开始语音输入', exact: true }).click();
    await emit('新一次语音指令', true); await end(); await waitRuns(7);
    assert.match(runs[6].message, /^保留原有草稿\s+新一次语音指令$/);
    await panel().getByText(/已完成：保留原有草稿\s+新一次语音指令/).waitFor();

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

    // Completion while collapsed is visible, and opening that result never starts a new recording.
    await input().fill('后台完成停止测试'); await send().click(); await waitRuns(9);
    await page.getByTestId('agent-float-stop').waitFor(); await closePanel();
    await page.waitForFunction(() => document.querySelector('[data-testid="agent-float-button"]')?.getAttribute('data-unread') === 'true');
    const startsBeforeResult = await page.evaluate(() => window.__speechStarts);
    await orb().click(); await panel().getByText('已完成：后台完成停止测试', { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => window.__speechStarts), startsBeforeResult);
    assert.equal(await orb().getAttribute('data-unread'), 'false');

    // Speech configuration uses real saved project channels, including a nondefault model and voice.
    assert.equal(syntheses.length, 0, 'Legacy interaction tests must not trigger automatic reading');
    await closePanel();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: 'Agent 悬浮按钮', exact: true }).click();
    const speechSettings = page.getByRole('tabpanel', { name: 'Agent 悬浮按钮', exact: true });
    const speechTab = speechSettings.getByRole('tab', { name: '语音服务', exact: true });
    const appearanceTab = speechSettings.getByRole('tab', { name: '浮标与交互', exact: true });
    const settingsBody = speechSettings.locator('.settings-agent-body');
    assert.equal(await speechTab.getAttribute('aria-selected'), 'true');
    await speechSettings.getByRole('radiogroup', { name: 'ASR 识别方式' }).getByRole('radio', { name: '项目 ASR 渠道', exact: true }).check();
    const selectModel = async kind => {
      await speechSettings.getByRole('button', { name: `${kind}渠道与模型`, exact: true }).click();
      const choices = page.getByRole('dialog', { name: `${kind}渠道与模型`, exact: true });
      await choices.getByRole('button', { name: `${kind} 指定渠道`, exact: true }).click();
      await choices.getByRole('button', { name: new RegExp(`^${kind} 指定模型`) }).click();
    };
    await selectModel('ASR');
    await speechSettings.getByRole('radiogroup', { name: 'TTS 朗读方式' }).getByRole('radio', { name: '项目 TTS 渠道', exact: true }).check();
    await selectModel('TTS');
    await speechSettings.getByRole('textbox', { name: 'TTS 音色 ID' }).fill('fixture-narrator');
    const speedControl = speechSettings.getByLabel('TTS 语速', { exact: true });
    await speedControl.fill('1.2'); await speedControl.press('Tab');
    await speechSettings.getByRole('switch', { name: '自动朗读 Agent 回复' }).click();
    const configuredSpeech = await page.evaluate(id => JSON.parse(localStorage.getItem(`spielberg-agent-float-speech-${id}`)), second.id);
    assert.equal(configuredSpeech.asr.channel_id, 'asr-selected');
    assert.equal(configuredSpeech.asr.model, 'asr-selected-model');
    assert.equal(configuredSpeech.tts.channel_id, 'tts-selected');
    assert.equal(configuredSpeech.tts.model, 'tts-selected-model');
    assert.equal(configuredSpeech.tts.voice, 'fixture-narrator');
    assert.equal(configuredSpeech.tts.speed, 1.2); assert.equal(configuredSpeech.autoRead, true);
    const speechBaseline = await api('/actions/project', { id: second.id });
    const tasksBaseline = await api('/actions/tasks', { project_id: second.id });

    // Settings preview uses the same selected voice/speed and stops when switching subpanels.
    const preview = () => speechSettings.getByRole('button', { name: '试听声音', exact: true });
    const stopPreview = () => speechSettings.getByRole('button', { name: '停止试听', exact: true });
    await preview().click(); await waitPlays(1);
    assert.equal(syntheses.at(-1).path, '/selected/v1/audio/speech');
    assert.equal(syntheses.at(-1).model, 'tts-selected-model');
    assert.equal(syntheses.at(-1).voice, 'fixture-narrator'); assert.equal(syntheses.at(-1).speed, 1.2);
    assert.equal(syntheses.at(-1).input, '你好，我是你的创作助手。');
    await appearanceTab.click();
    assert(await page.evaluate(() => window.__audioInstances.every(audio => audio.paused)));
    await speechSettings.getByRole('radiogroup', { name: '点击浮标时', exact: true }).getByRole('radio', { name: '展开对话', exact: true }).check();
    await speechSettings.getByRole('switch', { name: '语音识别后自动发送', exact: true }).click();
    await speechTab.click();
    assert.deepEqual(await page.evaluate(id => JSON.parse(localStorage.getItem(`spielberg-agent-float-speech-${id}`)), second.id), configuredSpeech);

    // Each pane fits its available width, while switching panes resets only the settings scroll.
    await page.getByRole('button', { name: '切换到暗夜模式', exact: true }).click();
    const checkSettingsWidth = async () => {
      assert(await speechSettings.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'The settings pane must not overflow horizontally');
      assert(await settingsBody.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'The settings body must not overflow horizontally');
    };
    await checkSettingsWidth();
    await page.screenshot({ path: path.join(screenshots, 'speech-settings-1440.png'), fullPage: true, animations: 'disabled' });
    await appearanceTab.click();
    await page.screenshot({ path: path.join(screenshots, 'float-interaction-1440.png'), fullPage: true, animations: 'disabled' });
    await speechTab.click();
    await page.setViewportSize({ width: 1280, height: 800 }); await checkSettingsWidth();
    await page.screenshot({ path: path.join(screenshots, 'speech-settings-1280.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 800 }); await checkSettingsWidth();
    await settingsBody.evaluate(element => { element.scrollTop = element.scrollHeight; });
    assert(await settingsBody.evaluate(element => element.scrollTop > 0), 'Narrow settings should scroll vertically');
    await appearanceTab.click(); assert.equal(await settingsBody.evaluate(element => element.scrollTop), 0);
    await checkSettingsWidth();
    await speechTab.click(); assert.equal(await settingsBody.evaluate(element => element.scrollTop), 0);
    assert.equal(await speechSettings.getByRole('textbox', { name: 'TTS 音色 ID' }).inputValue(), 'fixture-narrator');
    assert.equal(await speedControl.inputValue(), '1.2');
    await page.screenshot({ path: path.join(screenshots, 'speech-settings-mobile.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 1440, height: 1000 });

    // Leaving the top-level settings category stops playback; entering it returns to the heading.
    const categoryPlays = await playCount(); await preview().click(); await waitPlays(categoryPlays + 1);
    await page.getByRole('tab', { name: '语音合成', exact: true }).click();
    assert(await page.evaluate(() => window.__audioInstances.every(audio => audio.paused)));
    await page.getByRole('tab', { name: 'Agent 悬浮按钮', exact: true }).click();
    assert.equal(await speechTab.getAttribute('aria-selected'), 'true');
    assert.equal(await settingsBody.evaluate(element => element.scrollTop), 0);

    // Preview playback also stops before the floating assistant opens its microphone.
    const echoPlays = await playCount(); await preview().click(); await waitPlays(echoPlays + 1);
    await orb().click(); await panel().waitFor();
    await startCloudMic();
    await panel().getByRole('button', { name: '取消听写，改用文字', exact: true }).click(); await closePanel();
    assert(await page.evaluate(() => window.__audioInstances.every(audio => audio.paused)));

    // A late preview response cannot resume audio after a subsection switch.
    await speechSettings.getByRole('textbox', { name: 'TTS 音色 ID' }).fill('fixture-preview-pending');
    synthesisDelay = 900;
    const pendingPreviewCalls = syntheses.length, pendingPreviewPlays = await playCount();
    await preview().click();
    for (let i = 0; i < 80 && syntheses.length === pendingPreviewCalls; i++) await delay(20);
    assert(syntheses.length > pendingPreviewCalls); await appearanceTab.click();
    await delay(1100); assert.equal(await playCount(), pendingPreviewPlays);
    synthesisDelay = 0; await speechTab.click();

    // Preview failures stay in settings, preserve the configuration, and can be retried.
    await speechSettings.getByRole('textbox', { name: 'TTS 音色 ID' }).fill('fixture-preview-failure');
    synthesisFailures = 1; await preview().click();
    await speechSettings.getByRole('alert').filter({ hasText: '试听未成功' }).waitFor();
    await orb().click(); await panel().waitFor();
    assert.equal(await panel().getByRole('alert').count(), 0, 'Preview failure must not contaminate the assistant error state');
    await closePanel();
    const retryPreviewPlays = await playCount(); await preview().click(); await waitPlays(retryPreviewPlays + 1); await stopPreview().click();
    await speechSettings.getByRole('textbox', { name: 'TTS 音色 ID' }).fill('fixture-narrator');
    assert.deepEqual(await page.evaluate(id => JSON.parse(localStorage.getItem(`spielberg-agent-float-speech-${id}`)), second.id), configuredSpeech);
    assert.deepEqual((await api('/actions/project', { id: second.id })).media, speechBaseline.media, 'Preview must not add media');
    assert.deepEqual(await api('/actions/tasks', { project_id: second.id }), tasksBaseline, 'Preview must not add tasks');
    syntheses.length = 0; speechRequests.length = 0;
    await page.reload(); await orb().click(); await panel().waitFor();
    await panel().getByText('已完成：后台完成停止测试', { exact: false }).waitFor();
    assert.equal(syntheses.length, 0, 'Restoring historical replies must not read them aloud');

    // Recording uses the configured ASR route, without saving a recording or creating a task.
    await startCloudMic(); await panel().locator('.agent-float-submit').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="agent-float-input"]')?.value === '来自指定 ASR 的识别结果');
    assert.equal(asrRequests.at(-1).channel_id, 'asr-selected'); assert.equal(asrRequests.at(-1).model, 'asr-selected-model');
    assert.equal(transcriptions.at(-1).path, '/selected/v1/audio/transcriptions');
    assert(transcriptions.at(-1).body.includes('asr-selected-model'));

    const stopReading = () => panel().getByRole('button', { name: '停止朗读', exact: true }).first().click();
    const readReply = () => panel().getByRole('button', { name: '朗读回复', exact: true }).click();
    const submitSpeechTest = async message => {
      const before = runs.length;
      await input().fill(message); await send().click(); await waitRuns(before + 1);
      await panel().getByTestId('agent-float-reply').getByText(`已完成：${message}`, { exact: true }).waitFor();
    };

    // A new completed reply reads exactly once through the chosen TTS route and voice.
    await submitSpeechTest('自动朗读一次'); await waitPlays(1);
    assert.equal(syntheses.length, 1); assert.equal(speechRequests.length, 1);
    assert.equal(speechRequests[0].channel_id, 'tts-selected'); assert.equal(speechRequests[0].model, 'tts-selected-model');
    assert.equal(syntheses[0].path, '/selected/v1/audio/speech'); assert.equal(syntheses[0].voice, 'fixture-narrator');
    assert.equal(syntheses[0].speed, configuredSpeech.tts.speed); assert.equal(syntheses[0].input, '已完成：自动朗读一次');
    await page.screenshot({ path: path.join(screenshots, 'speaking.png'), fullPage: true, animations: 'disabled' });
    await closePanel();
    assert.equal(await page.evaluate(() => window.__audioPlays.at(-1).paused), false, 'Collapsing preserves active playback');
    await orb().click(); await finishAudio();
    await panel().getByRole('button', { name: '朗读回复', exact: true }).waitFor();
    await delay(1400); assert.equal(syntheses.length, 1, 'Polling must not repeat the same reply');
    await page.reload(); await orb().click(); await panel().getByText('已完成：自动朗读一次', { exact: false }).waitFor();
    assert.equal(syntheses.length, 1); assert.equal(await playCount(), 0, 'Reload must not replay historical speech');

    // Manual replay stops cleanly, and starting either microphone or another request prevents echo.
    await readReply(); await waitPlays(1); await stopReading();
    assert.equal(await page.evaluate(() => window.__audioPlays.at(-1).paused), true);
    await readReply(); await waitPlays(2); await startCloudMic();
    assert.equal(await page.evaluate(() => window.__audioPlays.at(-1).paused), true);
    await panel().getByRole('button', { name: '取消听写，改用文字', exact: true }).click();
    await readReply(); await waitPlays(3);
    const previousAudio = await page.evaluate(() => window.__audioPlays.length - 1);
    await submitSpeechTest('新请求替换旧朗读');
    assert.equal(await page.evaluate(index => window.__audioPlays[index].paused, previousAudio), true);
    await waitPlays(4); await stopReading();

    // Synthesis failure and browser autoplay denial remain recoverable by an explicit replay.
    synthesisFailures = 1;
    await submitSpeechTest('合成失败后重试');
    await panel().getByText(/朗读服务暂时不可用|朗读失败|语音合成失败/).first().waitFor();
    const beforeRetry = await playCount(); await readReply(); await waitPlays(beforeRetry + 1); await stopReading();
    await page.evaluate(() => { window.__audioFailNext = true; });
    await submitSpeechTest('浏览器禁止自动播放');
    await panel().getByText(/自动播放|点击.*朗读|手动.*朗读/).first().waitFor();
    const beforeManual = await playCount(), synthesizedBeforeManual = syntheses.length;
    await readReply(); await waitPlays(beforeManual + 1);
    assert.equal(syntheses.length, synthesizedBeforeManual, 'Autoplay retry must play cached audio within the click gesture, without awaiting another synthesis');
    await stopReading();

    // Long final replies are read in bounded sequential chunks without losing the tail.
    const longStart = syntheses.length, longPlays = await playCount(), longRuns = runs.length;
    await input().fill('长回复朗读'); await send().click(); await waitRuns(longRuns + 1);
    await panel().getByTestId('agent-float-reply').getByText(/第260幕/).waitFor();
    await waitPlays(longPlays + 1);
    for (let chunk = 0; chunk < 12; chunk++) {
      const played = await playCount(); await finishAudio();
      await page.waitForFunction(played => window.__audioPlays.length > played || !Array.from(document.querySelectorAll('button')).some(button => button.getAttribute('aria-label') === '停止朗读'), played);
      if (await panel().getByRole('button', { name: '朗读回复', exact: true }).isVisible()) break;
    }
    const longCalls = syntheses.slice(longStart);
    assert(longCalls.length > 1); assert(longCalls.every(call => [...call.input].length <= 3500));
    const spokenLong = longCalls.map(call => call.input).join('').replace(/\s/g, '');
    const displayedLong = (await panel().getByTestId('agent-float-reply').innerText()).replace(/\s/g, '');
    assert.equal(spokenLong, displayedLong);

    // Cancelling pending synthesis or switching projects isolates late provider responses.
    synthesisDelay = 900;
    const delayedPlays = await playCount(), delayedCalls = syntheses.length;
    await submitSpeechTest('晚到音频不应播放');
    for (let i = 0; i < 80 && syntheses.length === delayedCalls; i++) await delay(20);
    assert(syntheses.length > delayedCalls);
    await panel().getByRole('button', { name: '新对话', exact: true }).click();
    await delay(1100); assert.equal(await playCount(), delayedPlays);
    const switchingCalls = syntheses.length;
    await submitSpeechTest('切项目隔离朗读');
    for (let i = 0; i < 80 && syntheses.length === switchingCalls; i++) await delay(20);
    const beforeSwitch = await playCount();
    await page.getByRole('button', { name: `切换项目：${second.name}`, exact: true }).click();
    await page.getByRole('button', { name: `打开项目 ${project.name}`, exact: true }).click();
    await page.waitForFunction(id => localStorage.getItem('spielberg-last-project') === id, project.id);
    await delay(1100); assert.equal(await playCount(), beforeSwitch);
    assert(await page.evaluate(() => window.__audioInstances.every(audio => audio.paused)));
    synthesisDelay = 0;
    const speechAfter = await api('/actions/project', { id: second.id });
    assert.deepEqual(speechAfter.media, speechBaseline.media, 'Speech must not add media');
    assert.deepEqual(await api('/actions/tasks', { project_id: second.id }), tasksBaseline, 'Speech must not add background tasks');

    // The local system reader remains an explicit alternative to the configured service.
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: 'Agent 悬浮按钮', exact: true }).click();
    await speechSettings.getByRole('radiogroup', { name: 'TTS 朗读方式' }).getByRole('radio', { name: '系统朗读', exact: true }).check();
    await speechSettings.getByRole('switch', { name: '自动朗读 Agent 回复' }).click();
    const cloudBeforeSystem = syntheses.length;
    await orb().click(); await panel().waitFor(); await submitSpeechTest('本机朗读验证');
    await page.waitForFunction(() => window.__systemSpeaks.length === 1);
    assert.equal(await page.evaluate(() => window.__systemSpeaks[0].text), '已完成：本机朗读验证');
    assert.equal(syntheses.length, cloudBeforeSystem); await stopReading();
    assert.deepEqual(failures, []);
    console.log('PASS: float interaction and session regressions; configured ASR/TTS routing and voice; automatic read-once and history isolation; playback cancellation and echo prevention; long-reply chunking; synthesis/autoplay recovery; no media or task side effects.');
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
