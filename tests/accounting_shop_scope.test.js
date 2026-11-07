import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

test('Cân đối phát sinh và tổng quan kế toán theo shop; số dư chung vẫn toàn tài khoản', async () => {
  const { api, nh, pt, wh } = await setup();
  const product = (await api.post('/products', {
    name: 'Sản phẩm thử',
    variants: [{ sku: 'SHOP-SCOPE-1', default_price: 10000, opening_qty: 4, opening_cost: 2000 }],
    opening_warehouse_id: wh.id,
    shop_ids: [nh.id, pt.id],
  })).body.data;
  for (const shop of [nh, pt]) {
    const sale = await api.post('/orders', { shop_id: shop.id, status: 'completed', lines: [{ variant_id: product.variants[0].id, qty: 1 }], payments: [{ amount: 10000, method: 'cash' }] });
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
  }

  const allTrial = (await api.get('/accounting/trial-balance')).body.data;
  const shopTrial = await api.get(`/accounting/trial-balance?shop_id=${nh.id}`);
  assert.equal(shopTrial.status, 200);
  assert.equal(shopTrial.body.data.scope.shop_filtered, true);
  assert.equal(shopTrial.body.data.balanced, true, JSON.stringify(shopTrial.body.data.totals));
  assert.equal(shopTrial.body.data.data.find((x) => x.code === '5111').credit, 10000);
  assert.equal(allTrial.data.find((x) => x.code === '5111').credit, 20000);

  const allOverview = (await api.get('/accounting/overview')).body.data;
  const shopOverview = (await api.get(`/accounting/overview?shop_id=${nh.id}`)).body.data;
  assert.equal(shopOverview.scope.shop_filtered, true);
  assert.equal(shopOverview.month_net_revenue, 10000);
  assert.equal(shopOverview.cash, allOverview.cash);
  assert.equal(shopOverview.inventory, allOverview.inventory);
  assert.equal(shopOverview.payable_suppliers, allOverview.payable_suppliers);
});
