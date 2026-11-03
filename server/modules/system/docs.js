import { Hono } from 'hono';

/** OpenAPI tối giản dựng từ chính danh sách route đang chạy — luôn khớp code, không phải viết tay. */
export function docsRoutes(getApp) {
  const r = new Hono();
  const paths = () => {
    const out = {};
    for (const rt of getApp().routes) {
      if (!rt.path.startsWith('/api/v1') || rt.method === 'ALL') continue;
      const p = rt.path.replace(/:([A-Za-z_]+)/g, '{$1}').replace(/\/$/, '') || '/';
      const method = rt.method.toLowerCase();
      out[p] ||= {};
      out[p][method] ||= {
        summary: `${rt.method} ${p.replace('/api/v1', '')}`,
        parameters: [...p.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } })),
        responses: { 200: { description: 'OK' }, 400: { description: 'VALIDATION_ERROR' }, 401: { description: 'UNAUTHORIZED' } },
      };
    }
    return out;
  };
  r.get('/openapi.json', (c) =>
    c.json({
      openapi: '3.0.3',
      info: { title: 'Mở Sổ API', version: '1.0.0', description: 'Xác thực: cookie phiên hoặc `Authorization: Bearer tk_live_…`. Lỗi: {"error":{"code","message","details"}}. POST tạo đơn/phiếu nhập hỗ trợ header Idempotency-Key. Phân trang: ?limit&cursor.' },
      servers: [{ url: '/' }],
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
      security: [{ bearer: [] }],
      paths: paths(),
    }),
  );
  r.get('/', (c) => {
    const rows = Object.entries(paths())
      .flatMap(([p, ms]) => Object.keys(ms).map((m) => [m.toUpperCase(), p]))
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([m, p]) => `<tr><td><b>${m}</b></td><td><code>${p}</code></td></tr>`)
      .join('');
    return c.html(`<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mở Sổ API</title>
<style>body{font:15px/1.5 system-ui;background:#EDE3D2;color:#301F12;max-width:860px;margin:0 auto;padding:24px 16px}table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #CDB58D;padding:6px 8px}code{color:#633D37}h1{font-family:Georgia,serif}</style>
<h1>Mở Sổ — API v1</h1><p>Xác thực bằng <code>Authorization: Bearer tk_live_…</code> (tạo trong Cài đặt → API key). Đặc tả máy đọc: <a href="/api/v1/docs/openapi.json">openapi.json</a>.</p>
<p>Lỗi trả dạng <code>{"error":{"code","message","details"}}</code>. Gửi <code>Idempotency-Key</code> khi tạo đơn/phiếu nhập để chống trùng. Phân trang con trỏ: <code>?limit=50&amp;cursor=…</code></p>
<table>${rows}</table></html>`);
  });
  return r;
}
