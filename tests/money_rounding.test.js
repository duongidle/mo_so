import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { getDb } from '../server/db/index.js';
import { lineAmount, shareOf, qty3 } from '../server/lib/money.js';
import { verifyStock } from '../server/modules/inventory/verify.js';
import { verifyJournal } from '../server/modules/accounting/journal.js';

const ok = (r, s = [200, 201]) => { assert.ok([].concat(s).includes(r.status), JSON.stringify(r.body)); return r.body.data; };

const TABLES = ['orders', 'order_lines', 'order_line_allocations', 'order_returns', 'return_write_offs', 'purchases', 'purchase_lines', 'payments', 'stock_movements', 'stock_levels', 'stock_layers', 'journal_lines'];
const MONEY_COL = /(_amount|price|cost|line_total|subtotal|^debit$|^credit$|^amount$|^value$|total_cost)$/;

/** Mọi cột tiền của các bảng liên quan phải là số nguyên (typeof = integer), không có số thực */
function assertAllMoneyIntegers() {
  const db = getDb();
  for (const t of TABLES) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name).filter((n) => MONEY_COL.test(n));
    for (const c of cols) {
      const bad = db.prepare(`SELECT ${c} AS v, typeof(${c}) AS t FROM ${t} WHERE ${c} IS NOT NULL AND typeof(${c}) != 'integer' LIMIT 3`).all();
      assert.deepEqual(bad, [], `${t}.${c} có giá trị không nguyên`);
    }
  }
}

function assertClean() {
  assertAllMoneyIntegers();
  assert.deepEqual(verifyStock(), []);
  assert.deepEqual(verifyJournal(), []);
}

async function world() {
  const ctx = await setup();
  const mk = async (name, sku, price, opening = 0, cost = 0) => ok(await ctx.api.post('/products', {
    name, unit: 'kg', shop_ids: [ctx.nh.id], opening_warehouse_id: ctx.wh.id,
    variants: [{ sku, default_price: price, opening_qty: opening, opening_cost: cost, cost }],
  })).variants[0];
  const buy = (lines, extra = {}, wh = ctx.wh) => ctx.api.post('/purchases', { warehouse_id: wh.id, receive: true, lines, ...extra });
  const sell = async (lines, extra = {}) => ok(await ctx.api.post('/orders', { shop_id: ctx.nh.id, channel_id: 'direct', status: 'completed', lines, ...extra }));
  const level = async (v, wh = ctx.wh) => ok(await ctx.api.get(`/stock?warehouse_id=${wh.id}`)).find((s) => s.variant_id === v.id);
  const order = async (id) => ok(await ctx.api.get(`/orders/${id}`));
  return { ...ctx, mk, buy, sell, level, order };
}

test('helper: lineAmount làm tròn một lần, đúng cả khi số thực sai; shareOf luỹ kế', () => {
  assert.equal(lineAmount(0.125, 45500), 5688); // 5687,5 làm tròn lên
  assert.equal(lineAmount(0.333, 45500), 15152); // 15151,5 (số thực cho 15151,4999…)
  assert.equal(lineAmount(10.5, 30333), 318497);
  assert.equal(lineAmount(-0.125, 45500), -5688);
  assert.equal(lineAmount(3, 1000), 3000);
  assert.equal(qty3(10.042000000001), 10.042);
  assert.equal(qty3(0.1 + 0.2), 0.3);
  assert.equal(shareOf(23333, 0.3, 0.7), 10000);
});

test('nhập hàng số lẻ có ship, phí khác và chiết khấu: tiền nguyên, tổng khớp từng đồng', async () => {
  const { api, mk, buy, level } = await world();
  const a = await mk('Cam', 'CAM', 45500);
  const b = await mk('Bưởi', 'BUO', 30000);
  const p = ok(await buy([{ variant_id: a.id, qty: 10.5, unit_cost: 30333 }, { variant_id: b.id, qty: 2.25, unit_cost: 17777 }], { shipping_fee: 12345, other_fee: 999, discount_amount: 5000 }));
  const l1 = lineAmount(10.5, 30333);
  const l2 = lineAmount(2.25, 17777);
  assert.deepEqual(p.lines.map((l) => l.line_total), [l1, l2]);
  assert.equal(p.subtotal, l1 + l2);
  assert.equal(p.total_amount, l1 + l2 + 12345 + 999 - 5000);
  assert.equal(p.lines.reduce((s, l) => s + l.allocated_cost, 0), 12345 + 999 - 5000, 'phí và chiết khấu chia hết, không thừa không thiếu');
  assert.equal((await level(a)).on_hand, 10.5);
  ok(await api.post(`/purchases/${p.id}/payments`, { amount: p.total_amount, method: 'bank' }));
  assertClean();
});

test('bán số lẻ (bình quân): thu đủ thì hết nợ, không còn nợ khách lẻ 0,5', async () => {
  const { api, mk, buy, sell, level, order } = await world();
  const cam = await mk('Cam', 'CAM', 45500);
  ok(await buy([{ variant_id: cam.id, qty: 10.5, unit_cost: 30333 }]));
  const o = await sell([{ variant_id: cam.id, qty: 0.125 }], { payments: [{ amount: 5688, method: 'cash' }] });
  assert.equal(o.subtotal, 5688);
  assert.equal(o.total_amount, 5688);
  assert.equal(o.net_amount, 5688);
  assert.equal(o.cogs_amount, lineAmount(0.125, 30333));
  assert.equal(o.lines[0].line_total, 5688);
  assert.equal(o.paid_amount, 5688);
  assert.equal(o.payment_status, 'paid');
  assert.equal(o.refund_owed_amount, 0);
  assert.equal(o.amount_due, 0);
  const o2 = await sell([{ variant_id: cam.id, qty: 0.333 }, { variant_id: cam.id, qty: 1.1, unit_price: 777 }], { payments: [{ amount: lineAmount(0.333, 45500) + lineAmount(1.1, 777), method: 'cash' }] });
  assert.equal(o2.total_amount, 15152 + 855);
  assert.equal(o2.total_amount, o2.lines.reduce((s, l) => s + l.line_total, 0));
  assert.equal(o2.cogs_amount, o2.lines.reduce((s, l) => s + l.cogs_amount, 0));
  assert.equal(o2.payment_status, 'paid');
  assert.equal((await level(cam)).on_hand, qty3(10.5 - 0.125 - 0.333 - 1.1));
  assert.equal((await order(o2.id)).cogs_amount, o2.cogs_amount);
  void api;
  assertClean();
});

test('bán số lẻ có giảm giá dòng và giảm giá đơn: tổng đơn = Σ dòng đã làm tròn', async () => {
  const { buy, mk, sell } = await world();
  const v = await mk('Táo', 'TAO', 33333);
  ok(await buy([{ variant_id: v.id, qty: 20, unit_cost: 10000 }]));
  const o = await sell([{ variant_id: v.id, qty: 0.7, discount_amount: 100 }, { variant_id: v.id, qty: 1.5 }], { discount_amount: 1001 });
  const l1 = lineAmount(0.7, 33333) - 100;
  const l2 = lineAmount(1.5, 33333);
  assert.equal(o.subtotal, lineAmount(0.7, 33333) + l2);
  assert.equal(o.total_amount, l1 + l2 - 1001);
  assert.equal(o.lines.reduce((s, l) => s + l.allocated_order_discount, 0), 1001);
  assertClean();
});

for (const method of ['average', 'fifo']) {
  test(`bán số lẻ qua nhiều lớp giá và nhiều kho (${method}): giá vốn = Σ phần đã làm tròn, huỷ đơn về như cũ`, async () => {
    const { api, mk, buy, sell, level, wh, nh, order } = await world();
    if (method === 'fifo') ok(await api.put('/costing-method', { method: 'fifo' }));
    const w2 = ok(await api.post('/warehouses', { code: 'K2', name: 'Kho phụ' }));
    ok(await api.put(`/shops/${nh.id}/warehouses`, { warehouse_ids: [wh.id, w2.id] }));
    const v = await mk('Nho', 'NHO', 90000);
    ok(await buy([{ variant_id: v.id, qty: 0.75, unit_cost: 41111 }]));
    ok(await buy([{ variant_id: v.id, qty: 0.6, unit_cost: 52223 }]));
    ok(await buy([{ variant_id: v.id, qty: 1.3, unit_cost: 47777 }], {}, w2));
    const before = [await level(v), await level(v, w2)];
    const o = await sell([{ variant_id: v.id, qty: 1.777 }], { payments: [{ amount: lineAmount(1.777, 90000), method: 'cash' }] });
    const allocs = getDb().prepare('SELECT * FROM order_line_allocations WHERE order_line_id = ?').all(o.lines[0].id);
    assert.ok(allocs.length >= (method === 'fifo' ? 3 : 2));
    assert.equal(o.cogs_amount, allocs.reduce((s, a) => s + lineAmount(a.qty, a.unit_cost), 0));
    assert.equal(qty3(allocs.reduce((s, a) => s + a.qty, 0)), 1.777);
    assert.equal(o.payment_status, 'paid');
    assertClean();
    // Huỷ đơn: tồn và giá trị về như cũ
    const c = ok(await api.post(`/orders/${o.id}/status`, { status: 'cancelled', paid_action: 'refund' }));
    assert.equal(c.cogs_amount, 0);
    const after = [await level(v), await level(v, w2)];
    for (let i = 0; i < 2; i++) {
      assert.equal(after[i].on_hand, before[i].on_hand);
      assert.equal(after[i].avg_cost, before[i].avg_cost);
    }
    assert.equal((await order(o.id)).cogs_amount, 0);
    assertClean();
  });
}

test('trả một phần số lẻ nhiều lần rồi trả hết: tổng giá trị trả = tiền thực của dòng, giá vốn hoàn về 0', async () => {
  const { api, mk, buy, sell, level, order } = await world();
  const v = await mk('Xoài', 'XOAI', 33333);
  ok(await buy([{ variant_id: v.id, qty: 5, unit_cost: 12345 }]));
  const o = await sell([{ variant_id: v.id, qty: 0.7 }], { discount_amount: 1001, payments: [{ amount: lineAmount(0.7, 33333) - 1001, method: 'cash' }] });
  const net = o.lines[0].line_total - o.lines[0].allocated_order_discount;
  const cogs = o.cogs_amount;
  assert.equal(cogs, lineAmount(0.7, 12345));
  let goods = 0;
  let restored = 0;
  for (const q of [0.3, 0.3, 0.1]) {
    const lineNow = (await order(o.id)).lines[0];
    const r = ok(await api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: lineNow.id, qty: q, restock: true }], reason_code: 'changed_mind' }));
    const last = r.returns.at(-1);
    goods += last.goods_amount;
    restored += last.lines[0].restored_cost;
    assertAllMoneyIntegers();
  }
  assert.equal(goods, net, 'trả hết thì tổng đúng bằng tiền thực của dòng');
  assert.equal(restored, cogs, 'giá vốn hoàn hết đúng bằng giá vốn đã ghi');
  const fin = await order(o.id);
  assert.equal(fin.status, 'returned');
  assert.equal(fin.returned_goods_amount, net);
  assert.equal(fin.cogs_amount, 0);
  assert.equal(fin.refund_owed_amount, Math.max(0, fin.paid_amount - Math.max(0, fin.total_amount - fin.returned_amount)));
  assert.equal((await level(v)).on_hand, 5);
  assertClean();
});

test('xuất huỷ, điều chỉnh, chuyển kho, kiểm kê số lẻ: tồn đúng 3 chữ số, không trôi', async () => {
  const { api, mk, buy, level, wh } = await world();
  const w2 = ok(await api.post('/warehouses', { code: 'K2', name: 'Kho phụ' }));
  const v = await mk('Gạo', 'GAO', 20000);
  ok(await buy([{ variant_id: v.id, qty: 10.5, unit_cost: 30333 }]));
  let expected = 10.5;
  for (const d of [0.1, 0.2, -0.3, 0.7, -0.4]) {
    ok(await api.post('/stock-adjustments', { warehouse_id: wh.id, kind: 'adjust', reason: 'thử', lines: [{ variant_id: v.id, change: d, unit_cost: 30333 }] }));
    expected = qty3(expected + d);
    assert.equal((await level(v)).on_hand, expected);
  }
  ok(await api.post('/stock-adjustments', { warehouse_id: wh.id, kind: 'damage', reason: 'thối', lines: [{ variant_id: v.id, change: -1.5 }] }));
  expected = qty3(expected - 1.5);
  ok(await api.post('/transfers', { from_warehouse_id: wh.id, to_warehouse_id: w2.id, lines: [{ variant_id: v.id, qty: 2.3 }] }));
  expected = qty3(expected - 2.3);
  assert.equal((await level(v)).on_hand, expected);
  assert.equal((await level(v, w2)).on_hand, 2.3);
  const cnt = ok(await api.post('/stock-counts', { warehouse_id: wh.id, mode: 'variants', variant_ids: [v.id] }));
  ok(await api.patch(`/stock-counts/${cnt.id}`, { lines: [{ variant_id: v.id, counted_qty: 6.123 }] }));
  ok(await api.post(`/stock-counts/${cnt.id}/complete`, {}));
  assert.equal((await level(v)).on_hand, 6.123);
  assertClean();
});

test('đơn 0 đồng đã hoàn thành (gửi bù) có trạng thái thanh toán paid', async () => {
  const { mk, buy, sell } = await world();
  const v = await mk('Tester', 'TST', 200000);
  ok(await buy([{ variant_id: v.id, qty: 5, unit_cost: 80000 }]));
  const o = await sell([{ variant_id: v.id, qty: 1, unit_price: 0 }]);
  assert.equal(o.total_amount, 0);
  assert.equal(o.payment_status, 'paid');
  assertClean();
});
