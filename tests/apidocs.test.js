import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { buildCatalog, openapi } from '../server/modules/system/apidocs/render.js';
import { EXAMPLES, ERROR_CODES } from '../server/modules/system/apidocs/catalog.js';

test('tài liệu API: mọi route đang chạy đều có mô tả, không có mô tả thừa', async () => {
  const { app } = await setup();
  const { missing, stale, groups } = buildCatalog(app);
  assert.deepEqual(missing, [], `Route chưa có mô tả trong apidocs/catalog.js: ${missing.join(', ')}`);
  assert.deepEqual(stale, [], `Mô tả cho route không còn tồn tại: ${stale.join(', ')}`);
  assert.ok(groups.every((g) => g.items.length > 0), 'nhóm nào cũng có route');
  for (const key of Object.keys(EXAMPLES)) assert.ok(groups.some((g) => g.items.some((r) => `${r.method} ${r.path}` === key)), `ví dụ cho route không tồn tại: ${key}`);
});

test('tài liệu API: OpenAPI hợp lệ cơ bản, trang HTML dựng được và có phần hướng dẫn', async () => {
  const { app } = await setup();
  const spec = openapi(app, 'http://x');
  assert.equal(spec.openapi, '3.0.3');
  assert.ok(spec.tags.length >= 15);
  const op = spec.paths['/api/v1/orders'].post;
  assert.ok(op.summary && op.requestBody.content['application/json'].example.lines);
  assert.ok(spec.paths['/api/v1/orders/{id}'].get.parameters.some((p) => p.name === 'id' && p.in === 'path'));
  assert.equal(spec.paths['/api/v1/system/api-keys'].get['x-session-only'], true);
  const res = await app.fetch(new Request('http://test/api/v1/docs'));
  assert.equal(res.status, 200);
  const html = await res.text();
  for (const s of ['Xác thực', 'Quy ước chung', 'X-Moso-Signature', 'Chốt kỳ kho', 'Idempotency-Key']) assert.ok(html.includes(s), s);
  for (const [code] of ERROR_CODES) assert.ok(html.includes(code), code);
});
