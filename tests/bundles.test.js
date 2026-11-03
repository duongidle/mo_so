import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

async function scenario() {
  const ctx = await setup();
  const { api, nh, wh } = ctx;
  const a = (await api.post('/products', { name: 'Tinh dầu', variants: [{ sku: 'TD-1', default_price: 30000 }], shop_ids: [nh.id] })).body.data.variants[0];
  const b = (await api.post('/products', { name: 'Móc treo', variants: [{ sku: 'MT-1', default_price: 50000 }], shop_ids: [nh.id] })).body.data.variants[0];
  await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: a.id, qty: 10, unit_cost: 10000 }, { variant_id: b.id, qty: 6, unit_cost: 20000 }] });
  const cb = await api.post('/products', {
    name: 'Combo quà',
    variants: [{ sku: 'CB-1', kind: 'bundle', default_price: 80000, components: [{ variant_id: a.id, qty: 2 }, { variant_id: b.id, qty: 1 }] }],
    shop_ids: [nh.id],
  });
  assert.equal(cb.status, 201, JSON.stringify(cb.body));
  return { ...ctx, a, b, combo: cb.body.data.variants[0], comboProduct: cb.body.data };
}

const level = async (api, sku, whId) => (await api.get(`/stock?warehouse_id=${whId}&q=${sku}`)).body.data.find((r) => r.sku === sku);

test('Combo: tồn khả dụng theo thành phần, chặn nhập/điều chỉnh/lồng combo', async () => {
  const { api, nh, wh, a, b, combo } = await scenario();
  assert.equal(combo.kind, 'bundle');
  assert.equal(combo.available, 5, 'min(10/2, 6/1)');
  const pos = (await api.get(`/variants?shop_id=${nh.id}&warehouse_id=${wh.id}&q=CB-1`)).body.data[0];
  assert.equal(pos.on_hand, 5);
  assert.equal(pos.avg_cost, 2 * 10000 + 20000, 'giá vốn gợi ý = tổng thành phần');
  assert.equal((await level(api, 'CB-1', wh.id)).on_hand, 5);
  assert.equal((await level(api, 'CB-1', wh.id)).stock_value, 0, 'giá trị tồn không đếm lần hai');

  const buy = await api.post('/purchases', { warehouse_id: wh.id, lines: [{ variant_id: combo.id, qty: 1, unit_cost: 1000 }] });
  assert.equal(buy.body.error.code, 'BUNDLE_NO_STOCK');
  const adj = await api.post('/stock-adjustments', { warehouse_id: wh.id, kind: 'adjust', lines: [{ variant_id: combo.id, change: 1, unit_cost: 5 }] });
  assert.equal(adj.body.error.code, 'BUNDLE_NO_STOCK');

  const mk = (components, sku = 'CB-X') => api.post('/products', { name: 'x', variants: [{ sku, kind: 'bundle', components }] });
  assert.equal((await mk([])).body.error.code, 'BUNDLE_EMPTY');
  assert.equal((await mk([{ variant_id: combo.id, qty: 1 }])).body.error.code, 'BUNDLE_NESTED');
  assert.equal((await mk([{ variant_id: a.id, qty: 1 }, { variant_id: a.id, qty: 2 }])).body.error.code, 'BUNDLE_DUPLICATE');
  assert.equal((await api.post('/products', { name: 'y', variants: [{ sku: 'Y1', components: [{ variant_id: a.id, qty: 1 }] }] })).body.error.code, 'NOT_BUNDLE');
  void b;
});

test('Combo: bán trừ thành phần, chụp giá vốn, huỷ và trả hàng hoàn đúng kể cả khi giá vốn thành phần đã đổi', async () => {
  const { api, nh, wh, a, b, combo } = await scenario();
  const ord = await api.post('/orders', { shop_id: nh.id, lines: [{ variant_id: combo.id, qty: 3 }], status: 'confirmed' });
  assert.equal(ord.status, 201, JSON.stringify(ord.body));
  const o = ord.body.data;
  assert.equal((await level(api, 'TD-1', wh.id)).on_hand, 4);
  assert.equal((await level(api, 'MT-1', wh.id)).on_hand, 3);
  assert.equal(o.lines[0].unit_cost, 40000, '2 × 10.000 + 1 × 20.000');
  assert.equal(o.cogs_amount, 120000);
  assert.equal((await level(api, 'CB-1', wh.id)).on_hand, 2, 'combo còn bán được = min(4/2, 3/1)');

  // Bán vượt: cần 6 tinh dầu, chỉ còn 4
  const over = await api.post('/orders', { shop_id: nh.id, lines: [{ variant_id: combo.id, qty: 3 }], status: 'confirmed' });
  assert.equal(over.body.error.code, 'STOCK_NOT_ENOUGH');
  assert.equal((await level(api, 'TD-1', wh.id)).on_hand, 4, 'đơn lỗi không để lại biến động nào');

  // Nhập thêm tinh dầu với giá khác → giá vốn bình quân thành phần đổi
  await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: a.id, qty: 4, unit_cost: 30000 }] });
  // Sửa công thức combo sau khi đã bán: đơn cũ vẫn hoàn theo công thức lúc bán
  const prod = (await api.get(`/products/${combo.product_id}`)).body.data;
  assert.equal((await api.patch(`/products/${prod.id}`, { variants: [{ id: combo.id, components: [{ variant_id: a.id, qty: 1 }] }] })).status, 200);

  // Trả 1 combo nhập lại kho: +2 tinh dầu, +1 móc (theo lúc bán), giá vốn đơn giảm 40.000
  const ret = await api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: o.lines[0].id, qty: 1, restock: true }] });
  assert.equal(ret.status, 200, JSON.stringify(ret.body));
  assert.equal((await level(api, 'TD-1', wh.id)).on_hand, 8 + 2);
  assert.equal((await level(api, 'MT-1', wh.id)).on_hand, 3 + 1);
  assert.equal(ret.body.data.cogs_amount, 80000);

  // Trả 1 combo nhưng hàng hỏng (không nhập lại): kho không đổi, giá vốn vẫn tính (hàng đã mất)
  const ret2 = await api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: o.lines[0].id, qty: 1, restock: false }] });
  assert.equal((await level(api, 'TD-1', wh.id)).on_hand, 10);
  assert.equal(ret2.body.data.cogs_amount, 80000);

  assert.deepEqual((await api.get('/stock-integrity')).body, { ok: true, issues: [] });
});

test('Combo: huỷ đơn hoàn đủ thành phần, kiểm tra sổ cái; đổi loại biến thể có lịch sử bị chặn', async () => {
  const { api, nh, wh, a, b, combo } = await scenario();
  const o = (await api.post('/orders', { shop_id: nh.id, lines: [{ variant_id: combo.id, qty: 2 }, { sku: 'TD-1', qty: 1 }], status: 'confirmed' })).body.data;
  assert.equal((await level(api, 'TD-1', wh.id)).on_hand, 10 - 4 - 1);
  assert.equal((await api.post(`/orders/${o.id}/status`, { status: 'cancelled' })).status, 200);
  assert.equal((await level(api, 'TD-1', wh.id)).on_hand, 10);
  assert.equal((await level(api, 'MT-1', wh.id)).on_hand, 6);
  const integrity = (await api.get('/stock-integrity')).body;
  assert.equal(integrity.ok, true, JSON.stringify(integrity));

  // Đổi combo → sản phẩm đơn khi đã có đơn: chặn. Sản phẩm đơn đã có lịch sử → combo: chặn.
  const prod = (await api.get(`/products/${combo.product_id}`)).body.data;
  const r1 = await api.patch(`/products/${prod.id}`, { variants: [{ id: combo.id, kind: 'single' }] });
  assert.equal(r1.body.error.code, 'KIND_LOCKED');
  const pa = (await api.get(`/products/${a.product_id}`)).body.data;
  const r2 = await api.patch(`/products/${pa.id}`, { variants: [{ id: a.id, kind: 'bundle', components: [{ variant_id: b.id, qty: 1 }] }] });
  assert.equal(r2.body.error.code, 'KIND_LOCKED');

  // Báo cáo: combo ghi nhận doanh thu theo combo, giá vốn theo thành phần
  const prods = (await api.get('/reports/products')).body.data;
  assert.equal(prods.filter((p) => p.sku === 'CB-1').length, 0, 'đơn đã huỷ không tính');
});

test('Báo cáo sản phẩm: combo là dòng riêng, thành phần có số lượng bán qua combo, tổng combo khớp', async () => {
  const { api, nh, a, b, combo } = await scenario();
  // 3 combo (2 TD + 1 MT mỗi combo) + 1 tinh dầu bán lẻ + 1 móc bán lẻ
  await api.post('/orders', { shop_id: nh.id, lines: [{ variant_id: combo.id, qty: 3 }, { sku: 'TD-1', qty: 1 }], status: 'completed' });
  const r = (await api.get('/reports/products')).body;
  const row = (sku) => r.data.find((x) => x.sku === sku);

  assert.equal(row('CB-1').is_bundle, true);
  assert.equal(row('CB-1').qty_sold, 3);
  assert.equal(row('CB-1').revenue, 240000, '3 × 80.000');
  assert.equal(row('CB-1').cogs, 120000, '3 × (2 × 10.000 + 20.000)');
  assert.equal(row('CB-1').qty_in_combos, undefined);

  assert.equal(row('TD-1').qty_sold, 1, 'chỉ phần bán lẻ, không đếm hai lần');
  assert.equal(row('TD-1').qty_in_combos, 6, '3 combo × 2');
  // Móc treo chưa bán lẻ lần nào nhưng đã đi trong combo: vẫn hiện
  assert.equal(row('MT-1').qty_sold, 0);
  assert.equal(row('MT-1').qty_in_combos, 3);

  assert.deepEqual(r.combos, { count: 1, qty: 3, revenue: 240000, cogs: 120000, gross_profit: 120000 });
  // Trả 1 combo: số đã bán qua combo giảm theo
  const o = (await api.get('/orders')).body.data[0];
  const full = (await api.get(`/orders/${o.id}`)).body.data;
  await api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: full.lines.find((l) => l.sku === 'CB-1').id, qty: 1, restock: true }] });
  const r2 = (await api.get('/reports/products')).body;
  assert.equal(r2.data.find((x) => x.sku === 'TD-1').qty_in_combos, 4);
  assert.equal(r2.combos.qty, 2);
  void a; void b;
});
