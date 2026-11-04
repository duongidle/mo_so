import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postingsFor, dr, cr, balanced } from '../server/modules/accounting/posting.js';

// Hàm thuần: ảnh chụp chứng từ → bút toán. Không cần DB.
const ctx = {
  cashAccountFor: (m) => (m === 'cash' ? '1111' : m === 'bank' ? '1121' : '1131'),
  cashLeg: (row) => row.account_code,
  expenseAccount: (c) => (c === 'ecat_ads' ? '6413' : '6428'),
};
const sums = (e) => {
  const by = {};
  for (const l of e.lines) by[l.account] = (by[l.account] || 0) + l.debit - l.credit;
  return by;
};
const order = (o) => ({ id: 'ord_1', code: 'DH-1', shop_id: 's1', channel_id: 'direct', customer_id: null, status: 'completed', business_date: '2026-11-03', goods_revenue: 270000, shipping_fee: 20000, total_amount: 290000, platform_fee_amount: 0, seller_shipping_amount: 0, net_amount: 290000, cogs_amount: 150000, ...o });

test('dr/cr: số âm sang bên đối diện, số 0 bỏ qua', () => {
  assert.deepEqual(dr('131', -5), { account: '131', debit: 0, credit: 5 });
  assert.deepEqual(cr('131', -5), { account: '131', debit: 5, credit: 0 });
  assert.equal(dr('131', 0), null);
  assert.equal(balanced([dr('a', 5), cr('b', 5)]), true);
});

test('Đơn kênh thường: Nợ 131 total; Có 5111 hàng, 5113 ship; giá vốn; phí ship shop chịu → 6412/3388', () => {
  const [e] = postingsFor('order', { o: order({ seller_shipping_amount: 15000, net_amount: 275000 }), returns: [], marketplace: false }, ctx);
  assert.deepEqual(sums(e), { 131: 290000, 5111: -270000, 5113: -20000, 6412: 15000, 3388: -15000, 632: 150000, 156: -150000 });
  assert.equal(e.date, '2026-11-03');
});

test('Đơn sàn: Nợ 1388 net, 6411 phí sàn, 6412; Có 5111, 5113', () => {
  const [e] = postingsFor('order', { o: order({ channel_id: 'shopee', platform_fee_amount: 25000, seller_shipping_amount: 5000, net_amount: 260000 }), returns: [], marketplace: true }, ctx);
  assert.deepEqual(sums(e), { 1388: 260000, 6411: 25000, 6412: 5000, 5111: -270000, 5113: -20000, 632: 150000, 156: -150000 });
});

test('Đơn nháp/huỷ: không bút toán; giá vốn gộp = giá vốn còn lại + giá vốn đã nhập lại ở phiếu trả', () => {
  assert.deepEqual(postingsFor('order', { o: order({ status: 'draft' }), returns: [], marketplace: false }, ctx), []);
  assert.deepEqual(postingsFor('order', { o: order({ status: 'cancelled', cogs_amount: 0 }), returns: [], marketplace: false }, ctx), []);
  const [e] = postingsFor('order', { o: order({ cogs_amount: 100000 }), returns: [{ restored_cost: 50000 }], marketplace: false }, ctx);
  assert.equal(sums(e)[632], 150000);
});

test('Trả hàng: Nợ 5212 / Có 131; nhập lại kho Nợ 156 / Có 632; vào ngày của đơn gốc', () => {
  const ret = { id: 'ret_1', code: 'TH-1', goods_amount: 90000, business_date: '2026-11-04', lines: [{ restock: true, restored_cost: 50000 }, { restock: false, restored_cost: 0 }] };
  const [e] = postingsFor('return', { ret, o: order(), marketplace: false }, ctx);
  assert.deepEqual(sums(e), { 5212: 90000, 131: -90000, 156: 50000, 632: -50000 });
  assert.equal(e.date, '2026-11-03');
  const [m] = postingsFor('return', { ret, o: order({ channel_id: 'shopee' }), marketplace: true }, ctx);
  assert.equal(sums(m)[1388], -90000);
});

test('Thanh toán: thu đơn / hoàn tiền / trả NCC / NCC hoàn; phương thức chưa gán quỹ → 1131; đã huỷ → không có', () => {
  const p = (o) => ({ id: 'pay_1', direction: 'in', ref_type: 'order', ref_id: 'ord_1', shop_id: 's1', amount: 1000, method: 'cash', business_date: '2026-11-03', voided_at: null, ...o });
  assert.deepEqual(sums(postingsFor('payment', { p: p(), order: { code: 'DH-1' }, marketplace: false }, ctx)[0]), { 1111: 1000, 131: -1000 });
  assert.deepEqual(sums(postingsFor('payment', { p: p({ direction: 'out' }), order: { code: 'DH-1' }, marketplace: false }, ctx)[0]), { 131: 1000, 1111: -1000 });
  assert.deepEqual(sums(postingsFor('payment', { p: p({ method: 'bank', ref_type: 'order' }), order: { code: 'x' }, marketplace: true }, ctx)[0]), { 1121: 1000, 1388: -1000 });
  assert.deepEqual(sums(postingsFor('payment', { p: p({ ref_type: 'purchase', direction: 'out' }), purchase: { code: 'PN' } }, ctx)[0]), { 331: 1000, 1111: -1000 });
  assert.deepEqual(sums(postingsFor('payment', { p: p({ ref_type: 'purchase', direction: 'in' }), purchase: { code: 'PN' } }, ctx)[0]), { 1111: 1000, 331: -1000 });
  assert.equal(sums(postingsFor('payment', { p: p({ method: 'ewallet' }), order: null }, ctx)[0])[1131], 1000);
  assert.deepEqual(postingsFor('payment', { p: p({ voided_at: 'x' }) }, ctx), []);
});

test('Phiếu nhập: chỉ khi đã nhận (huỷ/nháp = không có bút toán)', () => {
  const pu = (s) => ({ id: 'pur_1', code: 'PN-1', status: s, total_amount: 500, received_at: '2026-11-03T05:00:00.000Z', shop_id: null, supplier_id: 'sup_1' });
  assert.deepEqual(sums(postingsFor('purchase', { pu: pu('received') }, ctx)[0]), { 156: 500, 331: -500 });
  assert.deepEqual(postingsFor('purchase', { pu: pu('cancelled') }, ctx), []);
  assert.deepEqual(postingsFor('purchase', { pu: pu('draft') }, ctx), []);
});

test('Chi phí: Nợ tài khoản danh mục (kèm shop) / Có quỹ theo phương thức; chưa có phương thức → 3388; đã huỷ → không có', () => {
  const e = (o) => ({ id: 'exp_1', category_id: 'ecat_ads', category_name: 'Quảng cáo', shop_id: 's1', channel_id: null, amount: 700, expense_date: '2026-11-03', method: 'bank', voided_at: null, ...o });
  const [x] = postingsFor('expense', { e: e() }, ctx);
  assert.deepEqual(sums(x), { 6413: 700, 1121: -700 });
  assert.equal(x.lines[0].shop_id, 's1');
  assert.equal(postingsFor('expense', { e: e({ shop_id: null }) }, ctx)[0].lines[0].shop_id, null, 'chi phí chung giữ shop NULL');
  assert.deepEqual(sums(postingsFor('expense', { e: e({ method: '' }) }, ctx)[0]), { 6413: 700, 3388: -700 });
  assert.deepEqual(postingsFor('expense', { e: e({ voided_at: 'x' }) }, ctx), []);
});

test('Kho và quỹ: điều chỉnh tăng/giảm/hỏng/tồn đầu, số dư đầu quỹ, chuyển quỹ, kiểm đếm', () => {
  const mv = (type, qty, unit_cost) => ({ id: 'mov_' + type, type, qty, unit_cost, ref_id: 'adj_1', business_date: '2026-11-03' });
  const [s] = postingsFor('stock', { movements: [mv('adjust_in', 3, 100), mv('adjust_out', -2, 50), mv('damage_out', -1, 50), mv('opening', 10, 20)] }, ctx);
  assert.deepEqual(sums(s), { 156: 300 - 150 + 200, 711: -300, 811: 150, 411: -200 });
  const [o] = postingsFor('cash_open', { account: { id: 'cac_1', name: 'Két', account_code: '1111', opening_balance: 5000, opening_date: null } }, ctx);
  assert.deepEqual(sums(o), { 1111: 5000, 411: -5000 });
  assert.deepEqual(postingsFor('cash_open', { account: { account_code: '1111', opening_balance: 0 } }, ctx), []);
  const [t] = postingsFor('cash_entry', { rows: [{ id: 'a', kind: 'transfer', pair_id: 'p', amount: -300, entry_date: '2026-11-03', account_code: '1111' }, { id: 'b', kind: 'transfer', pair_id: 'p', amount: 300, entry_date: '2026-11-03', account_code: '1121' }] }, ctx);
  assert.deepEqual(sums(t), { 1111: -300, 1121: 300 });
  assert.deepEqual(sums(postingsFor('cash_entry', { rows: [{ id: 'c', kind: 'adjust', amount: 100, entry_date: '2026-11-03', account_code: '1111' }] }, ctx)[0]), { 1111: 100, 711: -100 });
  assert.deepEqual(sums(postingsFor('cash_entry', { rows: [{ id: 'c', kind: 'adjust', amount: -100, entry_date: '2026-11-03', account_code: '1111' }] }, ctx)[0]), { 811: 100, 1111: -100 });
});
