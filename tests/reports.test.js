import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

async function scenario() {
  const ctx = await setup();
  const { api, nh, pt, wh } = ctx;
  const a = (await api.post('/products', { name: 'Nước hoa', variants: [{ sku: 'NH-GO', default_price: 150000 }], shop_ids: [nh.id] })).body.data;
  const b = (await api.post('/products', { name: 'Tỳ hưu', variants: [{ sku: 'PT-TY', default_price: 500000 }], shop_ids: [pt.id] })).body.data;
  await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: a.variants[0].id, qty: 20, unit_cost: 50000 }, { variant_id: b.variants[0].id, qty: 5, unit_cost: 200000 }] });
  const mk = async (o) => {
    const r = await api.post('/orders', o);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.data;
  };
  await mk({ shop_id: nh.id, channel_id: 'direct', customer: { name: 'Tài', phone: '0912345678' }, lines: [{ sku: 'NH-GO', qty: 2 }], status: 'completed', payments: [{ amount: 300000 }] });
  const sp = await mk({ shop_id: nh.id, channel_id: 'shopee', external_id: 'SP1', lines: [{ sku: 'NH-GO', qty: 1 }], platform_fee_amount: 20000, status: 'completed' });
  await mk({ shop_id: pt.id, channel_id: 'facebook', customer: { name: 'Tài', phone: '0912345678' }, lines: [{ sku: 'PT-TY', qty: 1 }], shipping_fee: 30000, seller_shipping_amount: 25000, status: 'completed', payments: [{ amount: 530000 }] });
  const x = await mk({ shop_id: nh.id, channel_id: 'direct', lines: [{ sku: 'NH-GO', qty: 1 }], status: 'confirmed' });
  await api.post(`/orders/${x.id}/status`, { status: 'cancelled' });
  return { ...ctx, sp };
}

test('M7: chi phí, huỷ mềm, đối soát tiền Shopee', async () => {
  const { api, nh, sp } = await scenario();
  const cats = (await api.get('/expense-categories')).body.data;
  assert.ok(cats.length >= 5);
  const e = await api.post('/expenses', { category_id: 'ecat_ads', shop_id: nh.id, amount: 50000 });
  assert.equal(e.status, 201);
  assert.equal((await api.post('/expenses', { category_id: 'ecat_ads', amount: 0 })).status, 400);
  const del = await api.delete(`/expenses/${e.body.data.id}`);
  assert.ok(del.body.data.voided_at, 'huỷ mềm, không xoá cứng');
  assert.equal((await api.get('/expenses')).body.data.length, 0);
  assert.equal((await api.get('/expenses?include_voided=1')).body.data.length, 1);

  const pending = (await api.get('/reconciliation/pending')).body;
  assert.equal(pending.count, 1);
  assert.equal(pending.total_pending, 130000);

  const rec = await api.post('/reconciliation/payouts', { items: [{ external_id: 'SP1' }, { external_id: 'KHONGCO' }] });
  assert.equal(rec.body.data.recorded, 1);
  assert.equal(rec.body.data.failed, 1);
  const o = (await api.get(`/orders/${sp.id}`)).body.data;
  assert.equal(o.payment_status, 'paid');
  assert.equal((await api.get('/reconciliation/pending')).body.count, 0);
  // nhận lần 2 phải báo lỗi chứ không ghi trùng
  const again = await api.post('/reconciliation/payouts', { items: [{ order_id: sp.id }] });
  assert.equal(again.body.data.failed, 1);
});

test('M8: báo cáo tổng quan, phân bổ chi phí chung, so sánh kỳ trước, sức khoẻ', async () => {
  const { api, nh, pt } = await scenario();
  await api.post('/expenses', { category_id: 'ecat_ads', shop_id: nh.id, amount: 50000 });
  await api.post('/expenses', { category_id: 'ecat_rent', amount: 100000 }); // chi phí chung

  const ov = (await api.get('/reports/overview')).body.data;
  const c = ov.current;
  assert.equal(c.order_count, 3);
  assert.equal(c.cancelled_count, 1);
  assert.equal(c.net_revenue, 950000);
  assert.equal(c.cogs, 350000);
  assert.equal(c.gross_profit, 585000); // 950 + 30 − 20 − 25 − 350
  assert.equal(c.expenses_amount, 150000);
  assert.equal(c.net_profit_estimate, 435000);
  assert.equal(c.cancel_rate_pct, 25);

  const shops = (await api.get('/reports/shops')).body.data;
  const sNh = shops.find((s) => s.shop_id === nh.id);
  const sPt = shops.find((s) => s.shop_id === pt.id);
  assert.equal(sNh.net_revenue, 450000);
  assert.equal(sNh.expenses_amount, 50000 + 47368); // 100k chung chia theo doanh thu 450:500
  assert.equal(sPt.expenses_amount, 52632);
  assert.equal(sNh.expenses_amount + sPt.expenses_amount, 150000, 'phân bổ không lệch đồng');

  // Lọc 1 shop vẫn phân bổ chi phí chung theo tỷ lệ của toàn hệ thống
  const only = (await api.get(`/reports/overview?shop_id=${pt.id}`)).body.data.current;
  assert.equal(only.expenses_amount, 52632);

  const ch = (await api.get('/reports/channels')).body.data;
  assert.equal(ch.find((x) => x.channel_id === 'shopee').net_revenue, 150000);

  const series = (await api.get('/reports/revenue')).body.data;
  assert.equal(series.reduce((a, d) => a + d.net_revenue, 0), 950000);

  const prods = (await api.get('/reports/products')).body.data;
  assert.equal(prods[0].sku, 'PT-TY');
  assert.equal(prods[0].gross_profit, 300000);

  const cust = (await api.get('/reports/customers')).body.data;
  assert.equal(cust.buyers, 1);
  assert.equal(cust.top_customers[0].order_count, 2);
  assert.equal(cust.repeat_rate_pct, 100);

  const inv = (await api.get('/reports/inventory')).body.data;
  assert.equal(inv.stock_value, 17 * 50000 + 4 * 200000);

  const cf = (await api.get('/reports/cashflow')).body.data;
  assert.equal(cf.cash_in, 830000);
  assert.equal(cf.marketplace_pending, 130000);

  const h = (await api.get('/reports/health')).body;
  const cancel = h.data.find((d) => d.key === 'cancel_rate_pct');
  assert.equal(cancel.status, 'red'); // 25% > 10%
  assert.equal(h.data[0].status, 'red', 'chỉ số đỏ lên đầu');

  const dash = (await api.get('/reports/dashboard')).body.data;
  assert.equal(dash.today.net_revenue, 950000);
});

test('M8: doanh thu theo ngũ hành chia đều cho sản phẩm hợp nhiều hành, tổng không lệch', async () => {
  const { api, nh, wh } = await setup();
  await api.patch(`/shops/${nh.id}`, { industry: 'phong_thuy' });
  const a = (await api.post('/products', { name: 'Tỳ hưu', custom: { ngu_hanh: ['Thổ', 'Kim'] }, custom_shop_id: nh.id, variants: [{ sku: 'TH-1', default_price: 500001 }], shop_ids: [nh.id] })).body.data;
  const b = (await api.post('/products', { name: 'Vòng', custom: { ngu_hanh: ['Mộc'] }, custom_shop_id: nh.id, variants: [{ sku: 'V-1', default_price: 300000 }], shop_ids: [nh.id] })).body.data;
  const c = (await api.post('/products', { name: 'Nước hoa', variants: [{ sku: 'NH-1', default_price: 100000 }], shop_ids: [nh.id] })).body.data;
  await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [a, b, c].map((p) => ({ variant_id: p.variants[0].id, qty: 5, unit_cost: 1000 })) });
  await api.post('/orders', { shop_id: nh.id, lines: [{ sku: 'TH-1', qty: 1 }, { sku: 'V-1', qty: 1 }, { sku: 'NH-1', qty: 2 }], status: 'completed' });
  const r = (await api.get('/reports/elements')).body.data;
  const by = Object.fromEntries(r.map((x) => [x.element, x.revenue]));
  assert.equal(by['Thổ'] + by['Kim'], 500001, 'chia đều không mất đồng lẻ');
  assert.equal(by['Mộc'], 300000);
  assert.equal(by[null], 200000, 'sản phẩm chưa gán hành');
  assert.equal(r.reduce((s, x) => s + x.revenue, 0), 1000001, 'tổng khớp doanh thu hàng');
});
