import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setup, makeClient } from './helpers.js';
import { config } from '../server/lib/config.js';
import { runBackup } from '../server/jobs/backup.js';
import { cleanupUnusedImages } from '../server/jobs/uploads.js';
import { runInTenant } from '../server/db/index.js';
import { getAccountDb } from '../server/db/tenancy.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([60, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(64, 3)]);

const raw = (app, cookie, method, p, body, headers = {}) =>
  app.fetch(new Request(`http://test/api/v1${p}`, { method, headers: { cookie, ...headers }, body }));

function useTmpData() {
  const old = config.dataDir;
  config.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moso-up-'));
  return () => {
    fs.rmSync(config.dataDir, { recursive: true, force: true });
    config.dataDir = old;
  };
}

test('Tải ảnh: nhận webp/jpeg/png qua magic bytes, trả về đúng nội dung, cache riêng tư bất biến', async () => {
  const restore = useTmpData();
  try {
    const { app, api, accountId } = await setup();
    for (const [buf, ext, type] of [[PNG, 'png', 'image/png'], [JPG, 'jpg', 'image/jpeg'], [WEBP, 'webp', 'image/webp']]) {
      // Content-Type gửi sai cố ý: server chỉ tin magic bytes
      const up = await raw(app, api.cookie(), 'POST', '/uploads/images?width=800&height=600', buf, { 'content-type': 'text/plain' });
      assert.equal(up.status, 201);
      const { data } = await up.json();
      assert.match(data.id, /^img_/);
      assert.equal(data.url, `/api/v1/files/images/${data.id}`);
      assert.ok(fs.existsSync(path.join(config.dataDir, 'uploads', accountId, `${data.id}.${ext}`)));
      const got = await raw(app, api.cookie(), 'GET', `/files/images/${data.id}`);
      assert.equal(got.status, 200);
      assert.equal(got.headers.get('content-type'), type);
      assert.equal(got.headers.get('cache-control'), 'private, max-age=31536000, immutable');
      assert.ok(Buffer.from(await got.arrayBuffer()).equals(buf));
    }
  } finally {
    restore();
  }
});

test('Tải ảnh: sai magic bytes 400, quá 3 MB 413, không đăng nhập 401', async () => {
  const restore = useTmpData();
  try {
    const { app, api } = await setup();
    const fake = await raw(app, api.cookie(), 'POST', '/uploads/images', Buffer.from('<svg onload=alert(1)>'), { 'content-type': 'image/png' });
    assert.equal(fake.status, 400);
    assert.equal((await fake.json()).error.code, 'IMAGE_TYPE');
    const big = await raw(app, api.cookie(), 'POST', '/uploads/images', Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]));
    assert.equal(big.status, 413);
    assert.equal((await raw(app, api.cookie(), 'POST', '/uploads/images', Buffer.alloc(0))).status, 400);
    assert.equal((await raw(app, '', 'POST', '/uploads/images', PNG)).status, 401);
    assert.equal((await raw(app, '', 'GET', '/files/images/img_x')).status, 401);
    assert.equal(fs.existsSync(path.join(config.dataDir, 'uploads')), false, 'file bị từ chối không được ghi ra đĩa');
  } finally {
    restore();
  }
});

test('Ảnh của tài khoản này là 404 với tài khoản khác', async () => {
  const restore = useTmpData();
  try {
    const { app, api } = await setup();
    const id = (await (await raw(app, api.cookie(), 'POST', '/uploads/images', PNG)).json()).data.id;
    const other = makeClient(app);
    assert.equal((await other.post('/auth/register', { username: 'nguoikhac', display_name: 'Khác', password: 'matkhau123' })).status, 201);
    assert.equal((await raw(app, other.cookie(), 'GET', `/files/images/${id}`)).status, 404);
    assert.equal((await raw(app, api.cookie(), 'GET', `/files/images/${id}`)).status, 200);
  } finally {
    restore();
  }
});

test('Gắn ảnh vào sản phẩm: thứ tự, ảnh đầu ghi vào image_url, gỡ ảnh thì lưu trữ (file còn), ảnh của biến thể', async () => {
  const restore = useTmpData();
  try {
    const { app, api, nh, accountId } = await setup();
    const up = async (b) => (await (await raw(app, api.cookie(), 'POST', '/uploads/images', b)).json()).data.id;
    const [a, b, c] = [await up(PNG), await up(JPG), await up(WEBP)];
    const p = (await api.post('/products', { name: 'Có ảnh', options: [{ name: 'Mùi', values: ['Cam', 'Chanh'] }], variants: [{ sku: 'IM-1', option_values: { Mùi: 'Cam' } }, { sku: 'IM-2', option_values: { Mùi: 'Chanh' } }], shop_ids: [nh.id], images: [{ id: a }, { id: b, variant_sku: 'IM-2' }] })).body.data;
    assert.deepEqual(p.images.map((i) => i.id), [a, b]);
    assert.equal(p.image_url, `/api/v1/files/images/${a}`);
    assert.equal(p.variants[1].image_url, `/api/v1/files/images/${b}`);
    assert.equal(p.variants[0].image_url, null);
    // Đổi thứ tự + thêm ảnh c; bỏ a
    const put = await api.put(`/products/${p.id}/images`, [{ id: c }, { id: b }]);
    assert.equal(put.status, 200);
    assert.deepEqual(put.body.data.map((i) => i.id), [c, b]);
    const after = (await api.get(`/products/${p.id}`)).body.data;
    assert.equal(after.image_url, `/api/v1/files/images/${c}`);
    assert.ok(fs.existsSync(path.join(config.dataDir, 'uploads', accountId, `${a}.png`)), 'ảnh gỡ khỏi sản phẩm vẫn còn file');
    // Ảnh đã gắn sản phẩm khác không dùng lại được
    const q = (await api.post('/products', { name: 'Khác', variants: [{ sku: 'IM-3' }] })).body.data;
    assert.equal((await api.put(`/products/${q.id}/images`, [{ id: c }])).status, 409);
    assert.equal((await api.put(`/products/${q.id}/images`, [{ id: 'img_none' }])).status, 404);
    // Chọn ảnh cho biến thể qua PUT
    await api.put(`/products/${p.id}/images`, [{ id: c, variant_id: p.variants[0].id }, { id: b }]);
    assert.equal((await api.get(`/products/${p.id}`)).body.data.variants[0].image_url, `/api/v1/files/images/${c}`);
    // Gỡ hết ảnh: image_url về rỗng, ảnh biến thể bị bỏ
    await api.put(`/products/${p.id}/images`, []);
    const none = (await api.get(`/products/${p.id}`)).body.data;
    assert.equal(none.image_url, null);
    assert.equal(none.variants[0].image_url, null);
    // Ảnh biến thể trong /variants
    const vs = (await api.get(`/variants?shop_id=${nh.id}&q=IM-1`)).body.data;
    assert.equal(vs[0].image_url, null);
  } finally {
    restore();
  }
});

test('Sao lưu chép ảnh sang thư mục backups/<tài khoản>/uploads, chỉ chép file mới', async () => {
  const restore = useTmpData();
  try {
    const { app, api, accountId } = await setup();
    const { accounts } = { accounts: null };
    void accounts;
    await raw(app, api.cookie(), 'POST', '/uploads/images', PNG);
    const store = { db: getAccountDb(accountId), accountId, backupSub: accountId };
    const dir = path.join(config.dataDir, 'backups', accountId);
    const r1 = await runInTenant(store, () => runBackup(new Date(), { dir }));
    assert.equal(r1.uploads, 1);
    assert.equal(fs.readdirSync(path.join(dir, 'uploads')).length, 1);
    const r2 = await runInTenant(store, () => runBackup(new Date(), { dir }));
    assert.equal(r2.uploads, 0, 'lần sau không chép lại');
    await raw(app, api.cookie(), 'POST', '/uploads/images', JPG);
    assert.equal((await runInTenant(store, () => runBackup(new Date(), { dir }))).uploads, 1);
  } finally {
    restore();
  }
});

test('Dọn ảnh không dùng: chỉ ảnh chưa gắn, quá 7 ngày; ảnh đang dùng không bị đụng', async () => {
  const restore = useTmpData();
  try {
    const { app, api, accountId } = await setup();
    const up = async () => (await (await raw(app, api.cookie(), 'POST', '/uploads/images', PNG)).json()).data.id;
    const [old, fresh, used, viaVariant] = [await up(), await up(), await up(), await up()];
    const p = (await api.post('/products', { name: 'Có ảnh', variants: [{ sku: 'CL-1' }], images: [{ id: used }] })).body.data;
    assert.equal(p.images.length, 1);
    const store = { db: getAccountDb(accountId), accountId, backupSub: accountId };
    const file = (id) => path.join(config.dataDir, 'uploads', accountId, `${id}.png`);
    const dayAgo = (n) => new Date(Date.now() - n * 86400_000).toISOString();
    const db = store.db;
    db.prepare('UPDATE product_images SET created_at = ? WHERE id IN (?,?,?)').run(dayAgo(10), old, used, viaVariant);
    db.prepare('UPDATE product_images SET created_at = ? WHERE id = ?').run(dayAgo(2), fresh);
    db.prepare('UPDATE variants SET image_id = ? WHERE id = ?').run(viaVariant, p.variants[0].id);
    const r = await runInTenant(store, () => cleanupUnusedImages());
    assert.deepEqual(r, { archived: 1, files_removed: 1 });
    assert.ok(!fs.existsSync(file(old)), 'file ảnh mồ côi đã xoá');
    for (const keep of [fresh, used, viaVariant]) assert.ok(fs.existsSync(file(keep)), 'ảnh còn dùng/mới giữ nguyên');
    assert.ok(db.prepare('SELECT archived_at FROM product_images WHERE id = ?').get(old).archived_at, 'đánh dấu lưu trữ trong DB');
    assert.equal(db.prepare('SELECT archived_at FROM product_images WHERE id = ?').get(used).archived_at, null);
    assert.deepEqual(await runInTenant(store, () => cleanupUnusedImages()), { archived: 0, files_removed: 0 }, 'chạy lại không đổi gì');
  } finally {
    restore();
  }
});
