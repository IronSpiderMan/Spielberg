// Reuse the existing isolated domain fixtures behind the new HTTP transport.
// Only OS dialogs retain a mocked Tauri invocation; application data uses fetch.
module.exports = async function installHttpFixture(page) {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (!url.pathname.startsWith('/api/v1/')) return original(input, init);
      const route = url.pathname.slice('/api/v1'.length);
      const method = init.method || 'GET';
      let payload = init.body ? JSON.parse(init.body) : {};
      let path = route;
      if (path.startsWith('/actions/')) path = path.slice('/actions'.length);
      else {
        const parts = path.split('/').filter(Boolean);
        if (parts[0] === 'projects' && parts.length >= 3) {
          payload.project_id = parts[1];
          const resource = parts[2] === 'assets' ? 'media' : parts[2];
          path = `/${resource}`;
          if (parts[3]) {
            payload.id = Number(parts[3]);
            path += method === 'DELETE' ? '/delete' : method === 'PATCH' ? resource === 'media' ? '/rename' : '/update' : '';
          } else if (resource === 'media' && method === 'GET') {
            path = '/media/list';
            for (const [key,value] of url.searchParams) payload[key] = ['page','limit'].includes(key) ? Number(value) : value;
          }
        }
      }
      try {
        const data = await window.__TAURI_INTERNALS__.invoke('api_request', { path, method, payload });
        return new Response(JSON.stringify({ data: data ?? null }), { status: 200, headers: {'Content-Type': 'application/json'} });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: {'Content-Type': 'application/json'} });
      }
    };
  });
  await page.route('**/media?*', async route => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get('path');
    if (path === '/spielberg-logo-s.png') await route.fulfill({status:302,headers:{Location:'/spielberg-logo-s.png'}});
    else await route.fulfill({status:404,body:''});
  });
};
