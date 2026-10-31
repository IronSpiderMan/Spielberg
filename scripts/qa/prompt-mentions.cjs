// Pure regression checks; no projects or generation services are accessed.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const {buildSync} = require('esbuild');
const bundled = buildSync({
  stdin: {contents: 'export * from "./src/prompt-mentions"; export * from "./src/resolve-prompt";', resolveDir: path.resolve(__dirname, '../..')},
  bundle: true, platform: 'node', format: 'cjs', write: false,
});
const compiled = new Module(__filename);
compiled._compile(bundled.outputFiles[0].text, __filename);
const {promptMentions, findMentions, resolveReferencePrompt, resolvePrompt, resolveH3Prompt, syncMentionReferences} = compiled.exports;
const main = {id: 1, name: '主图.png', kind: 'image'};
const detail = {id: 2, name: 'xx.png', kind: 'image'};
const roles = [{id: 1, name: '角色', description: '角色设定', design_media_id: 1, images: [main, detail]}];
const data = {roles, media: [main, detail], episodes: []};
const items = promptMentions(roles, data);
const ids = value => findMentions(value, items).map(item => item.media.id);
assert.deepEqual(ids('@角色.xx'), [2]);
assert.deepEqual(ids('@角色.xx，转身'), [2]);
assert.deepEqual(ids('@角色.xx @角色.xx'), [2]);
assert.deepEqual(ids('@角色 @角色.xx'), [1, 2]);
assert.deepEqual(ids('@角色.未知'), []);
assert.deepEqual(ids('@角色.x'), []);
assert.deepEqual(ids('@角色.xx.more'), []);
assert.deepEqual(ids('@角色. 接下来的句子'), [1]);
assert.deepEqual(ids('@角色。转身'), [1]);
assert.equal(resolvePrompt('@角色.xx', roles), '@角色.xx');
assert.equal(resolveReferencePrompt('@角色.xx', data), '角色.xx（角色 · xx.png）');
// Typing a qualified reference must replace the previously automatic main image.
let selection = syncMentionReferences([99], [], ids('@角色'));
assert.deepEqual(selection.ids, [99, 1]);
selection = syncMentionReferences(selection.ids, selection.automatic, ids('@角色.xx'));
assert.deepEqual(selection.ids, [99, 2]);
selection = syncMentionReferences(selection.ids, selection.automatic, []);
assert.deepEqual(selection.ids, [99]);
// Explicitly selected main images survive changes to the prompt.
selection = syncMentionReferences([1], [], ids('@角色'));
selection = syncMentionReferences(selection.ids, selection.automatic, ids('@角色.xx'));
assert.deepEqual(selection.ids, [1, 2]);
assert.equal(syncMentionReferences([1,2,3,4,5,6,7,8,9], [], [10]).ids.length, 9);
// Disabled roles cannot be suggested, resolved, or reintroduced by asset aliases.
const disabledRoles = [{...roles[0], enabled: false}];
const disabledData = {...data, roles: disabledRoles, prompts: [], media: [...data.media,
  {id: 3, name: '角色.png', kind: 'image'}, {id: 4, name: '角色.xx.png', kind: 'image'}]};
const disabledItems = promptMentions(disabledRoles, disabledData);
assert(!disabledItems.some(item => item.kind === 'role'));
assert.deepEqual(findMentions('@角色 @角色.xx', disabledItems), []);
assert.equal(resolvePrompt('@角色 @角色.xx', disabledRoles), '@角色 @角色.xx');
assert.equal(resolveReferencePrompt('@角色 @角色.xx', disabledData), '@角色 @角色.xx');
assert.equal(resolveH3Prompt('@角色 @角色.xx', disabledData, [1,2]), '@角色 @角色.xx');
assert(findMentions('@xx', disabledItems).some(item => item.media.id === 2));
const enabledRoles = [{...roles[0], enabled: true}];
assert.equal(findMentions('@角色 @角色.xx', promptMentions(enabledRoles, data)).length, 2);
assert.equal(resolvePrompt('@角色', enabledRoles), '角色（角色设定）');
const mixedRoles = [...disabledRoles, {id: 2, name: '配角', description: '', images: [], enabled: true}];
assert.deepEqual(promptMentions(mixedRoles).map(item => item.name), ['配角']);
console.log('Prompt mention regression checks passed.');
