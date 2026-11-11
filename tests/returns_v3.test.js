import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { getDb } from '../server/db/index.js';
import { addDays, businessDate } from '../server/lib/time.js';
import { verifyJournal, flushJournal } from '../server/modules/accounting/journal.js';
import { verifyStats } from '../server/modules/reports/stats.js';
import { verifyStock } from '../server/modules/inventory/verify.js';
import { removeAwaitingReturn } from '../server/modules/orders/service.js';

/**
 * Trả hàng v3: (A) đơn sàn trả hàng được hoàn phí sàn, (B) giảm giá sau bán / bồi thường (khách giữ hàng), (C) hàng nhập lại về đúng lô.
 * Mỗi kịch bản đối chiếu số trên đơn, tiền treo sàn, báo cáo, sổ kế toán, tồn kho.
 */
const WIDE = () => `from=${addDays(businessDate(), -3)}&to=${businessDate()}`;
const ok = (r, s = [200, 201]) => {
  assert.ok([].concat(s).includes(r.status), JSON.stringify(r.body));
  return r.body.data;
};
const one = (sql, ...p) => getDb().prepare(sql).get(...p);
const bal = (code) => (flushJournal(), one('SELECT COALESCE(SUM(l.debit - l.credit),0) AS v FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.voided_at IS NULL AND l.account_code = ?', code).v);

async function world() {
  const ctx = await setup();
  const { api, nh, wh } = ctx;
  const mk = async (sku, price) => ok(await api.post('/products', { name: sku, variants: [{ sku, default_price: price }], shop_ids: [nh.id] })).variants[0];
  const a = await mk('A1', 100000);
  const b = await mk('B1', 80000);
  ok(await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: a.id, qty: 40, unit_cost: 40000 }, { variant_id: b.id, qty: 40, unit_cost: 30000 }] }));
  const sell = async (o) => ok(await api.post('/orders', { shop_id: nh.id, status: 'completed', ...o }));
  const shopee = (extra = {}) => sell({ channel_id: 'shopee', external_id: `SP-${Math.random().toString(36).slice(2, 8)}`, lines: [{ sku: 'A1', qty: 2, unit_price: 100000 }], platform_fee_amount: 24000, ...extra });
  const ret = (o, body, n = 2, s = 200) => api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: o.lines[0].id, qty: n, restock: true }], ...body }).then((r) => (s ? ok(r, s) : r));
  const order = async (o) => ok(await api.get(`/orders/${o.id}`));
  const ov = async () => ok(await api.get(`/reports/overview?${WIDE()}`)).current;
  const stock = async (sku) => ok(await api.get(`/stock?q=${sku}`)).find((r) => r.sku === sku).on_hand;
  return { ...ctx, a, b, sell, shopee, ret, order, ov, stock };
}

async function sound(api) {
  assert.deepEqual(verifyJournal(), []);
  assert.deepEqual(verifyStats(), []);
  assert.deepEqual(verifyStock(), []);
  assert.equal(ok(await api.get('/accounting/balance-sheet')).balanced, true);
  const is = ok(await api.get(`/accounting/income-statement?${WIDE()}`));
  const ov = ok(await api.get(`/reports/overview?${WIDE()}`)).current;
  assert.equal(is.net_goods_revenue, ov.net_revenue, 'doanh thu thuần hàng');
  assert.equal(is.gross_profit - bal('6411') - bal('6412'), ov.gross_profit, 'lãi gộp sổ cái trừ phí sàn/ship = lãi gộp báo cáo');
  // Tổng theo shop, kênh, ngày phải khớp tổng quan
  const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
  for (const [path, key] of [['shops', 'platform_fee'], ['channels', 'platform_fee'], ['shops', 'gross_profit'], ['channels', 'net_revenue']]) {
    const rows = ok(await api.get(`/reports/${path}?${WIDE()}`));
    assert.equal(sum(rows, key), ov[key], `${path}.${key}`);
  }
}

// ---------- A. Phí sàn được hoàn ----------
test('A: đơn sàn 200.000, phí sàn 24.000, trả toàn bộ → sàn hoàn đủ phí, không còn gì phải thu, lãi gộp 0', async () => {
  const { api, shopee, ret, order, ov } = await world();
  const o = await shopee();
  assert.equal(o.net_amount, 176000);
  const r = await ret(o, {});
  assert.equal(r.status, 'returned');
  assert.equal(r.returns[0].platform_fee_refund_amount, 24000);
  assert.equal(r.platform_fee_amount, 24000, 'phí sàn gốc không đổi');
  assert.equal(r.platform_fee_refunded_amount, 24000);
  assert.equal(r.returned_goods_amount, 200000);
  assert.equal(r.returned_amount, 176000, 'giảm số phải thu = hàng trả − phí sàn được hoàn');
  assert.equal(r.amount_due, 0);
  assert.equal(r.gross_profit, 0);
  const d = await order(o);
  assert.equal(d.gross_profit, 0);
  const rep = await ov();
  assert.equal(rep.platform_fee, 0, 'phí sàn thuần = phí − phí được hoàn');
  assert.equal(rep.gross_profit, 0);
  assert.equal((await api.get('/reconciliation/pending')).body.total_pending, 0);
  assert.equal(bal('6411'), 0, 'chi phí phí sàn về 0');
  assert.equal(bal('1388'), 0, 'không còn phải thu sàn');
  await sound(api);
});

test('A: trả một phần → hoàn phí theo tỷ lệ luỹ kế; tiền treo và tuổi nợ chỉ còn phần chưa trả', async () => {
  const { api, shopee, ret, ov } = await world();
  const o = await shopee({ lines: [{ sku: 'A1', qty: 3, unit_price: 100000 }], platform_fee_amount: 10000 });
  assert.equal(o.net_amount, 290000);
  const r1 = await ret(o, {}, 1);
  assert.equal(r1.returns[0].platform_fee_refund_amount, 3333);
  const r2 = await ret(o, {}, 1);
  assert.equal(r2.returns[1].platform_fee_refund_amount, 3334, 'luỹ kế 6667 − 3333');
  assert.equal(r2.returned_amount, 200000 - 6667);
  const pend = (await api.get('/reconciliation/pending')).body;
  assert.equal(pend.data.find((x) => x.id === o.id).pending_amount, 290000 - 193333);
  assert.equal(pend.total_pending, 290000 - 193333);
  const aging = ok(await api.get(`/reports/aging?${WIDE()}`));
  const marketplaceOwed = JSON.stringify(aging).includes(String(290000 - 193333));
  assert.ok(marketplaceOwed, 'tuổi nợ dùng cùng số phải thu');
  const r3 = await ret(o, {}, 1);
  assert.equal(r3.returns[2].platform_fee_refund_amount, 3333, 'trả hết: tổng hoàn = đúng toàn bộ phí');
  assert.equal(r3.platform_fee_refunded_amount, 10000);
  assert.equal((await ov()).platform_fee, 0);
  await sound(api);
});

test('A: sửa được số phí hoàn (kể cả 0), vượt phí còn lại bị chặn, kênh thường không có', async () => {
  const { api, shopee, sell, ret, order } = await world();
  const o = await shopee();
  const over = await ret(o, { platform_fee_refund_amount: 24001 }, 1, null);
  assert.equal(over.body.error.code, 'OVER_PLATFORM_FEE_REFUND');
  const zero = await ret(o, { platform_fee_refund_amount: 0 }, 1);
  assert.equal(zero.returns[0].platform_fee_refund_amount, 0, 'hoàn tiền ngay không trả hàng: sàn vẫn tính phí');
  assert.equal(zero.returned_amount, 100000);
  const some = await ret(o, { platform_fee_refund_amount: 5000 }, 1);
  assert.equal(some.platform_fee_refunded_amount, 5000);
  assert.equal(some.gross_profit, 176000 - 200000 + 5000 - 0, 'lãi gộp = net − hàng trả + phí hoàn − giá vốn(0)');
  assert.equal((await order(o)).status, 'returned');
  const direct = await sell({ lines: [{ sku: 'B1', qty: 1, unit_price: 80000 }] });
  const bad = await ret(direct, { platform_fee_refund_amount: 1 }, 1, null);
  assert.equal(bad.body.error.code, 'NOT_MARKETPLACE');
  // Phí sàn của đơn không được sửa xuống dưới phần đã hoàn
  const low = await api.patch(`/orders/${o.id}`, { platform_fee_amount: 4000 });
  assert.equal(low.status, 400);
  assert.equal(low.body.error.code, 'PLATFORM_FEE_BELOW_REFUNDED');
  await sound(api);
});

test('A: xem trước phiếu trả cho số mặc định; gỡ phiếu chờ hàng về đảo cả phí sàn được hoàn', async () => {
  const { api, shopee, ret, order, ov } = await world();
  const o = await shopee();
  const pv = ok(await api.post(`/orders/${o.id}/returns/preview`, { lines: [{ order_line_id: o.lines[0].id, qty: 1 }] }));
  assert.deepEqual([pv.goods_amount, pv.platform_fee_refund_default, pv.platform_fee_refund_max, pv.is_marketplace], [100000, 12000, 24000, true]);
  const r = await ret(o, { awaiting_goods: true }, 2);
  assert.equal(r.platform_fee_refunded_amount, 24000);
  assert.equal(r.status, 'returned');
  removeAwaitingReturn(o.id, r.returns[0].id, { restoreStatus: 'completed' });
  const back = await order(o);
  assert.equal(back.platform_fee_refunded_amount, 0);
  assert.equal(back.returned_amount, 0);
  assert.equal(back.status, 'completed');
  assert.equal((await ov()).platform_fee, 24000);
  await sound(api);
});

test('A: xuất đơn có cột phí sàn được hoàn', async () => {
  const { api, shopee, ret } = await world();
  const o = await shopee();
  await ret(o, {}, 1);
  const csv = (await api.get('/orders/export?format=csv')).body;
  assert.match(csv, /Phí sàn được hoàn/);
  assert.match(csv, /12000/);
});

// ---------- B. Giảm giá sau bán ----------
test('B: khách nhận hàng lỗi, shop hoàn nửa tiền, khách giữ hàng: không đụng kho/giá vốn, doanh thu và báo cáo theo sản phẩm khớp', async () => {
  const { api, sell, order, ov, stock } = await world();
  const o = await sell({ lines: [{ sku: 'A1', qty: 2, unit_price: 100000 }, { sku: 'B1', qty: 1, unit_price: 80000 }], shipping_fee: 20000, payments: [{ amount: 300000, method: 'cash' }] });
  const before = { cogs: o.cogs_amount, a: await stock('A1'), b: await stock('B1') };
  const r = ok(await api.post(`/orders/${o.id}/allowances`, { amount: 100000, reason_code: 'defective', reason: 'Nông sản dập nát', refund: { amount: 100000, method: 'cash' } }));
  assert.equal(r.status, 'completed', 'không chuyển sang returned');
  assert.equal(r.returns[0].kind, 'allowance');
  assert.equal(r.returns[0].goods_amount, 100000);
  assert.deepEqual(r.returns[0].lines.map((l) => l.qty), [0, 0]);
  assert.equal(r.returns[0].lines.reduce((s, l) => s + l.value, 0), 100000, 'chia cho các dòng bằng allocate, tổng đúng');
  assert.match(r.returns[0].code, /^GG-/);
  assert.equal(r.net_revenue, 280000 - 100000);
  assert.equal(r.paid_amount, 200000);
  assert.equal(r.refund_owed_amount, 0);
  assert.equal(r.cogs_amount, before.cogs, 'giá vốn không đổi');
  assert.equal(r.lines[0].returned_qty, 0);
  assert.equal(await stock('A1'), before.a);
  assert.equal(await stock('B1'), before.b);
  assert.equal(r.gross_profit, 180000 + 20000 - before.cogs);
  assert.equal((await ov()).net_revenue, 180000);
  // Doanh thu theo sản phẩm cộng ra đúng doanh thu thuần
  const prods = ok(await api.get(`/reports/products?${WIDE()}&limit=100`));
  assert.equal(prods.reduce((s, p) => s + p.revenue, 0), 180000);
  // Lý do được thống kê
  const rep = ok(await api.get(`/reports/return-reasons?${WIDE()}`));
  assert.equal(rep.rows.find((x) => x.reason_code === 'defective').goods_amount, 100000);
  // Trang Chứng từ, phiếu in, xuất file không vỡ
  const docs = ok(await api.get('/documents?type=return'));
  assert.ok(docs.some((d) => d.code === r.returns[0].code));
  assert.equal((await api.get(`/orders/${o.id}/receipt`)).status, 200);
  assert.equal((await api.get('/orders/export?format=csv')).status, 200);
  assert.equal((await api.get('/orders/export?format=csv&layout=lines')).status, 200);
  assert.equal(bal('5212'), 100000);
  assert.equal(bal('131'), 0);
  await sound(api);
  void order;
});

test('B: chưa thu tiền thì chỉ giảm nợ; đã thu đủ thì thành khoản shop nợ khách, hoàn sau được nhưng không quá', async () => {
  const { api, sell } = await world();
  const debt = await sell({ lines: [{ sku: 'A1', qty: 1, unit_price: 100000 }], payments: [{ amount: 40000, method: 'cash' }] });
  assert.equal(debt.amount_due, 60000);
  const d = ok(await api.post(`/orders/${debt.id}/allowances`, { amount: 25000 }));
  assert.equal(d.amount_due, 35000);
  assert.equal(d.refund_owed_amount, 0);
  const paid = await sell({ lines: [{ sku: 'A1', qty: 1, unit_price: 100000 }], payments: [{ amount: 100000, method: 'cash' }] });
  const p = ok(await api.post(`/orders/${paid.id}/allowances`, { amount: 30000 }));
  assert.equal(p.refund_owed_amount, 30000);
  assert.equal(p.needs_refund, true);
  const tooMuch = await api.post(`/orders/${paid.id}/payments`, { amount: 30001, direction: 'out', method: 'cash' });
  assert.equal(tooMuch.body.error.code, 'OVER_REFUND');
  const settled = ok(await api.post(`/orders/${paid.id}/payments`, { amount: 30000, direction: 'out', method: 'cash' }));
  assert.equal(settled.refund_owed_amount, 0);
  // Giảm vượt tiền hàng còn lại và hoàn quá số nợ khách đều bị chặn
  const over = await api.post(`/orders/${paid.id}/allowances`, { amount: 70001 });
  assert.equal(over.body.error.code, 'OVER_ALLOWANCE');
  const refundTooMuch = await api.post(`/orders/${debt.id}/allowances`, { amount: 10000, refund: { amount: 10000, method: 'cash' } });
  assert.equal(refundTooMuch.body.error.code, 'OVER_REFUND', 'đơn chưa trả đủ: không có gì để hoàn');
  await sound(api);
});

test('B: giảm giá sau bán rồi trả hàng một phần: tổng không vượt tiền thực của dòng; trả hết vẫn khớp', async () => {
  const { api, sell, ret, order } = await world();
  const o = await sell({ lines: [{ sku: 'A1', qty: 4, unit_price: 100000 }], payments: [{ amount: 400000, method: 'cash' }] });
  ok(await api.post(`/orders/${o.id}/allowances`, { amount: 90000 }));
  const part = await ret(o, {}, 1);
  assert.ok(part.returns[1].goods_amount <= 100000 - 90000 / 4 + 1);
  const rest = await ret(o, {}, 3);
  assert.equal(rest.status, 'returned');
  const d = await order(o);
  assert.equal(d.returned_goods_amount, 400000, 'giảm + trả = đúng tiền hàng của dòng');
  assert.equal(d.net_revenue, 0);
  await sound(api);
});

test('B: đơn sàn: chỉ giảm số phải thu sàn, không trả tiền khách, phí sàn không hoàn; đơn nháp/huỷ bị từ chối', async () => {
  const { api, shopee, sell, ov } = await world();
  const o = await shopee();
  const bad = await api.post(`/orders/${o.id}/allowances`, { amount: 20000, refund: { amount: 1, method: 'cash' } });
  assert.equal(bad.body.error.code, 'MARKETPLACE_RETURN');
  const r = ok(await api.post(`/orders/${o.id}/allowances`, { amount: 20000, reason_code: 'not_as_described' }));
  assert.equal(r.platform_fee_refunded_amount, 0);
  assert.equal(r.returned_amount, 20000);
  assert.equal(r.amount_due, 176000 - 20000);
  assert.equal(r.gross_profit, 176000 - 20000 - r.cogs_amount);
  assert.equal(r.refund_owed_amount, 0);
  assert.equal((await ov()).platform_fee, 24000);
  const draft = await sell({ status: 'draft', lines: [{ sku: 'B1', qty: 1, unit_price: 80000 }] });
  assert.equal((await api.post(`/orders/${draft.id}/allowances`, { amount: 1000 })).status, 409);
  assert.equal((await api.post(`/orders/${o.id}/allowances`, { amount: 0 })).status, 400);
  await sound(api);
});

test('B: hoàn thành tiền khách gửi (to_credit) cho khoản giảm giá', async () => {
  const { api, sell, nh } = await world();
  const c = ok(await api.post('/customers', { name: 'Khách giữ hàng', phone: '0907777888', shop_id: nh.id }));
  const o = await sell({ customer_id: c.id, lines: [{ sku: 'A1', qty: 1, unit_price: 100000 }], payments: [{ amount: 100000, method: 'cash' }] });
  const r = ok(await api.post(`/orders/${o.id}/allowances`, { amount: 40000, refund: { amount: 40000, to_credit: true } }));
  assert.equal(r.customer_credit_balance, 40000);
  await sound(api);
});

// ---------- C. Hàng trả về vào lại lô ----------
test('C: bán xuyên 2 lô, trả một phần, huỷ đơn khác → từng lô còn đúng; check-stock sạch', async () => {
  const { api, nh, wh, a, stock } = await world();
  const sup = ok(await api.post('/suppliers', { name: 'NCC lô' }));
  const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  // Dùng sản phẩm riêng, không lẫn lô với tồn đã nhập không ghi lô ở world()
  const v = ok(await api.post('/products', { name: 'Nông sản', variants: [{ sku: 'NS1', default_price: 50000 }], shop_ids: [nh.id] })).variants[0];
  void a;
  const mk = (qty, lot, exp) => api.post('/purchases', { supplier_id: sup.id, warehouse_id: wh.id, receive: true, lines: [{ variant_id: v.id, qty, unit_cost: 20000, lot_no: lot, expiry_date: exp }] });
  ok(await mk(5, 'L-EARLY', inDays(30)));
  ok(await mk(5, 'L-LATE', inDays(90)));
  const lots = async () => Object.fromEntries(ok(await api.get('/stock-lots')).map((l) => [l.lot_no, l.qty]));
  const mkOrder = async (qty, status = 'completed') => ok(await api.post('/orders', { shop_id: nh.id, channel_id: 'direct', status, lines: [{ variant_id: v.id, qty, unit_price: 50000 }] }));
  const o1 = await mkOrder(7); // FEFO: 5 từ L-EARLY, 2 từ L-LATE
  assert.deepEqual(await lots(), { 'L-LATE': 3 });
  // Trả 3 (nhập lại kho): lô lấy sau cùng trả trước → 2 về L-LATE, 1 về L-EARLY
  ok(await api.post(`/orders/${o1.id}/returns`, { lines: [{ order_line_id: o1.lines[0].id, qty: 3, restock: true }] }));
  assert.deepEqual(await lots(), { 'L-LATE': 5, 'L-EARLY': 1 });
  assert.equal(await stock('NS1'), 10 - 7 + 3);
  // Đơn khác lấy 4 (1 L-EARLY + 3 L-LATE) rồi huỷ → trả đúng lô
  const o2 = await mkOrder(4, 'confirmed');
  assert.deepEqual(await lots(), { 'L-LATE': 2 });
  ok(await api.post(`/orders/${o2.id}/status`, { status: 'cancelled' }));
  assert.deepEqual(await lots(), { 'L-LATE': 5, 'L-EARLY': 1 });
  // Trả nốt 4 còn lại của đơn 1 (đã lấy 5 từ EARLY, 2 từ LATE; đã trả 1 EARLY + 2 LATE) → 4 phải về EARLY
  ok(await api.post(`/orders/${o1.id}/returns`, { lines: [{ order_line_id: o1.lines[0].id, qty: 4, restock: true }] }));
  assert.deepEqual(await lots(), { 'L-LATE': 5, 'L-EARLY': 5 });
  assert.equal(await stock('NS1'), 10);
  assert.deepEqual(verifyStock(), []);
  // Hạn dùng giữ nguyên
  const byLot = Object.fromEntries(ok(await api.get('/stock-lots')).map((l) => [l.lot_no, l.expiry_date]));
  assert.equal(byLot['L-EARLY'], inDays(30));
  assert.equal(byLot['L-LATE'], inDays(90));
});

test('C: trả về kho khác mang lô theo; sửa đơn đã xác nhận và nhận hàng chờ về cũng đúng lô; đơn cũ không dấu vết giữ hành vi cũ', async () => {
  const { api, nh, wh } = await world();
  const sup = ok(await api.post('/suppliers', { name: 'NCC lô 2' }));
  const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const v = ok(await api.post('/products', { name: 'Mật ong', variants: [{ sku: 'MO1', default_price: 90000 }], shop_ids: [nh.id] })).variants[0];
  ok(await api.post('/purchases', { supplier_id: sup.id, warehouse_id: wh.id, receive: true, lines: [{ variant_id: v.id, qty: 6, unit_cost: 30000, lot_no: 'M1', expiry_date: inDays(20) }] }));
  ok(await api.post('/purchases', { supplier_id: sup.id, warehouse_id: wh.id, receive: true, lines: [{ variant_id: v.id, qty: 6, unit_cost: 30000, lot_no: 'M2', expiry_date: inDays(60) }] }));
  const lots = async (whId) => Object.fromEntries(ok(await api.get(`/stock-lots${whId ? `?warehouse_id=${whId}` : ''}`)).map((l) => [`${l.warehouse_name}:${l.lot_no}`, l.qty]));
  const mkOrder = async (qty, status) => ok(await api.post('/orders', { shop_id: nh.id, channel_id: 'direct', status, lines: [{ variant_id: v.id, qty, unit_price: 90000 }] }));
  // Sửa đơn đã xác nhận 8 → 2: hàng về đúng lô rồi lấy lại theo FEFO
  const o = await mkOrder(8, 'confirmed');
  assert.deepEqual(await lots(), { 'Kho chính:M2': 4 });
  ok(await api.patch(`/orders/${o.id}`, { lines: [{ variant_id: v.id, qty: 2, unit_price: 90000 }] }));
  assert.deepEqual(await lots(), { 'Kho chính:M1': 4, 'Kho chính:M2': 6 });
  // Giao không thành (chờ hàng về) rồi nhận: lô chỉ được cộng lúc nhận
  const o2 = await mkOrder(3, 'shipping');
  assert.deepEqual(await lots(), { 'Kho chính:M1': 1, 'Kho chính:M2': 6 });
  const r = ok(await api.post(`/orders/${o2.id}/returns`, { lines: [{ order_line_id: o2.lines[0].id, qty: 3, restock: true }], awaiting_goods: true }));
  assert.deepEqual(await lots(), { 'Kho chính:M1': 1, 'Kho chính:M2': 6 });
  ok(await api.post(`/orders/${o2.id}/returns/${r.returns[0].id}/receive`, {}));
  assert.deepEqual(await lots(), { 'Kho chính:M1': 4, 'Kho chính:M2': 6 }, 'cả 3 lấy từ M1 nên về M1');
  // Trả về kho khác: lô đi theo hàng
  const wh2 = ok(await api.post('/warehouses', { name: 'Kho B', code: 'KB' }));
  await api.put(`/shops/${nh.id}/warehouses`, { warehouse_ids: [wh.id, wh2.id] });
  const o3 = await mkOrder(2, 'completed');
  ok(await api.post(`/orders/${o3.id}/returns`, { lines: [{ order_line_id: o3.lines[0].id, qty: 2, restock: true, warehouse_id: wh2.id }] }));
  assert.deepEqual(await lots(wh2.id), { 'Kho B:M1': 2 });
  assert.deepEqual(verifyStock(), []);
  // Đơn cũ không có dấu vết lô: xoá dấu vết rồi huỷ → tồn tăng nhưng lô không đổi (hành vi cũ)
  const o4 = await mkOrder(1, 'confirmed');
  getDb().prepare('DELETE FROM order_line_lots WHERE order_line_id = ?').run(o4.lines[0].id);
  const lotsBefore = await lots();
  ok(await api.post(`/orders/${o4.id}/status`, { status: 'cancelled' }));
  assert.deepEqual(await lots(), lotsBefore, 'không có dấu vết lô thì lô không đổi');
  assert.deepEqual(verifyStock(), []);
});
