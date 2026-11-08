import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

const ok = (r, s = [200, 201]) => { assert.ok([].concat(s).includes(r.status), JSON.stringify(r.body)); return r.body.data; };

async function world() {
  const ctx = await setup();
  const v = ok(await ctx.api.post('/products', { name: 'A', variants: [{ sku: 'A1', default_price: 200000 }], shop_ids: [ctx.nh.id] })).variants[0];
  const sup = ok(await ctx.api.post('/suppliers', { name: 'NCC' }));
  const buy = (qty, unit_cost, wh) => ctx.api.post('/purchases', { supplier_id: sup.id, warehouse_id: wh || ctx.wh.id, receive: true, lines: [{ variant_id: v.id, qty, unit_cost }] });
  const sell = async (qty) => {
    const o = ok(await ctx.api.post('/orders', { shop_id: ctx.nh.id, channel_id: 'direct', status: 'completed', lines: [{ variant_id: v.id, qty, unit_price: 200000 }] }));
    return ok(await ctx.api.get(`/orders/${o.id}`));
  };
  const level = async () => ok(await ctx.api.get('/stock')).find((x) => x.variant_id === v.id);
  return { ...ctx, v, buy, sell, level };
}

test('mặc định là bình quân gia quyền; đổi qua PUT /costing-method, không qua PATCH /settings', async () => {
  const { api } = await world();
  assert.equal(ok(await api.get('/costing-method')).method, 'average');
  assert.equal((await api.patch('/settings', { costing_method: 'fifo' })).status, 400);
  assert.equal((await api.put('/costing-method', { method: 'lifo' })).status, 400);
  assert.equal(ok(await api.put('/costing-method', { method: 'fifo' })).method, 'fifo');
});

test('bình quân: 10×40k rồi 10×60k, bán 15 → giá vốn 50k/cái', async () => {
  const { buy, sell } = await world();
  ok(await buy(10, 40000)); ok(await buy(10, 60000));
  const o = await sell(15);
  assert.equal(o.cogs_amount, 750000);
});

test('FIFO: 10×40k rồi 10×60k, bán 15 → 10×40k + 5×60k = 700k, tách hai phân bổ', async () => {
  const { api, buy, sell, level } = await world();
  ok(await api.put('/costing-method', { method: 'fifo' }));
  ok(await buy(10, 40000)); ok(await buy(10, 60000));
  const o = await sell(15);
  assert.equal(o.cogs_amount, 700000);
  const { getDb } = await import('../server/db/index.js');
  const al = getDb().prepare('SELECT qty, unit_cost FROM order_line_allocations ORDER BY rowid').all();
  assert.deepEqual(al.map((a) => [a.qty, a.unit_cost]), [[10, 40000], [5, 60000]]);
  const lv = await level();
  assert.equal(lv.on_hand, 5);
  assert.equal(lv.avg_cost, 60000); // còn 5 cái của lớp 60k
  // bán tiếp 5 → hết lớp 60k
  assert.equal((await sell(5)).cogs_amount, 300000);
  const { verifyStock } = await import('../server/modules/inventory/verify.js');
  assert.deepEqual(verifyStock(), []);
});

test('FIFO: huỷ đơn nhập lại đúng lớp giá đã xuất; cogs khớp phân bổ', async () => {
  const { api, buy, sell } = await world();
  ok(await api.put('/costing-method', { method: 'fifo' }));
  ok(await buy(10, 40000)); ok(await buy(10, 60000));
  const o = await sell(15);
  ok(await api.post(`/orders/${o.id}/status`, { status: 'cancelled' }));
  const { verifyStock } = await import('../server/modules/inventory/verify.js');
  assert.deepEqual(verifyStock(), []);
  const { getDb } = await import('../server/db/index.js');
  assert.equal(getDb().prepare('SELECT on_hand FROM stock_levels').get().on_hand, 20);
});

test('đổi phương pháp giữ nguyên giá trị tồn; FIFO → bình quân lấy giá từ lớp còn lại', async () => {
  const { api, buy, sell, level } = await world();
  ok(await buy(10, 40000)); ok(await buy(10, 60000)); // bình quân 50k
  const before = ok(await api.get('/costing-method')).stock_value;
  assert.equal(before, 1000000);
  const st = ok(await api.put('/costing-method', { method: 'fifo' }));
  assert.equal(st.stock_value, 1000000);
  assert.equal(st.layer_count, 1); // tồn cũ thành một lớp giá 50k
  assert.equal((await sell(4)).cogs_amount, 200000);
  ok(await buy(10, 80000)); // lớp: 16×50k, 10×80k
  assert.equal(ok(await api.get('/costing-method')).stock_value, 16 * 50000 + 10 * 80000);
  const back = ok(await api.put('/costing-method', { method: 'average' }));
  assert.equal(back.layer_count, 0);
  assert.ok(Math.abs(back.stock_value - (16 * 50000 + 10 * 80000)) <= 13); // giá bình quân làm tròn đồng
  assert.equal((await level()).avg_cost, Math.round((16 * 50000 + 10 * 80000) / 26));
});

test('FIFO: chuyển kho giữ giá từng lớp', async () => {
  const { api, buy, sell, wh, level } = await world();
  ok(await api.put('/costing-method', { method: 'fifo' }));
  const wh2 = ok(await api.post('/warehouses', { name: 'Kho 2', code: 'K2' }));
  ok(await buy(10, 40000)); const p2 = ok(await buy(10, 60000));
  const v = (await level()).variant_id;
  ok(await api.post('/transfers', { from_warehouse_id: wh.id, to_warehouse_id: wh2.id, lines: [{ variant_id: v, qty: 15 }] }));
  const { getDb } = await import('../server/db/index.js');
  const lay = getDb().prepare('SELECT warehouse_id, qty, unit_cost FROM stock_layers ORDER BY warehouse_id, unit_cost').all();
  const sum = (w) => lay.filter((l) => l.warehouse_id === w).reduce((a, l) => a + l.qty * l.unit_cost, 0);
  assert.equal(sum(wh2.id), 10 * 40000 + 5 * 60000);
  assert.equal(sum(wh.id), 5 * 60000);
  const { verifyStock } = await import('../server/modules/inventory/verify.js');
  assert.deepEqual(verifyStock(), []);
  void p2; void sell;
});

test('FIFO: huỷ phiếu nhập rút đúng lớp của phiếu đó; hàng vào bù chỗ âm kho không tạo lớp', async () => {
  const { api, buy, sell, level, nh, v } = await world();
  ok(await api.put('/costing-method', { method: 'fifo' }));
  ok(await buy(10, 40000)); const p2 = ok(await buy(10, 60000));
  await sell(3); // lấy từ lớp 40k
  ok(await api.post(`/purchases/${p2.id}/cancel`, { reason: 'nhầm' }));
  const { getDb } = await import('../server/db/index.js');
  const lay = getDb().prepare('SELECT qty, unit_cost FROM stock_layers').all();
  assert.deepEqual(lay.map((l) => [l.qty, l.unit_cost]), [[7, 40000]]);
  assert.equal((await level()).on_hand, 7);
  // bán lố qua đơn import (cho âm kho), rồi nhập bù
  const imp = await api.post('/imports/orders/commit', { shop_id: nh.id, channel_id: 'shopee', orders: [{ external_id: 'X1', status: 'completed', ordered_at: new Date().toISOString(), lines: [{ sku: 'A1', qty: 10 }] }] });
  assert.equal(imp.status, 200, JSON.stringify(imp.body));
  assert.equal((await level()).on_hand, -3);
  ok(await buy(5, 70000)); // 3 bù chỗ âm, 2 thành lớp
  const lay2 = getDb().prepare('SELECT qty, unit_cost FROM stock_layers').all();
  assert.deepEqual(lay2.map((l) => [l.qty, l.unit_cost]), [[2, 70000]]);
  const { verifyStock } = await import('../server/modules/inventory/verify.js');
  assert.deepEqual(verifyStock(), []);
  void v;
});
