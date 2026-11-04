import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

test('đếm đơn theo trạng thái dùng chung bộ lọc với danh sách', async () => {
  const { api, nh, pt, wh } = await setup();
  const mk = async (shop, sku) => {
    const p = (await api.post('/products', { name: `SP ${sku}`, variants: [{ sku, default_price: 100000 }], shop_ids: [shop.id] })).body.data;
    await api.post('/purchases', { warehouse_id: wh.id, lines: [{ variant_id: p.variants[0].id, qty: 10, unit_cost: 50000 }], receive: true });
    return p.variants[0].id;
  };
  const v1 = await mk(nh, 'CNT-1');
  const v2 = await mk(pt, 'CNT-2');
  const order = (shop, variant_id, status) => api.post('/orders', { shop_id: shop.id, channel_id: 'direct', status, lines: [{ variant_id, qty: 1 }] });
  await order(nh, v1, 'draft');
  await order(nh, v1, 'draft');
  await order(nh, v1, 'confirmed');
  await order(pt, v2, 'draft');

  const all = (await api.get('/orders/status-counts')).body.data;
  assert.equal(all.all, 4);
  assert.equal(all.draft, 3);
  assert.equal(all.confirmed, 1);

  const one = (await api.get(`/orders/status-counts?shop_id=${nh.id}`)).body.data;
  assert.equal(one.all, 3);
  assert.equal(one.draft, 2);

  // bộ lọc trạng thái không làm các tab khác mất số
  const withStatus = (await api.get(`/orders/status-counts?shop_id=${nh.id}&status=draft`)).body.data;
  assert.equal(withStatus.confirmed, 1);
  const list = (await api.get(`/orders?shop_id=${nh.id}&status=draft`)).body;
  assert.equal(list.data.length, one.draft);
});
