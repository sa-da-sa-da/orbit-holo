// Cloudflare Worker：静态资源 + R2 目录 API + 定时刷新触发
// 部署：npx wrangler deploy（wrangler.toml 已配置 assets / R2 / cron）
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // —— /api/health ——
    if (url.pathname === '/api/health') {
      const meta = await readJson(env, 'meta.json');
      if (meta) return jsonResponse(meta);
      // R2 还没有 meta.json → 用随包发布的静态 meta
      const fb = await env.ASSETS.fetch(new Request(new URL('/data/meta.json', url), request));
      if (fb.ok) {
        return new Response(await fb.text(), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
        });
      }
      return jsonResponse({ ok: false, error: 'catalog_unavailable' }, 503);
    }

    // —— /api/catalog ——
    if (url.pathname === '/api/catalog') {
      const obj = await env.CATALOG.get('catalog.json.gz');
      if (!obj) {
        // R2 还没数据：回退到随包发布的静态快照（务必以「已压缩 + JSON」返回，浏览器自动解压）
        const fallback = await env.ASSETS.fetch(new Request(new URL('/data/catalog.json.gz', url), request));
        if (fallback.ok) {
          return new Response(await fallback.arrayBuffer(), {
            headers: {
              'Content-Type': 'application/json',
              'Content-Encoding': 'gzip',
              'Cache-Control': 'public, max-age=600',
              'Access-Control-Allow-Origin': '*',
              'X-Data-Source': 'assets',
            },
          });
        }
        return jsonResponse({ ok: false, error: 'catalog_unavailable' }, 503);
      }
      const etag = obj.httpEtag || obj.etag || '';
      if (etag && request.headers.get('if-none-match') === etag) return new Response(null, { status: 304 });
      const headers = new Headers(obj.httpMetadata);
      headers.set('Content-Type', 'application/json');
      headers.set('Content-Encoding', 'gzip');
      headers.set('Cache-Control', 'public, max-age=600, stale-while-revalidate=3600');
      headers.set('Access-Control-Allow-Origin', '*');
      if (etag) headers.set('ETag', etag);
      headers.set('X-Data-Source', 'r2');
      return new Response(obj.body, { headers });
    }

    // —— /api/refresh：触发 GitHub Actions 重新构建数据（需 ADMIN_TOKEN） ——
    if (url.pathname === '/api/refresh') {
      if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
      const token = request.headers.get('x-admin-token') || '';
      if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
      if (!env.GITHUB_REPO || !env.GITHUB_TOKEN) return jsonResponse({ ok: false, error: 'refresh_not_configured' }, 501);
      const r = await fetch('https://api.github.com/repos/' + env.GITHUB_REPO + '/actions/workflows/refresh-data.yml/dispatches', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + env.GITHUB_TOKEN,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'orbital-mirror-worker',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
      });
      return jsonResponse({ ok: r.ok, status: r.status }, r.ok ? 202 : 502);
    }

    // 其它路径 → 静态资源（Workers Static Assets）
    return env.ASSETS.fetch(request);
  },

  // cron：每 6 小时触发一次数据重建（走 GitHub Actions，避免 Worker CPU 限制）
  async scheduled(event, env, ctx) {
    if (!env.GITHUB_REPO || !env.GITHUB_TOKEN) return;
    ctx.waitUntil(fetch('https://api.github.com/repos/' + env.GITHUB_REPO + '/actions/workflows/refresh-data.yml/dispatches', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.GITHUB_TOKEN,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'orbital-mirror-worker',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main' }),
    }));
  },
};

async function readJson(env, key) {
  const obj = await env.CATALOG.get(key);
  if (!obj) return null;
  try { return JSON.parse(await obj.text()); } catch (e) { return null; }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
  });
}
