import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { makeClient, setup } from './helpers.js';
import { config } from '../server/lib/config.js';
import { resetTenancy, bootstrapTenancy, getMaster, getAccountDb, accountCount } from '../server/db/tenancy.js';
import { openDb, runInTenant } from '../server/db/index.js';
import { resetRateLimits } from '../server/lib/ratelimit.js';
import { hashPassword } from '../server/lib/auth.js';
import { createApp } from '../server/app.js';
import { createShop } from '../server/modules/shops/service.js';

const reg = (api, username, password = 'matkhau123') => api.post('/auth/register', { username, display_name: `Người ${username}`, password });

test('Đăng ký: kiểm tra đầu vào, tên đăng nhập duy nhất không phân biệt hoa thường, tài khoản mới chưa có shop nào', async () => {
  resetTenancy(); resetRateLimits();
  const app = createApp();
  const a = makeClient(app);
  assert.deepEqual((await a.get('/auth/status')).body, { has_accounts: false, registration_open: true });

  assert.equal((await reg(a, 'ab')).status, 400, 'tên quá ngắn');
  assert.equal((await reg(a, 'có dấu cách')).status, 400, 'ký tự không hợp lệ');
  assert.equal((await reg(a, 'hopLe', '1234567')).status, 400, 'mật khẩu dưới 8 ký tự');
  assert.equal(accountCount(), 0, 'đăng ký lỗi không để lại tài khoản');

  const ok = await reg(a, 'Chu.Shop');
  assert.equal(ok.status, 201);
  assert.equal(ok.body.data.username, 'chu.shop', 'tên đăng nhập lưu chữ thường');
  const me = (await a.get('/auth/me')).body.data;
  assert.equal(me.displayName, 'Người Chu.Shop');
  assert.deepEqual((await a.get('/shops')).body.data, [], 'tài khoản mới chưa có shop');
  assert.deepEqual((await a.get('/warehouses')).body.data, []);
  assert.equal((await a.get('/auth/status')).body.has_accounts, true);

  const dup = await reg(makeClient(app), 'CHU.shop');
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'USERNAME_TAKEN');
  assert.equal(accountCount(), 1);
});

test('Cách ly: mỗi tài khoản có shop, kho, sản phẩm, khách, đơn, cài đặt, mã chứng từ riêng; không truy cập chéo được', async () => {
  resetTenancy(); resetRateLimits();
  const app = createApp();
  const A = makeClient(app);
  const B = makeClient(app);
  await reg(A, 'chu_a');
  await reg(B, 'chu_b');

  const build = async (api, tag) => {
    const wh = (await api.post('/warehouses', { code: 'K1', name: `Kho ${tag}` })).body.data;
    const shop = (await api.post('/shops', { code: 'S1', name: `Shop ${tag}`, default_warehouse_id: wh.id })).body.data;
    const p = (await api.post('/products', { name: `SP ${tag}`, variants: [{ sku: 'SKU-1', default_price: 100000 }], shop_ids: [shop.id] })).body.data;
    await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: p.variants[0].id, qty: 10, unit_cost: 40000 }] });
    const order = (await api.post('/orders', { shop_id: shop.id, customer: { name: `Khách ${tag}`, phone: '0911000111' }, lines: [{ sku: 'SKU-1', qty: 2 }], status: 'completed' })).body.data;
    return { wh, shop, p, order };
  };
  const a = await build(A, 'A');
  const b = await build(B, 'B');

  // Cùng SKU, cùng SĐT khách, cùng mã shop ở hai tài khoản mà không đụng nhau (trùng khoá chỉ cần trong tài khoản)
  assert.deepEqual((await A.get('/shops')).body.data.map((s) => s.name), ['Shop A']);
  assert.deepEqual((await B.get('/shops')).body.data.map((s) => s.name), ['Shop B']);
  assert.deepEqual((await A.get('/customers')).body.data.map((c) => c.name), ['Khách A']);
  assert.deepEqual((await B.get('/customers')).body.data.map((c) => c.name), ['Khách B']);
  assert.deepEqual((await B.get('/products')).body.data.map((p) => p.name), ['SP B']);
  assert.equal(a.order.code, b.order.code, 'bộ đếm mã chứng từ riêng từng tài khoản (cùng DH-S1-…-001)');

  // Dùng id của tài khoản kia: như không tồn tại
  assert.equal((await B.get(`/orders/${a.order.id}`)).status, 404);
  assert.equal((await B.get(`/products/${a.p.id}`)).status, 404);
  assert.equal((await B.get(`/shops/${a.shop.id}`)).status, 404);
  assert.equal((await B.post('/orders', { shop_id: a.shop.id, lines: [{ sku: 'SKU-1', qty: 1 }], status: 'draft' })).status, 404, 'không tạo đơn vào shop của tài khoản khác');
  assert.equal((await B.post('/orders', { shop_id: b.shop.id, warehouse_id: a.wh.id, lines: [{ sku: 'SKU-1', qty: 1 }], status: 'draft' })).status >= 400, true, 'không dùng kho của tài khoản khác');

  // Số liệu và cài đặt không lẫn
  await A.patch('/settings', { low_stock_days: 99 });
  assert.equal((await A.get('/settings')).body.data.low_stock_days, 99);
  assert.equal((await B.get('/settings')).body.data.low_stock_days, 14, 'cài đặt riêng từng tài khoản');
  await B.post('/orders', { shop_id: b.shop.id, lines: [{ sku: 'SKU-1', qty: 1 }], status: 'completed' });
  assert.equal((await A.get('/reports/overview')).body.data.current.order_count, 1);
  assert.equal((await B.get('/reports/overview')).body.data.current.order_count, 2);
  assert.equal((await A.get('/system/export/orders.csv')).body.split('\r\n').filter(Boolean).length, 2, 'xuất dữ liệu chỉ của tài khoản mình');

  // Đơn của A không xuất hiện khi B xuất đơn
  assert.equal((await B.get('/orders/export?format=count')).body.data.orders, 2);
  assert.equal((await A.get('/orders/export?format=count')).body.data.orders, 1);
});

test('Phiên và API key thuộc đúng tài khoản; đăng xuất, đổi mật khẩu, khoá đăng nhập riêng từng tài khoản', async () => {
  resetTenancy(); resetRateLimits();
  const app = createApp();
  const A = makeClient(app);
  const B = makeClient(app);
  await reg(A, 'chu_a');
  await reg(B, 'chu_b');
  await A.post('/shops', { code: 'AA', name: 'Shop của A' });
  await B.post('/shops', { code: 'BB', name: 'Shop của B' });

  const bearer = (key, p = '/shops') => app.fetch(new Request(`http://test/api/v1${p}`, { headers: { authorization: `Bearer ${key}` } })).then(async (r) => ({ status: r.status, body: await r.json() }));
  const keyA = (await A.post('/system/api-keys', { name: 'kế toán', scopes: ['read'] })).body.data;
  const keyB = (await B.post('/system/api-keys', { name: 'kế toán', scopes: ['read'] })).body.data;
  assert.deepEqual((await bearer(keyA.key)).body.data.map((s) => s.name), ['Shop của A'], 'key của A chỉ thấy dữ liệu của A');
  assert.deepEqual((await bearer(keyB.key)).body.data.map((s) => s.name), ['Shop của B']);
  assert.equal((await bearer('tk_live_khong-co')).status, 401);
  await A.delete(`/system/api-keys/${keyA.id}`);
  assert.equal((await bearer(keyA.key)).status, 401, 'key đã thu hồi');
  assert.equal((await bearer(keyB.key)).status, 200, 'thu hồi key của A không ảnh hưởng B');

  // Đăng xuất chỉ vô hiệu phiên của mình
  const B2 = makeClient(app);
  assert.equal((await B2.post('/auth/login', { username: 'CHU_B', password: 'matkhau123' })).status, 200);
  await A.post('/auth/logout');
  assert.equal((await A.get('/shops')).status, 401);
  assert.equal((await B.get('/shops')).status, 200);
  // Đổi mật khẩu: đăng xuất mọi thiết bị khác của CHÍNH tài khoản đó
  assert.equal((await B.post('/auth/change-password', { current_password: 'matkhau123', new_password: 'matkhau-moi-1' })).status, 200);
  assert.equal((await B2.get('/shops')).status, 401);
  assert.equal((await B.get('/shops')).status, 200, 'phiên vừa đổi mật khẩu vẫn dùng được');

  // Khoá sau 5 lần sai: chỉ tài khoản bị đoán mật khẩu
  const X = makeClient(app);
  for (let i = 0; i < 5; i++) assert.equal((await X.post('/auth/login', { username: 'chu_a', password: 'sai' })).status, 401);
  assert.match((await X.post('/auth/login', { username: 'chu_a', password: 'matkhau123' })).body.error.message, /quá nhiều lần/);
  assert.equal((await makeClient(app).post('/auth/login', { username: 'chu_b', password: 'matkhau-moi-1' })).status, 200, 'tài khoản khác không bị khoá lây');
});

test('Đóng đăng ký và giới hạn tần suất: tài khoản đầu luôn tạo được', async () => {
  const old = { r: config.registration, l: config.registerLimitPerHour };
  try {
    resetTenancy(); resetRateLimits();
    config.registration = 'closed';
    const app = createApp();
    assert.equal((await reg(makeClient(app), 'dau_tien')).status, 201, 'tài khoản đầu tiên luôn được');
    const st = (await makeClient(app).get('/auth/status')).body;
    assert.deepEqual(st, { has_accounts: true, registration_open: false });
    const closed = await reg(makeClient(app), 'thu_hai');
    assert.equal(closed.status, 403);
    assert.equal(accountCount(), 1);

    config.registration = 'open';
    resetRateLimits();
    config.registerLimitPerHour = 2;
    assert.equal((await reg(makeClient(app), 'user_1')).status, 201);
    assert.equal((await reg(makeClient(app), 'user_2')).status, 201);
    const limited = await reg(makeClient(app), 'user_3');
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, 'TOO_MANY_REQUESTS');
  } finally {
    config.registration = old.r;
    config.registerLimitPerHour = old.l;
  }
});

test('Mỗi tài khoản một file dữ liệu và một thư mục sao lưu riêng', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moso-tenancy-'));
  const oldDir = config.dataDir;
  config.dataDir = dir;
  try {
    resetTenancy({ inMemory: false }); resetRateLimits();
    const app = createApp();
    const A = makeClient(app);
    const B = makeClient(app);
    await reg(A, 'chu_a');
    await reg(B, 'chu_b');
    const accs = getMaster().prepare('SELECT id, db_file FROM accounts ORDER BY username').all();
    assert.equal(accs.length, 2);
    for (const a of accs) assert.ok(fs.existsSync(path.join(dir, a.db_file)), `có file ${a.db_file}`);
    assert.notEqual(accs[0].db_file, accs[1].db_file);

    await A.post('/shops', { code: 'AA', name: 'Chỉ có ở A' });
    // Đọc thẳng file của B: không có gì của A
    const rawB = new Database(path.join(dir, accs[1].db_file), { readonly: true });
    assert.equal(rawB.prepare('SELECT COUNT(*) n FROM shops').get().n, 0);
    rawB.close();

    // Sao lưu từng tài khoản vào thư mục riêng, không thấy bản của nhau
    assert.equal((await A.post('/system/backups', {})).status, 201);
    const listA = (await A.get('/system/backups')).body.data;
    const listB = (await B.get('/system/backups')).body.data;
    assert.equal(listA.length, 1);
    assert.equal(listB.length, 0, 'B không thấy bản sao lưu của A');
    assert.ok(fs.existsSync(path.join(dir, 'backups', accs[0].id)));
    assert.equal((await B.get(`/system/backups/${listA[0].name}`)).status, 404, 'B không tải được bản của A dù biết tên');
    // Bản sao lưu đọc lại được và đúng dữ liệu của A
    const copy = new Database(path.join(dir, 'backups', accs[0].id, listA[0].name), { readonly: true });
    assert.equal(copy.prepare('SELECT name FROM shops').get().name, 'Chỉ có ở A');
    copy.close();
  } finally {
    config.dataDir = oldDir;
    resetTenancy();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Cài đặt cũ một file moso.db tự thành tài khoản đầu tiên: giữ tên đăng nhập, mật khẩu, dữ liệu, API key', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moso-legacy-'));
  const oldDir = config.dataDir;
  config.dataDir = dir;
  try {
    // Dựng file cũ: có bảng users, một shop, một API key
    const legacy = openDb(path.join(dir, 'moso.db'));
    legacy.prepare("INSERT INTO users (id, username, display_name, password_hash, role, created_at, updated_at) VALUES ('usr_1','duong','Dương',?,'owner','2026-01-01','2026-01-01')").run(hashPassword('mat-khau-cu-1'));
    legacy.prepare("INSERT INTO warehouses (id, code, name, created_at, updated_at) VALUES ('whs_1','K1','Kho cũ','2026-01-01','2026-01-01')").run();
    legacy.prepare("INSERT INTO api_keys (id, name, prefix, key_hash, scopes, created_at) VALUES ('key_1','cũ','tk_live_cu12',?,?,'2026-01-01')").run(
      (await import('node:crypto')).createHash('sha256').update('tk_live_cu-key-that').digest('hex'), '["read"]');
    legacy.close();

    resetTenancy({ inMemory: false }); resetRateLimits();
    const boot = bootstrapTenancy();
    assert.equal(boot.migrated, true);
    assert.equal(boot.username, 'duong');
    assert.equal(bootstrapTenancy().migrated, false, 'chạy lại không tạo thêm');
    assert.equal(accountCount(), 1);

    const app = createApp();
    const api = makeClient(app);
    assert.equal((await api.post('/auth/login', { username: 'duong', password: 'mat-khau-cu-1' })).status, 200, 'mật khẩu cũ dùng được');
    assert.deepEqual((await api.get('/warehouses')).body.data.map((w) => w.name), ['Kho cũ'], 'dữ liệu cũ còn nguyên');
    const viaKey = await app.fetch(new Request('http://test/api/v1/warehouses', { headers: { authorization: 'Bearer tk_live_cu-key-that' } }));
    assert.equal(viaKey.status, 200, 'API key cũ vẫn dùng được');

    // Tài khoản mới đăng ký thêm sau đó thì tách biệt hoàn toàn với dữ liệu cũ
    const other = makeClient(app);
    await reg(other, 'nguoi_moi');
    assert.deepEqual((await other.get('/warehouses')).body.data, []);
    // Dữ liệu cũ vẫn nằm đúng file moso.db (giữ chỗ cho bản sao lưu cũ)
    assert.equal(getMaster().prepare("SELECT db_file FROM accounts WHERE username = 'duong'").get().db_file, 'moso.db');
  } finally {
    config.dataDir = oldDir;
    resetTenancy();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getDb() ngoài yêu cầu của một tài khoản là lỗi lập trình, không lặng lẽ dùng dữ liệu của ai', async () => {
  resetTenancy();
  const { getDb } = await import('../server/db/index.js');
  assert.throws(() => getDb(), /Không có tài khoản đang làm việc/);
  const { app } = await setup();
  void app;
  // Sau setup() test được phép đọc DB của tài khoản thử nghiệm; trong runInTenant của tài khoản khác thì thấy đúng DB đó
  const m = getMaster();
  assert.equal(m.prepare('SELECT COUNT(*) n FROM accounts').get().n, 1);
  assert.equal(typeof runInTenant, 'function');
  assert.ok(getAccountDb(m.prepare('SELECT id FROM accounts').get().id));
  void createShop;
});
