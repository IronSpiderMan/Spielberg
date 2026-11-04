// Exercise the actual loading effect without a browser or real project files.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('src/AssetLibrary.tsx', 'utf8');
const effect = source.match(/useEffect\(\(\)=>\{\n    const id=\+\+request.current;([\s\S]*?)\n  \},\[pid,kind,search,filter,page,version/);
assert(effect, 'Media library must have a loading effect');
const body = 'const id=++request.current;' + effect[1].replace('post<{items:Asset[];total:number}>', 'post');
function fixture(post, page = 1) {
  const state = { loading: true, error: '', items: [], total: 0, page };
  const request = { current: 0 }, paging = { current: false };
  const run = new Function('post', 'request', 'paging', 'pid', 'kind', 'search', 'filter', 'page', 'setLoading', 'setError', 'setPage', 'setItems', 'setTotal', body);
  const cleanup = run(post, request, paging, 'fixture', 'image', 'test', 'unused', page,
    ...['loading', 'error', 'page', 'items', 'total'].map(key => value => { state[key] = value; }));
  return { state, cleanup, paging };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('loads media with pagination and filters and ends loading', async () => {
  const f = fixture(async (path, payload) => {
    assert.equal(path, '/media/list');
    assert.deepEqual(payload, { project_id: 'fixture', kind: 'image', query: 'test', usage: 'unused', page: 1, limit: 24 });
    return { items: [{ id: 7 }], total: 1 };
  });
  await settle();
  assert.deepEqual(f.state.items, [{ id: 7 }]);
  assert.equal(f.state.total, 1);
  assert.equal(f.state.loading, false);
  assert.equal(f.paging.current, false);
});
test('failure ends loading and exposes error for retry', async () => {
  const f = fixture(async () => { throw Error('offline'); });
  await settle();
  assert.match(f.state.error, /offline/);
  assert.equal(f.state.loading, false);
});
test('ignores stale results after cleanup', async () => {
  let resolve;
  const f = fixture(() => new Promise(r => { resolve = r; }));
  f.cleanup();
  resolve({ items: [{ id: 9 }], total: 1 });
  await settle();
  assert.deepEqual(f.state.items, []);
});
test('returns to the last valid page when items are removed', async () => {
  const f = fixture(async () => ({ items: [], total: 25 }), 3);
  await settle();
  assert.equal(f.state.page, 2);
});
