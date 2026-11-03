import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { allocate } from '../server/lib/money.js';

test('allocate chia tiền không lệch đồng nào', () => {
  const parts = allocate(100, [1, 1, 1]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 100);
  assert.deepEqual(allocate(0, [5, 5]), [0, 0]);
  assert.equal(allocate(10001, [3, 7]).reduce((a, b) => a + b, 0), 10001);
});

test('M0/M1: đăng ký, đăng nhập, shop, kho', async () => {
  const { api, shops, wh } = await setup();
  assert.equal(shops.length, 2);
  assert.equal(shops[0].default_warehouse_id, wh.id);

  const me = await api.get('/auth/me');
  assert.equal(me.body.data.username, 'duong');

  const s3 = await api.post('/shops', { code: 'NS', name: 'Nông sản', default_warehouse_id: wh.id });
  assert.equal(s3.status, 201);
  assert.equal(s3.body.data.code, 'NS');

  const bad = await api.post('/shops', { code: 'X Y', name: '' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'VALIDATION_ERROR');

  const ch = await api.get('/channels');
  assert.deepEqual(ch.body.data.map((c) => c.id), ['direct', 'facebook', 'shopee', 'other']);

  await api.post('/auth/logout');
  const denied = await api.get('/shops');
  assert.equal(denied.status, 401);
  const wrong = await api.post('/auth/login', { username: 'duong', password: 'sai' });
  assert.equal(wrong.status, 401);
  const ok = await api.post('/auth/login', { username: 'DUONG', password: 'matkhau123' });
  assert.equal(ok.status, 200);
});
