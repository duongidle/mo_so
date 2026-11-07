import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { getDb } from '../server/db/index.js';

test('Vật tư đóng gói: định mức chỉ dự kiến, xác nhận trừ đúng số thực tế và hạch toán một lần', async () => {
  const { api, nh, wh } = await setup();
  const sell = (await api.post('/products', { name: 'Hàng bán', variants: [{ sku: 'SELL-1', default_price: 20000, opening_qty: 4, opening_cost: 8000 }], shop_ids: [nh.id], opening_warehouse_id: wh.id })).body.data;
  const material = await api.post('/products', { name: 'Băng keo', item_type: 'packaging', unit: 'm', variants: [{ sku: 'TAPE-1', opening_qty: 10, opening_cost: 1000 }], opening_warehouse_id: wh.id });
  assert.equal(material.status, 201, JSON.stringify(material.body));
  const mat = material.body.data.variants[0];
  assert.equal((await api.get('/variants?q=TAPE-1')).body.data.length, 0, 'vật tư không xuất hiện trong bộ chọn sản phẩm bán');
  const order = await api.post('/orders', { shop_id: nh.id, lines: [{ variant_id: sell.variants[0].id, qty: 2 }], status: 'confirmed' });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  const spec = await api.put(`/packaging-specs/${sell.id}`, { lines: [{ material_variant_id: mat.id, qty: 0.5 }] });
  assert.equal(spec.status, 200, JSON.stringify(spec.body));
  const plan = await api.get(`/orders/${order.body.data.id}/packaging-plan`);
  assert.equal(plan.body.data.lines[0].qty, 1, 'định mức chỉ tính lượng dự kiến theo số lượng đơn');
  assert.equal((await api.get('/stock')).body.data.find((x) => x.variant_id === mat.id).on_hand, 10, 'xem kế hoạch không tự trừ tồn');
  const confirmed = await api.post(`/orders/${order.body.data.id}/packaging-confirm`, { warehouse_id: wh.id, lines: [{ variant_id: mat.id, qty: 0.5 }] });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.data.replayed, false);
  const retry = await api.post(`/orders/${order.body.data.id}/packaging-confirm`, { warehouse_id: wh.id, lines: [{ variant_id: mat.id, qty: 0.5 }] });
  assert.equal(retry.body.data.replayed, true);
  const stock = (await api.get('/stock')).body.data.find((x) => x.variant_id === mat.id);
  assert.equal(stock.on_hand, 9.5);
  assert.equal(stock.stock_value, 9500);
  await api.get('/accounting/journal'); // flush derived journal entries
  const debit = getDb().prepare("SELECT COALESCE(SUM(debit),0) AS v FROM journal_lines WHERE account_code='6414'").get().v;
  assert.equal(debit, 500);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM stock_movements WHERE ref_type='packaging_run'").get().n, 1);
  assert.equal((await api.get('/material-consumption')).body.data[0].amount, 500);
  const report = await api.get('/inventory-reports');
  assert.equal(report.status, 200, JSON.stringify(report.body));
  assert.equal(report.body.data.items.find((x) => x.variant_id === mat.id).stock_value, 9500);
  const periodReport = await api.get('/inventory-reports', { from: '2026-01-01', to: '2026-12-31' });
  assert.equal(periodReport.body.data.items.find((x) => x.variant_id === mat.id).ending_qty, 9.5);
  assert.equal((await api.get('/inventory-reports/export')).status, 200);
  assert.equal((await api.get('/material-consumption/export')).status, 200);
});

test('Vật tư vận hành: xuất nội bộ ghi chi phí đã chọn; vật tư không thể bán', async () => {
  const { api, wh } = await setup();
  const material = await api.post('/products', { name: 'Giấy in', item_type: 'supply', unit: 'tờ', variants: [{ sku: 'PAPER-1', opening_qty: 20, opening_cost: 100 }], opening_warehouse_id: wh.id });
  assert.equal(material.status, 201, JSON.stringify(material.body));
  const v = material.body.data.variants[0];
  const issue = await api.post('/material-issues', { warehouse_id: wh.id, purpose: 'In nhãn đơn hàng', expense_account_code: '6428', lines: [{ variant_id: v.id, qty: 2 }] });
  assert.equal(issue.status, 201, JSON.stringify(issue.body));
  const attemptedSale = await api.post('/orders', { shop_id: (await api.get('/shops')).body.data[0].id, lines: [{ variant_id: v.id, qty: 1 }] });
  assert.equal(attemptedSale.status, 400);
  await api.get('/accounting/journal');
  assert.equal(getDb().prepare("SELECT COALESCE(SUM(debit),0) AS v FROM journal_lines WHERE account_code='6428'").get().v, 200);
});
