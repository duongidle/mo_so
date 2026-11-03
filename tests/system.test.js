import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { setup } from './helpers.js';
import { getDb } from '../server/db/index.js';
import { config } from '../server/lib/config.js';
import { processDue, sign, MAX_ATTEMPTS } from '../server/jobs/webhooks.js';
import { runBackup, pruneBackups, listBackups, backupDir } from '../server/jobs/backup.js';
import { EVENT_TYPES } from '../server/modules/system/events.js';

test('M11: API key chỉ hiện 1 lần, thu hồi được, key không tự cấp quyền', async () => {
  const { api, app } = await setup();
  const k = await api.post('/system/api-keys', { name: 'Kế toán', scopes: ['read'] });
  assert.equal(k.status, 201);
  assert.match(k.body.data.key, /^tk_live_/);
  const list = (await api.get('/system/api-keys')).body.data;
  assert.equal(list[0].key, undefined, 'danh sách không lộ khoá');

  const bearer = (key, method = 'GET', path = '/shops') =>
    app.fetch(new Request(`http://test/api/v1${path}`, { method, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' }));
  assert.equal((await bearer(k.body.data.key)).status, 200);
  assert.equal((await bearer(k.body.data.key, 'POST', '/shops')).status, 403, 'key chỉ đọc không ghi được');
  assert.equal((await bearer(k.body.data.key, 'POST', '/system/api-keys')).status, 403);
  assert.equal((await bearer(k.body.data.key, 'GET', '/system/backups')).status, 403, 'key không được tải sao lưu');

  await api.delete(`/system/api-keys/${k.body.data.id}`);
  assert.equal((await bearer(k.body.data.key)).status, 401);
});

test('M11: webhook ký HMAC, retry theo lịch, hết lượt thì dead, gửi lại được', async () => {
  const { api, nh } = await setup();
  assert.equal((await api.post('/system/webhooks', { name: 'x', url: 'ftp://a.b' })).status, 400);
  const hk = await api.post('/system/webhooks', { name: 'Kế toán', url: 'https://example.test/hook', event_types: ['customer.*'] });
  assert.equal(hk.status, 201);
  assert.match(hk.body.data.secret, /^whsec_/);
  assert.ok(!(await api.get('/system/webhooks')).body.data[0].secret.startsWith(hk.body.data.secret), 'secret bị che sau lần tạo');

  await api.post('/customers', { name: 'Khách A', phone: '0911111111' });
  await api.post('/shops', { code: 'ZZ', name: 'Không liên quan' }); // sự kiện shop.* không khớp bộ lọc
  const deliveries = () => getDb().prepare('SELECT * FROM webhook_deliveries').all();
  assert.equal(deliveries().length, 1);

  const calls = [];
  const ok = async (url, init) => (calls.push({ url, init }), { ok: true, status: 200 });
  const res = await processDue({ fetchImpl: ok });
  assert.equal(res[0].status, 'success');
  const { init } = calls[0];
  assert.equal(init.headers['x-moso-event'], 'customer.created');
  assert.equal(init.headers['x-moso-signature'], sign(hk.body.data.secret, init.body), 'chữ ký khớp secret gốc');
  assert.equal(JSON.parse(init.body).data.name, 'Khách A');

  // Thất bại: lên lịch retry, chưa đến hạn thì không gửi lại
  await api.post('/customers', { name: 'Khách B', phone: '0922222222' });
  const fail = async () => ({ ok: false, status: 500 });
  assert.equal((await processDue({ fetchImpl: fail }))[0].status, 'failed');
  assert.equal((await processDue({ fetchImpl: fail })).length, 0, 'chưa đến hạn retry');
  // Ép đến hạn nhiều lần → dead sau MAX_ATTEMPTS
  for (let i = 1; i < MAX_ATTEMPTS; i++) {
    getDb().prepare("UPDATE webhook_deliveries SET next_attempt_at = '2000-01-01T00:00:00.000Z' WHERE status = 'failed'").run();
    await processDue({ fetchImpl: fail });
  }
  const dead = getDb().prepare("SELECT * FROM webhook_deliveries WHERE status = 'dead'").get();
  assert.equal(dead.attempts, MAX_ATTEMPTS);
  const logs = (await api.get(`/system/webhooks/${hk.body.data.id}/deliveries?status=dead`)).body.data;
  assert.equal(logs.length, 1);
});

test('M11: mọi sự kiện code phát ra đều có trong danh sách; docs API', async () => {
  const src = fs.readdirSync('server/modules').flatMap((d) => fs.readdirSync(path.join('server/modules', d)).map((f) => path.join('server/modules', d, f)));
  const emitted = new Set();
  for (const f of src) if (f.endsWith('.js')) for (const m of fs.readFileSync(f, 'utf8').matchAll(/emit\('([a-z_.]+)'/g)) emitted.add(m[1]);
  for (const t of emitted) assert.ok(EVENT_TYPES.includes(t), `thiếu ${t} trong EVENT_TYPES`);

  const { app } = await setup();
  const spec = await (await app.fetch(new Request('http://test/api/v1/docs/openapi.json'))).json();
  assert.ok(spec.paths['/api/v1/orders/{id}']);
  assert.equal((await app.fetch(new Request('http://test/api/v1/docs'))).status, 200);
});

test('M12: sao lưu đọc lại được, giữ 14 ngày + 8 tuần, tải bản sao lưu, xuất CSV', async () => {
  const { api } = await setup();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moso-bk-'));
  const prev = config.dataDir;
  config.dataDir = dir;
  try {
    await api.post('/customers', { name: 'Khách "dấu ngoặc", phẩy', phone: '0933333333' });
    const b = await runBackup();
    assert.ok(b.size > 0);
    const Database = (await import('better-sqlite3')).default;
    const copy = new Database(b.file, { readonly: true });
    assert.equal(copy.prepare('SELECT COUNT(*) n FROM customers').get().n, 1);
    copy.close();

    // Dọn: tạo 100 file giả mỗi ngày một bản
    fs.mkdirSync(backupDir(), { recursive: true });
    const now = new Date('2026-11-03T05:00:00Z');
    for (let i = 1; i <= 100; i++) {
      const d = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10).replaceAll('-', '');
      fs.writeFileSync(path.join(backupDir(), `moso-${d}-0900.db`), 'x');
    }
    pruneBackups(now);
    const names = listBackups().map((x) => x.name);
    assert.ok(names.length >= 14 && names.length <= 14 + 8 + 1, `còn ${names.length} bản`);
    assert.ok(names.includes('moso-20261102-0900.db'), 'giữ bản hôm qua');
    assert.ok(!names.includes('moso-20260701-0900.db'), 'xoá bản quá cũ');

    const dl = await api.get('/system/backups/..%2F..%2Fetc%2Fpasswd');
    assert.equal(dl.status, 404, 'chặn path traversal');
  } finally {
    config.dataDir = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const csv = (await api.get('/system/export/customers.csv')).body;
  assert.match(csv, /"Khách ""dấu ngoặc"", phẩy"/, 'CSV escape đúng');
  assert.equal((await api.get('/system/export/users')).status, 400, 'không xuất bảng bảo mật');
});
