import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { getDb } from '../server/db/index.js';
import { addDays, businessDate } from '../server/lib/time.js';
import { verifyJournal, flushJournal } from '../server/modules/accounting/journal.js';
import { verifyStats } from '../server/modules/reports/stats.js';

/**
 * Phiếu trả hàng kiểu KiotViet: hàng trả, hoàn ship, phí trả hàng, ship chiều về, cần trả khách, còn nợ khách.
 * Mỗi kịch bản đối chiếu: số trên đơn, báo cáo tổng quan, báo cáo dòng tiền, sổ kế toán (131, 5111/5212/5113/5118, 632/156).
 * Đơn mẫu: 2 × 150.000, giảm giá đơn 30.000, ship 20.000 → hàng 270.000, khách trả 290.000; một cái trả lại = 135.000.
 */
const WIDE = () => `from=${addDays(businessDate(), -3)}&to=${businessDate()}`;
const ok = (r, s = [200, 201]) => {
  assert.ok([].concat(s).includes(r.status), JSON.stringify(r.body));
  return r.body.data;
};
const one = (sql, ...p) => getDb().prepare(sql).get(...p);
const bal = (code) => (flushJournal(), one("SELECT COALESCE(SUM(l.debit - l.credit),0) AS v FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.voided_at IS NULL AND l.account_code = ?", code).v);

async function world() {
  const ctx = await setup();
  const { api, nh, wh } = ctx;
  const mk = async (sku, price) => ok(await api.post('/products', { name: sku, variants: [{ sku, default_price: price }], shop_ids: [nh.id] })).variants[0];
  const a = await mk('A1', 150000);
  const b = await mk('B1', 80000);
  ok(await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: a.id, qty: 40, unit_cost: 40000 }, { variant_id: b.id, qty: 40, unit_cost: 30000 }] }));
  const sell = async (o) => ok(await api.post('/orders', { shop_id: nh.id, status: 'completed', ...o }));
  const sample = (extra = {}) => sell({ lines: [{ sku: 'A1', qty: 2, unit_price: 150000 }], discount_amount: 30000, shipping_fee: 20000, payments: [{ amount: 290000, method: 'cash' }], ...extra });
  const ret = (o, body, s = 200) => api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: o.lines[0].id, qty: 1, restock: true }], ...body }).then((r) => (s ? ok(r, s) : r));
  const view = async (o) => {
    const order = ok(await api.get(`/orders/${o.id}`));
    const ov = ok(await api.get(`/reports/overview?${WIDE()}`)).current;
    const cf = ok(await api.get(`/reports/cashflow?${WIDE()}`));
    return { order, ov, cf };
  };
  return { ...ctx, sell, sample, ret, view };
}

async function sound(api) {
  assert.deepEqual(verifyJournal(), []);
  assert.deepEqual(verifyStats(), []);
  assert.equal(ok(await api.get('/accounting/balance-sheet')).balanced, true);
  const is = ok(await api.get(`/accounting/income-statement?${WIDE()}`));
  const ov = ok(await api.get(`/reports/overview?${WIDE()}`)).current;
  assert.equal(is.net_goods_revenue, ov.net_revenue, 'doanh thu thuần hàng');
  assert.equal(is.revenue_shipping, ov.shipping_fee, 'phí ship (đã trừ hoàn)');
  assert.equal(is.revenue_return_fee, ov.return_fee, 'phí trả hàng thu được');
  // Kịch bản không có chi phí tay vào 6411/6412: lãi gộp báo cáo = lãi gộp sổ cái − phí sàn − ship shop chịu − ship chiều về
  assert.equal(is.gross_profit - bal('6411') - bal('6412'), ov.gross_profit, 'lãi gộp sổ cái trừ phí sàn/ship = lãi gộp báo cáo');
}

test('Hoàn đủ tiền, nhập lại kho: doanh thu giảm đúng giá trị hàng, 131 về 0', async () => {
  const { api, sample, ret, view } = await world();
  const o = await sample();
  assert.equal(o.total_amount, 290000);
  const after = await ret(o, { refund: { amount: 135000, method: 'cash' } });
  assert.equal(after.returns[0].goods_amount, 135000);
  const { order, ov, cf } = await view(o);
  assert.equal(order.returned_goods_amount, 135000);
  assert.equal(order.returned_amount, 135000);
  assert.equal(order.refund_owed_amount, 0);
  assert.equal(order.net_revenue, 135000);
  assert.equal(order.paid_amount, 155000);
  assert.equal(order.gross_profit, 135000 + 20000 - 40000, 'lãi gộp = hàng thuần + ship − giá vốn còn lại');
  assert.equal(ov.net_revenue, 135000);
  assert.equal(ov.shipping_fee, 20000);
  assert.equal(ov.gross_profit, order.gross_profit);
  assert.equal(cf.customer_refund_owed, 0);
  assert.equal(bal('131'), 0);
  assert.equal(bal('5212'), 135000);
  assert.equal(bal('5111'), -270000);
  assert.equal(bal('632'), 40000);
  await sound(api);
});

test('Đơn có giảm giá chia theo 2 dòng: trả hết từng dòng thì tổng giá trị trả = tiền hàng đơn, không lệch đồng nào', async () => {
  const { api, sell } = await world();
  const o = await sell({ lines: [{ sku: 'A1', qty: 3, unit_price: 150000 }, { sku: 'B1', qty: 3, unit_price: 80000 }], discount_amount: 10001, shipping_fee: 0, payments: [{ amount: 679999, method: 'cash' }] });
  assert.equal(o.goods_revenue, 679999);
  let total = 0;
  for (const l of o.lines) {
    for (let i = 0; i < 3; i++) {
      const r = ok(await api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: l.id, qty: 1, restock: true }] }));
      total += r.returns.at(-1).goods_amount;
    }
  }
  assert.equal(total, 679999);
  const order = ok(await api.get(`/orders/${o.id}`));
  assert.equal(order.status, 'returned');
  assert.equal(order.net_revenue, 0);
  assert.equal(order.refund_owed_amount, 679999, 'không hoàn tiền nên còn nợ khách đúng bằng đã thu');
  await sound(api);
});

test('Không hoàn tiền, phí trả hàng 0: còn nợ khách 135.000; 131 dư Có đúng số đó; báo cáo hiện cùng số', async () => {
  const { api, sample, ret, view } = await world();
  const o = await sample();
  await ret(o, {});
  const { order, ov, cf } = await view(o);
  assert.equal(order.refund_owed_amount, 135000);
  assert.equal(order.needs_refund, true);
  assert.equal(order.payment_status, 'paid');
  assert.equal(ov.net_revenue, 135000);
  assert.equal(cf.customer_refund_owed, 135000);
  assert.equal(cf.customer_refund_owed_orders, 1);
  assert.equal(bal('131'), -135000);
  assert.equal(bal('131'), cf.customer_receivable - cf.customer_refund_owed);
  await sound(api);
});

test('Không hoàn tiền, phí trả hàng = toàn bộ giá trị: shop giữ tiền, doanh thu thuần + phí trả hàng và lãi không đổi so với trước khi trả', async () => {
  const { api, sample, ret, view } = await world();
  const o = await sample();
  const before = await view(o);
  const gpBefore = before.ov.gross_profit;
  await ret(o, { return_fee_amount: 135000 });
  const { order, ov, cf } = await view(o);
  assert.equal(order.return_fee_amount, 135000);
  assert.equal(order.returned_amount, 0, 'giảm số phải thu = 135.000 − 135.000');
  assert.equal(order.refund_owed_amount, 0);
  assert.equal(order.returns[0].amount_due_to_customer, 0);
  assert.equal(ov.net_revenue, 135000);
  assert.equal(ov.return_fee, 135000);
  assert.equal(ov.net_revenue + ov.return_fee, before.ov.net_revenue, 'hàng thuần + phí trả hàng = doanh thu trước khi trả');
  // Lãi chỉ khác ở giá vốn: 1 cái được nhập lại kho (giá vốn 40.000 giảm)
  assert.equal(ov.gross_profit, gpBefore + 40000);
  assert.equal(order.gross_profit, ov.gross_profit);
  assert.equal(cf.customer_refund_owed, 0);
  assert.equal(bal('131'), 0);
  assert.equal(bal('5118'), -135000);
  await sound(api);
});

test('Hoàn một phần rồi hoàn nốt bằng thanh toán chiều chi: còn nợ khách về 0; không hoàn quá số còn nợ', async () => {
  const { api, sample, ret, view } = await world();
  const o = await sample();
  await ret(o, { refund: { amount: 100000, method: 'bank' } });
  let v = await view(o);
  assert.equal(v.order.refund_owed_amount, 35000);
  assert.equal(v.cf.customer_refund_owed, 35000);
  assert.equal((await api.post(`/orders/${o.id}/payments`, { amount: 35001, method: 'bank', direction: 'out' })).status, 400, 'quá số còn nợ');
  ok(await api.post(`/orders/${o.id}/payments`, { amount: 35000, method: 'bank', direction: 'out' }));
  v = await view(o);
  assert.equal(v.order.refund_owed_amount, 0);
  assert.equal(v.cf.customer_refund_owed, 0);
  assert.equal(bal('131'), 0);
  await sound(api);
});

test('Đơn COD chưa thu, khách không nhận: hoàn cả ship, không còn phải thu, không còn doanh thu ship; ship chiều về là chi phí', async () => {
  const { api, sell, view } = await world();
  const o = await sell({ lines: [{ sku: 'A1', qty: 2, unit_price: 150000 }], discount_amount: 30000, shipping_fee: 20000 });
  assert.equal(o.paid_amount, 0);
  ok(await api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: o.lines[0].id, qty: 2, restock: true }], shipping_refund_amount: 20000, return_shipping_cost: 25000 }));
  const { order, ov, cf } = await view(o);
  assert.equal(order.status, 'returned');
  assert.equal(order.returned_amount, 290000);
  assert.equal(order.amount_due, 0);
  assert.equal(order.refund_owed_amount, 0);
  assert.equal(order.net_revenue, 0);
  assert.equal(ov.shipping_fee, 0, 'không còn doanh thu phí ship');
  assert.equal(ov.return_shipping_cost, 25000);
  assert.equal(ov.gross_profit, -25000);
  assert.equal(order.gross_profit, -25000);
  assert.equal(cf.customer_receivable, 0);
  assert.equal(bal('131'), 0);
  assert.equal(bal('5113'), 0);
  assert.equal(bal('6412'), 25000);
  assert.equal(bal('3388'), -25000);
  await sound(api);
});

test('Hàng hỏng, không nhập lại kho: giá vốn giữ nguyên', async () => {
  const { api, sample, view } = await world();
  const o = await sample();
  ok(await api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: o.lines[0].id, qty: 1, restock: false }], refund: { amount: 135000, method: 'cash' } }));
  const { order, ov } = await view(o);
  assert.equal(order.cogs_amount, 80000);
  assert.equal(ov.cogs, 80000);
  assert.equal(bal('632'), 80000);
  await sound(api);
});

test('Trả 3 lần, mỗi lần 1 cái trên dòng 100đ có 3 cái: tổng đúng 100đ (làm tròn luỹ kế)', async () => {
  const { api, sell } = await world();
  const o = await sell({ lines: [{ sku: 'A1', qty: 3, unit_price: 34, discount_amount: 2 }], shipping_fee: 0 });
  assert.equal(o.lines[0].line_total, 100);
  const vals = [];
  for (let i = 0; i < 3; i++) vals.push(ok(await api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: o.lines[0].id, qty: 1, restock: true }] })).returns.at(-1).goods_amount);
  assert.deepEqual(vals, [33, 34, 33]);
  assert.equal(vals.reduce((a, b) => a + b, 0), 100);
  await sound(api);
});

test('Chặn: tiền trả khách > cần trả khách; ship hoàn > ship còn lại; phí trả hàng > hàng + ship hoàn', async () => {
  const { api, sample, ret } = await world();
  const o = await sample();
  const code = async (body) => (await ret(o, body, null)).body.error?.code;
  assert.equal(await code({ refund: { amount: 135001, method: 'cash' } }), 'OVER_REFUND');
  assert.equal(await code({ return_fee_amount: 50000, refund: { amount: 85001, method: 'cash' } }), 'OVER_REFUND', 'cần trả khách = 135.000 − 50.000');
  assert.equal(await code({ shipping_refund_amount: 20001 }), 'OVER_SHIPPING_REFUND');
  assert.equal(await code({ return_fee_amount: 135001 }), 'OVER_RETURN_FEE');
  assert.equal(await code({ shipping_refund_amount: 20000, return_fee_amount: 155001 }), 'OVER_RETURN_FEE');
  ok(await ret(o, { shipping_refund_amount: 15000 }, 200).then((x) => ({ status: 200, body: { data: x } })));
  assert.equal(await code({ shipping_refund_amount: 5001 }), 'OVER_SHIPPING_REFUND', 'ship còn lại tính cả các phiếu trước');
  // Các lần bị chặn không để lại gì
  const order = ok(await api.get(`/orders/${o.id}`));
  assert.equal(order.returns.length, 1);
  assert.equal(order.lines[0].returned_qty, 1);
});

test('Kênh sàn: hàng trả giảm phải thu sàn (1388); không có hoàn ship, phí trả hàng, tiền trả khách; vẫn nhập được ship chiều về', async () => {
  const { api, nh, sell, ret, view } = await world();
  const o = await sell({ channel_id: 'shopee', external_id: 'SP-R1', lines: [{ sku: 'A1', qty: 2, unit_price: 150000 }], shipping_fee: 20000, platform_fee_amount: 30000 });
  assert.equal(o.net_amount, 320000 - 30000);
  const code = async (body) => (await ret(o, body, null)).body.error?.code;
  assert.equal(await code({ shipping_refund_amount: 1 }), 'MARKETPLACE_RETURN');
  assert.equal(await code({ return_fee_amount: 1 }), 'MARKETPLACE_RETURN');
  assert.equal(await code({ refund: { amount: 1, method: 'cash' } }), 'MARKETPLACE_RETURN');
  await ret(o, { return_shipping_cost: 12000 });
  const { order, ov, cf } = await view(o);
  assert.equal(order.returned_amount, 150000);
  assert.equal(order.refund_owed_amount, 0);
  assert.equal(order.returns[0].amount_due_to_customer, 0);
  assert.equal(cf.marketplace_pending, 290000 - 150000);
  assert.equal(bal('1388'), 290000 - 150000);
  assert.equal(ov.return_shipping_cost, 12000);
  assert.equal(bal('6412'), 12000);
  void nh;
  await sound(api);
});
