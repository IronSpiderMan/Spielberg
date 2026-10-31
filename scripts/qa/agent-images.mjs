import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../../src/agentImages.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { generatedImages, conversationImages } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const asset = { id: 7, kind: 'image', path: '/current/image.png', name: '图片', created_at: '' };
const media = new Map([[7, asset]]);
const generation = content => ({ role: 'tool', tool_name: 'app_action', status: 'completed', arguments: { operation: 'generations/image', data: { image_media_ids: [7] } }, content: JSON.stringify(content) });
assert.deepEqual(generatedImages(generation({ data: { ...asset, path: '/old/image.png' }, truncated: true }), media), [asset]);
assert.deepEqual(generatedImages(generation({ media_id: 7 }), media), [asset]);
assert.deepEqual(generatedImages(generation({ data: JSON.stringify(asset) }), media), [asset]);
for (const status of ['running', 'failed', 'skipped']) assert.deepEqual(generatedImages({ ...generation(asset), status }, media), []);
assert.deepEqual(generatedImages({ ...generation(asset), tool_name: 'app_describe' }, media), []);
assert.deepEqual(generatedImages(generation({ error: 'failed' }), media), []);
assert.deepEqual(generatedImages(generation({ id: 7, kind: 'task', status: 'queued' }), media), []);
assert.deepEqual(generatedImages({ ...generation(asset), content: 'invalid JSON' }, media), []);
const messages = [
  { role: 'user', content: '', images: ['data:image/png;base64,AA'], image_media_ids: [7] },
  generation(asset), generation(asset),
  { role: 'user', content: '', images: ['data:image/png;base64,BB'] },
  { role: 'assistant', content: '![结果](https://example.com/image.png)' },
];
const gallery = conversationImages(messages, media);
assert.equal(gallery.length, 3);
assert.equal(gallery[0], asset);
assert.equal(gallery[1].preview_url, messages[3].images[0]);
assert.equal(gallery[2].preview_url, 'https://example.com/image.png');
assert.deepEqual(conversationImages([], media), []);
console.log('Agent image extraction and conversation gallery checks passed.');
