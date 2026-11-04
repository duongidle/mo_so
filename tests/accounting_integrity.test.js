import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { getDb } from '../server/db/index.js';
import { addDays, businessDate } from '../server/lib/time.js';
import { verifyJournal, flushJournal } from '../server/modules/accounting/journal.js';
import { balanceOf } from '../server/modules/cash/service.js';

/**
 * Sổ cái kế toán là dữ liệu dẫn xuất: sau MỌI loại thao tác, nó phải khớp báo cáo và sổ kho/quỹ đến từng đồng.
 * Kịch bản: 2 shop, 2 kho, đơn trực tiếp + sàn (Shopee, TikTok), giảm giá, phí ship hai phía, phí sàn, trả hàng một phần/toàn phần
 * (nhập lại / không nhập lại), huỷ sau khi xác nhận, đơn lấy hàng từ hai kho, combo, thanh toán nhiều phương thức, hoàn tiền,
 * nhập hàng (nhận, trả, huỷ có NCC hoàn tiền), chi phí riêng/chung, điều chỉnh/hỏng/tồn đầu/kiểm kê kho, chuyển quỹ, kiểm đếm quỹ, quỹ mở sổ giữa chừng.
 */
const day = (n) => `${addDays(businessDate(), -n)}T04:00:00.000Z`;
const WIDE = () => `from=${addDays(businessDate(), -12)}&to=${businessDate()}`;
const ok = (r, s = [200, 201]) => {
  assert.ok([].concat(s).includes(r.status), JSON.stringify(r.body));
  return r.body.data;
};

async function world() {
  const ctx = await setup();
  const { api, nh, pt, wh } = ctx;
  const k2 = ok(await api.post('/warehouses', { code: 'K2', name: 'Kho B' }));
  ok(await api.put(`/shops/${nh.id}/warehouses`, { warehouse_ids: [wh.id, k2.id] }));
  ok(await api.post('/platforms/tiktok/enable'));
  // Quỹ ví TikTok mở sổ HÔM NAY: tiền payout ngày trước đó nằm trong số dư đầu, phía tiền đối ứng với 411
  ok(await api.patch('/cash/accounts/cac_bank', { methods: ['bank', 'shopee_payout', 'card', 'ewallet', 'other'] }));
  const wallet = ok(await api.post('/cash/accounts', { name: 'Ví TikTok', kind: 'ewallet', methods: ['tiktok_payout'], opening_balance: 50000, opening_date: businessDate() }));
  assert.equal(wallet.account_code, '1122');
  const mkP = async (name, sku, price, shops) => ok(await api.post('/products', { name, variants: [{ sku, default_price: price }], shop_ids: shops })).variants[0];
  const a = await mkP('A', 'A1', 100000, [nh.id, pt.id]);
  const b = await mkP('B', 'B1', 80000, [nh.id, pt.id]);
  const c = await mkP('C', 'C1', 50000, [nh.id]);
  const combo = ok(await api.post('/products', { name: 'Combo', variants: [{ sku: 'CB1', kind: 'bundle', default_price: 250000, components: [{ variant_id: a.id, qty: 2 }, { variant_id: b.id, qty: 1 }] }], shop_ids: [pt.id] })).variants[0];
  const sup = ok(await api.post('/suppliers', { name: 'NCC 1' }));
  // Nhập hàng: có phí ship nhập (phân bổ làm tròn), trả một phần, nhập ở kho 2, huỷ có NCC hoàn tiền
  const pur1 = ok(await api.post('/purchases', { supplier_id: sup.id, warehouse_id: wh.id, receive: true, shipping_fee: 10000, lines: [{ variant_id: a.id, qty: 40, unit_cost: 40000 }, { variant_id: b.id, qty: 40, unit_cost: 30000 }] }));
  ok(await api.post(`/purchases/${pur1.id}/payments`, { amount: 1500000, method: 'bank' }));
  const pur2 = ok(await api.post('/purchases', { supplier_id: sup.id, warehouse_id: wh.id, receive: true, lines: [{ variant_id: c.id, qty: 4, unit_cost: 10000 }] }));
  ok(await api.post('/purchases', { supplier_id: sup.id, warehouse_id: k2.id, receive: true, paid_amount: 200000, payment_method: 'bank', lines: [{ variant_id: c.id, qty: 10, unit_cost: 20000 }] }));
  const pur3 = ok(await api.post('/purchases', { supplier_id: sup.id, warehouse_id: wh.id, receive: true, paid_amount: 150000, payment_method: 'bank', lines: [{ variant_id: b.id, qty: 5, unit_cost: 30000 }] }));
  ok(await api.post(`/purchases/${pur3.id}/cancel`, { reason: 'Sai hàng', refund_method: 'bank' }));
  ok(await api.post('/purchases', { warehouse_id: wh.id, lines: [{ variant_id: a.id, qty: 1, unit_cost: 1 }] })); // nháp: không bút toán

  const ord = async (o) => ok(await api.post('/orders', { status: 'completed', ...o }));
  const o1 = await ord({ shop_id: nh.id, customer: { name: 'K1', phone: '0911000001' }, lines: [{ sku: 'A1', qty: 3 }, { sku: 'B1', qty: 2 }], discount_amount: 30000, shipping_fee: 20000, seller_shipping_amount: 15000, payments: [{ amount: 450000, method: 'cash' }], ordered_at: day(3) });
  const o2 = await ord({ shop_id: nh.id, channel_id: 'shopee', external_id: 'SP1', lines: [{ sku: 'A1', qty: 2 }], platform_fee_amount: 25000, ordered_at: day(2) });
  ok(await api.patch(`/orders/${o2.id}`, { platform_fee_amount: 30000 })); // sửa phí sàn sau khi chốt
  ok(await api.post(`/orders/${o2.id}/payments`, { amount: 170000, method: 'shopee_payout' }));
  const o3 = await ord({ shop_id: pt.id, channel_id: 'facebook', customer: { name: 'K2', phone: '0922000002' }, lines: [{ sku: 'B1', qty: 4 }], discount_amount: 20000, payments: [{ amount: 300000, method: 'bank' }], ordered_at: day(2) });
  const o4 = await ord({ shop_id: pt.id, customer: { name: 'K1', phone: '0911000001' }, lines: [{ sku: 'CB1', qty: 2 }], shipping_fee: 10000, payments: [{ amount: 510000, method: 'cash' }], ordered_at: day(1) });
  const o5 = await ord({ shop_id: nh.id, lines: [{ sku: 'A1', qty: 1 }], payments: [{ amount: 100000, method: 'cod' }], ordered_at: day(1) });
  const o6 = await ord({ shop_id: pt.id, channel_id: 'shopee', external_id: 'SP2', lines: [{ sku: 'A1', qty: 2 }], platform_fee_amount: 18000, ordered_at: day(1) });
  const o7 = await ord({ shop_id: nh.id, lines: [{ sku: 'B1', qty: 1 }], payments: [{ amount: 50000, method: 'cash' }], ordered_at: day(0) }); // còn nợ 30.000
  const o8 = await ord({ shop_id: nh.id, lines: [{ sku: 'C1', qty: 7 }], ordered_at: day(1), payments: [{ amount: 350000, method: 'card' }] }); // lấy hàng từ 2 kho
  const o9 = ok(await api.post('/orders', { shop_id: nh.id, status: 'confirmed', lines: [{ sku: 'C1', qty: 2 }], ordered_at: day(1) }));
  const o10 = await ord({ shop_id: pt.id, channel_id: 'tiktok', external_id: 'TT1', lines: [{ sku: 'B1', qty: 1 }], platform_fee_amount: 8000, ordered_at: day(1) });
  ok(await api.post(`/orders/${o10.id}/payments`, { amount: 72000, method: 'tiktok_payout', paid_at: day(1) }));
  await api.post('/orders', { shop_id: nh.id, lines: [{ sku: 'A1', qty: 1 }] }); // nháp
  // Trả hàng
  ok(await api.post(`/orders/${o3.id}/returns`, { lines: [{ order_line_id: o3.lines[0].id, qty: 1, restock: true }], refund: { amount: 75000, method: 'bank' } }));
  ok(await api.post(`/orders/${o4.id}/returns`, { lines: [{ order_line_id: o4.lines[0].id, qty: 1, restock: false }], refund: { amount: 250000, method: 'cash' } }));
  ok(await api.post(`/orders/${o6.id}/returns`, { lines: [{ order_line_id: o6.lines[0].id, qty: 2, restock: true }] })); // toàn phần đơn sàn chưa thu
  // Huỷ
  ok(await api.post(`/orders/${o9.id}/status`, { status: 'cancelled' }));
  ok(await api.post(`/orders/${o5.id}/status`, { status: 'cancelled' }));
  ok(await api.post(`/orders/${o5.id}/payments`, { amount: 100000, method: 'cod', direction: 'out' })); // hoàn tiền khách
  // Chi phí
  ok(await api.patch('/settings', { expense_allocation: 'revenue' }));
  await api.post('/expenses', { category_id: 'ecat_ads', amount: 100001, method: 'bank', expense_date: businessDate() });
  await api.post('/expenses', { category_id: 'ecat_ads', shop_id: nh.id, channel_id: 'shopee', amount: 12345, method: 'cash', expense_date: addDays(businessDate(), -2) });
  await api.post('/expenses', { category_id: 'ecat_shipping', shop_id: pt.id, amount: 5000, method: 'cash', expense_date: addDays(businessDate(), -1) });
  await api.post('/expenses', { category_id: 'ecat_fine', amount: 20000, method: 'cash', expense_date: addDays(businessDate(), -1) });
  await api.post('/expenses', { category_id: 'ecat_ops', amount: 33333, method: 'ewallet', expense_date: addDays(businessDate(), -3) });
  const voided = ok(await api.post('/expenses', { category_id: 'ecat_ads', amount: 999, method: 'cash' }));
  await api.delete(`/expenses/${voided.id}`);
  // Kho: điều chỉnh tăng, hỏng, tồn đầu kỳ, kiểm kê, chuyển kho
  ok(await api.post('/stock-adjustments', { warehouse_id: wh.id, kind: 'adjust', reason: 'Tìm thấy thêm', lines: [{ variant_id: b.id, change: 3, unit_cost: 30000 }] }));
  ok(await api.post('/stock-adjustments', { warehouse_id: wh.id, kind: 'damage', reason: 'Vỡ', lines: [{ variant_id: a.id, change: 2 }] }));
  const d = await mkP('D', 'D1', 20000, [nh.id]);
  ok(await api.post('/stock-adjustments', { warehouse_id: wh.id, kind: 'opening', lines: [{ variant_id: d.id, change: 10, unit_cost: 5000 }] }));
  ok(await api.post('/stock-adjustments', { warehouse_id: wh.id, kind: 'count', reason: 'Kiểm', lines: [{ variant_id: a.id, counted: 30 }] }));
  ok(await api.post('/transfers', { from_warehouse_id: wh.id, to_warehouse_id: k2.id, lines: [{ variant_id: b.id, qty: 5 }] }));
  // Quỹ: chuyển, kiểm đếm
  ok(await api.post('/cash/transfers', { from_account_id: 'cac_cash', to_account_id: 'cac_bank', amount: 20000, date: addDays(businessDate(), -1) }));
  ok(await api.post('/cash/accounts/cac_cash/count', { counted_amount: (await api.get('/cash/accounts')).body.data.find((x) => x.id === 'cac_cash').balance - 1000 }));
  ok(await api.post('/cash/accounts/cac_bank/count', { counted_amount: (await api.get('/cash/accounts')).body.data.find((x) => x.id === 'cac_bank').balance + 2500 }));
  return { ...ctx, k2, o: { o1, o2, o3, o4, o5, o6, o7, o8, o9, o10 }, wallet };
}

const q = (sql, ...p) => getDb().prepare(sql).all(...p);
const one = (sql, ...p) => getDb().prepare(sql).get(...p);
const bal = (code) => (flushJournal(), one("SELECT COALESCE(SUM(l.debit - l.credit),0) AS v FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.voided_at IS NULL AND l.account_code = ?", code).v);

test('Mọi bút toán cân; cân đối phát sinh và bảng cân đối kế toán cân; verifyJournal sạch', async () => {
  const { api } = await world();
  flushJournal();
  assert.ok(one('SELECT COUNT(*) AS n FROM journal_entries').n > 30);
  assert.deepEqual(q('SELECT e.code FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id GROUP BY e.id HAVING SUM(l.debit) != SUM(l.credit)'), [], 'mọi bút toán cân');
  assert.deepEqual(verifyJournal(), []);
  const tb = ok(await api.get('/accounting/trial-balance?from=2000-01-01'));
  assert.equal(tb.balanced, true);
  assert.equal(tb.totals.debit, tb.totals.credit);
  assert.equal(tb.totals.closing_debit, tb.totals.closing_credit);
  const bs = ok(await api.get('/accounting/balance-sheet'));
  assert.equal(bs.balanced, true, JSON.stringify(bs));
  assert.equal(bs.total_assets, bs.total_liabilities + bs.total_equity, 'Tài sản = Nợ phải trả + Vốn + Lợi nhuận kỳ này');
  assert.equal(bs.difference, 0);
});

test('KQKD = báo cáo tổng quan: tất cả shop và từng shop', async () => {
  const { api, nh, pt } = await world();
  flushJournal();
  const adj = one("SELECT COALESCE(SUM(l.credit - l.debit),0) AS v FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.account_code IN ('711','811') AND e.source_type IN ('stock','cash_entry')").v;
  assert.notEqual(adj, 0, 'kịch bản có chênh lệch kho/quỹ');
  for (const shop of [null, nh, pt]) {
    const qs = `${WIDE()}${shop ? `&shop_id=${shop.id}` : ''}`;
    const ov = ok(await api.get(`/reports/overview?${qs}`)).current;
    const is = ok(await api.get(`/accounting/income-statement?${qs}`));
    const tag = shop ? shop.code : 'tất cả';
    assert.equal(is.net_goods_revenue, ov.net_revenue, `doanh thu thuần ${tag}`);
    assert.equal(is.revenue_shipping, ov.shipping_fee, `phí ship ${tag}`);
    assert.equal(is.cogs, ov.cogs, `giá vốn ${tag}`);
    if (!shop) {
      // Chi phí 641x/642x + khoản chi danh mục "Tiền phạt" (811, 20.000) = phí sàn + ship shop chịu + chi phí của báo cáo
      const costs = is.selling_expenses.concat(is.admin_expenses).reduce((a, r) => a + r.amount, 0) + 20000;
      assert.equal(costs, ov.platform_fee + ov.seller_shipping + ov.expenses_amount, 'chi phí');
    }
    // Lợi nhuận: ledger gồm thêm chênh lệch kho/quỹ (không thuộc báo cáo và không thuộc shop nào)
    assert.equal(is.profit_before_tax - (shop ? 0 : adj), ov.net_profit_estimate, `lợi nhuận ${tag}`);
  }
  const all = ok(await api.get(`/accounting/income-statement?${WIDE()}`));
  const sumShops = ok(await api.get(`/accounting/income-statement?${WIDE()}&shop_id=${nh.id}`)).profit_before_tax + ok(await api.get(`/accounting/income-statement?${WIDE()}&shop_id=${pt.id}`)).profit_before_tax;
  assert.equal(sumShops, all.profit_before_tax - one("SELECT COALESCE(SUM(l.credit - l.debit),0) AS v FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.account_code IN ('711','811') AND e.source_type IN ('stock','cash_entry')").v, 'cộng các shop = tất cả (trừ điều chỉnh chưa gán shop)');
});

test('Tiền: số dư từng tài khoản 111x/112x = số dư quỹ; lưu chuyển tiền khớp', async () => {
  const { api, wallet } = await world();
  const accounts = q('SELECT * FROM cash_accounts');
  assert.equal(accounts.length, 3);
  for (const a of accounts) {
    const expected = balanceOf({ ...a, methods: JSON.parse(a.methods) }).balance;
    assert.equal(bal(a.account_code), expected, `quỹ ${a.name} (${a.account_code})`);
  }
  assert.equal(bal(wallet.account_code), 50000, 'ví chỉ có số dư đầu: payout trước ngày mở sổ nằm trong số dư đầu');
  assert.equal(bal('1131'), 0, 'mọi phương thức đã gán quỹ');
  const cf = ok(await api.get('/accounting/cash-flow?from=2000-01-01'));
  assert.equal(cf.closing_balance, cf.check_closing);
  assert.equal(cf.closing_balance, bal('1111') + bal('1121') + bal('1122'));
  assert.equal(cf.data.find((g) => g.key === 'transfer').net, 0);
  const rep = ok(await api.get(`/reports/cashflow?${WIDE()}`));
  // Thu chi trong kỳ (không tính chuyển quỹ, kiểm đếm, số dư đầu) khớp báo cáo dòng tiền trừ phần của ví (trước ngày mở sổ → 411)
  const ops = cf.data.filter((g) => g.kind === 'operating').reduce((a, g) => a + g.net, 0);
  assert.equal(ops, rep.net_cash - 72000, 'dòng tiền kinh doanh = tiền ròng của báo cáo trừ payout TikTok (trước ngày mở sổ ví nên nằm trong số dư đầu)');
});

test('Hàng tồn 156 khớp Σ tồn × giá vốn bình quân trong sai số làm tròn đã biết', async () => {
  await world();
  const stockValue = one('SELECT COALESCE(SUM(on_hand * avg_cost),0) AS v FROM stock_levels').v;
  // Sai số duy nhất: giá vốn bình quân và giá nhập phân bổ làm tròn về đồng nguyên. Mỗi biến động làm tròn sai tối đa ½ đồng/đơn vị
  // trên tồn sau biến động, nên cận trên = Σ (|qty| + balance_after) / 2 trên mọi biến động.
  const bound = q('SELECT qty, balance_after FROM stock_movements').reduce((a, m) => a + Math.ceil((Math.abs(m.qty) + Math.max(0, m.balance_after)) / 2), 0);
  const diff = bal('156') - stockValue;
  console.log(`156: sổ cái ${bal('156')} · tồn × giá vốn ${stockValue} · lệch ${diff} (cận ${bound})`);
  assert.ok(Math.abs(diff) <= bound, `lệch ${diff} vượt cận ${bound}`);
  assert.ok(Math.abs(diff) <= 30, 'thực tế lệch rất nhỏ (kịch bản này: -15 đ trên 2,4 triệu)');
});

test('Công nợ: 131 + 1388 khớp báo cáo (kèm số dư có của đơn sàn trả toàn phần); 331 = công nợ NCC', async () => {
  const { api } = await world();
  const cf = ok(await api.get(`/reports/cashflow?${WIDE()}`));
  assert.ok(cf.customer_receivable > 0 && cf.supplier_payable > 0);
  // Báo cáo cắt công nợ mỗi đơn ở 0; sổ cái giữ số dư có (đơn sàn trả toàn phần: sàn không hoàn phí 18.000 nên shop nợ sàn phần đó)
  const orders = q("SELECT o.*, ch.is_marketplace AS mp FROM orders o JOIN channels ch ON ch.id = o.channel_id WHERE o.status IN ('confirmed','shipping','completed','returned')");
  const credit = orders.reduce((a, o) => a + Math.min(0, (o.mp ? o.net_amount : o.total_amount) - o.returned_amount - o.paid_amount), 0);
  assert.equal(credit, -18000);
  assert.equal(bal('131') + bal('1388'), cf.customer_receivable + cf.marketplace_pending + credit);
  assert.equal(bal('131'), cf.customer_receivable);
  assert.equal(bal('331'), -cf.supplier_payable);
  assert.equal(-bal('331'), q("SELECT total_amount - paid_amount AS d FROM purchases WHERE status = 'received'").reduce((a, r) => a + r.d, 0));
});

test('Sửa/huỷ chứng từ: bút toán tự cập nhật, mã bút toán giữ nguyên, sổ vẫn khớp', async () => {
  const { api, o } = await world();
  flushJournal();
  const entryOf = (id) => one("SELECT * FROM journal_entries WHERE source_type = 'order' AND source_id = ?", id);
  const before = entryOf(o.o1.id);
  const ship = bal('5113');
  ok(await api.patch(`/orders/${o.o1.id}`, { shipping_fee: 30000 }));
  flushJournal();
  assert.equal(bal('5113'), ship - 10000, 'phí ship tăng 10.000 → doanh thu phí vận chuyển (bên Có) tăng');
  assert.equal(entryOf(o.o1.id).code, before.code, 'mã bút toán giữ nguyên khi sinh lại');
  assert.deepEqual(verifyJournal(), []);
  const rev = bal('5111');
  ok(await api.post(`/orders/${o.o7.id}/status`, { status: 'cancelled' }));
  flushJournal();
  assert.equal(entryOf(o.o7.id), undefined, 'đơn huỷ không còn bút toán bán hàng');
  assert.equal(bal('5111'), rev + 80000, 'doanh thu (bên Có) giảm 80.000');
  assert.deepEqual(verifyJournal(), []);
  // Huỷ một khoản chi phí và huỷ một lần chuyển quỹ
  const exp = q('SELECT id FROM expenses WHERE voided_at IS NULL LIMIT 1')[0];
  ok(await api.delete(`/expenses/${exp.id}`));
  const ent = q("SELECT id FROM cash_entries WHERE kind = 'transfer' AND voided_at IS NULL LIMIT 1")[0];
  ok(await api.delete(`/cash/entries/${ent.id}`));
  assert.deepEqual(verifyJournal(), []);
  assert.equal(ok(await api.get('/accounting/balance-sheet')).balanced, true);
  assert.equal(one('SELECT COUNT(*) AS n FROM journal_dirty').n, 0);
});

test('Phương thức chưa gán quỹ → 1131 và cảnh báo; verify bắt được bút toán bị sửa lén', async () => {
  const { api } = await world();
  ok(await api.patch('/cash/accounts/cac_bank', { methods: ['bank', 'shopee_payout', 'card', 'other'] })); // bỏ ewallet khỏi mọi quỹ
  const ov = ok(await api.get('/accounting/overview'));
  assert.ok(bal('1131') !== 0 || one("SELECT COUNT(*) AS n FROM journal_lines WHERE account_code = '1131'").n > 0);
  assert.ok(ov.warnings.some((w) => w.code === 'UNASSIGNED_METHOD'));
  assert.deepEqual(verifyJournal(), []);
  // Sửa lén sổ cái: verify phải thấy
  getDb().prepare("UPDATE journal_lines SET memo = 'x' WHERE rowid = (SELECT MIN(rowid) FROM journal_lines)").run();
  assert.ok(verifyJournal().length > 0);
});

test('API sổ kế toán: hệ thống tài khoản, sổ nhật ký, sổ cái có nguồn chứng từ', async () => {
  const { api } = await world();
  const acc = ok(await api.get('/accounting/accounts'));
  assert.ok(acc.find((a) => a.code === '6411' && a.is_system));
  const sub = ok(await api.post('/accounting/accounts', { parent_code: '6418', name: 'Hoa hồng CTV' }), 201);
  assert.equal(sub.code, '64181');
  assert.equal((await api.patch('/accounting/accounts/6411', { name: 'x' })).status, 409, 'tài khoản hệ thống không đổi tên');
  ok(await api.patch(`/accounting/accounts/${sub.code}`, { name: 'Hoa hồng cộng tác viên' }));
  const j = await api.get(`/accounting/journal?${WIDE()}&limit=5`);
  assert.equal(j.body.data.length, 5);
  assert.ok(j.body.next_cursor);
  const j2 = await api.get(`/accounting/journal?${WIDE()}&limit=200&source_type=expense`);
  assert.equal(j2.body.data.length, 5);
  const l = ok(await api.get('/accounting/ledger/111'));
  assert.ok(l.data.length > 0 && l.data.every((r) => r.source_type && r.entry_code));
  assert.equal(l.closing_balance, bal('1111') + bal('1121') * 0, 'sổ cái 111 = các quỹ tiền mặt');
});

// ---------- Phase 8b: chứng từ tay, chi phí định kỳ, tài sản, khoá sổ ----------
const FAR = '2099-12-31';
const cashMatches = () => {
  for (const a of q('SELECT * FROM cash_accounts')) {
    assert.equal(bal(a.account_code), balanceOf({ ...a, methods: JSON.parse(a.methods) }, FAR).balance, `quỹ ${a.name} (${a.account_code})`);
  }
};
const sound = async (api) => {
  assert.deepEqual(verifyJournal(), []);
  assert.equal(ok(await api.get('/accounting/balance-sheet')).balanced, true);
  assert.equal(ok(await api.get('/accounting/trial-balance?from=2000-01-01')).balanced, true);
  cashMatches();
};

test('Chứng từ tay: góp vốn, tiền phạt, bút toán tổng hợp, huỷ; số dư quỹ khớp sổ cái', async () => {
  const { api, nh, wallet } = await world();
  const before = ok(await api.get('/cash/accounts'));
  const cashBefore = before.find((a) => a.id === 'cac_cash').balance;
  const dt = businessDate();
  const cap = ok(await api.post('/accounting/vouchers', { type: 'receipt', voucher_date: dt, description: 'Chủ góp vốn', cash_account_id: 'cac_cash', account_code: '411', amount: 5000000 }));
  assert.match(cap.code, /^PT-\d{6}$/);
  const fine = ok(await api.post('/accounting/vouchers', { type: 'payment', voucher_date: dt, description: 'Phạt giao hàng trễ', cash_account_id: 'cac_cash', account_code: '811', amount: 200000, shop_id: nh.id }));
  assert.match(fine.code, /^PC-\d{6}$/);
  const bt = ok(await api.post('/accounting/vouchers', { type: 'journal', voucher_date: dt, description: 'Ghi nhận tiền thuê chưa trả', lines: [{ account_code: '6422', debit: 700000 }, { account_code: '3388', credit: 700000 }] }));
  assert.match(bt.code, /^BT-\d{6}$/);
  // Bút toán tay động vào tài khoản quỹ vẫn phải khớp số dư quỹ
  ok(await api.post('/accounting/vouchers', { type: 'journal', voucher_date: dt, description: 'Rút vốn bằng bút toán', lines: [{ account_code: '411', debit: 30000 }, { account_code: '1121', credit: 30000 }] }));
  const mistaken = ok(await api.post('/accounting/vouchers', { type: 'receipt', voucher_date: dt, description: 'Nhập nhầm', cash_account_id: 'cac_bank', account_code: '711', amount: 999000 }));
  ok(await api.delete(`/accounting/vouchers/${mistaken.id}`));
  assert.equal((await api.delete(`/accounting/vouchers/${mistaken.id}`)).status, 409);
  const after = ok(await api.get('/cash/accounts'));
  assert.equal(after.find((a) => a.id === 'cac_cash').balance, cashBefore + 5000000 - 200000);
  assert.equal(after.find((a) => a.id === 'cac_bank').balance, before.find((a) => a.id === 'cac_bank').balance - 30000, 'phiếu huỷ không vào quỹ');
  assert.equal(ok(await api.get('/cash/accounts/cac_cash/ledger')).closing_balance, after.find((a) => a.id === 'cac_cash').balance, 'sổ quỹ có dòng chứng từ tay');
  await sound(api);
  // KQKD: tiền phạt vào chi phí khác của shop; bút toán tay không bị sinh lại
  const is = ok(await api.get(`/accounting/income-statement?${WIDE()}&shop_id=${nh.id}`));
  assert.ok(is.other_expense >= 200000);
  flushJournal();
  getDb().prepare('UPDATE journal_dirty SET source_id = source_id').run();
  assert.equal(one("SELECT COUNT(*) AS n FROM journal_entries WHERE source_type = 'manual' AND voided_at IS NULL").n, 4);
  // Sửa phiếu: đổi số tiền
  const upd = ok(await api.patch(`/accounting/vouchers/${cap.id}`, { amount: 6000000 }));
  assert.equal(upd.total_amount, 6000000);
  assert.equal(ok(await api.get('/cash/accounts')).find((a) => a.id === 'cac_cash').balance, cashBefore + 6000000 - 200000);
  await sound(api);
  // Chặn: không cân, tài khoản tổng, trước ngày mở sổ quỹ, đối ứng là quỹ
  const bad = (b) => api.post('/accounting/vouchers', { voucher_date: dt, description: 'x', ...b });
  assert.equal((await bad({ type: 'journal', lines: [{ account_code: '6422', debit: 100 }, { account_code: '3388', credit: 99 }] })).status, 400);
  assert.equal((await bad({ type: 'journal', lines: [{ account_code: '6422', debit: 100 }, { account_code: '111', credit: 100 }] })).body.error.code, 'ACCOUNT_NOT_POSTABLE');
  assert.equal((await bad({ type: 'receipt', cash_account_id: 'cac_cash', account_code: '1121', amount: 5 })).body.error.code, 'USE_TRANSFER');
  assert.equal((await bad({ type: 'receipt', voucher_date: addDays(dt, -1), cash_account_id: wallet.id, account_code: '711', amount: 5 })).body.error.code, 'CASH_BEFORE_OPENING');
  assert.equal((await bad({ type: 'journal', lines: [{ account_code: '6422', debit: 100 }] })).status, 400);
  assert.equal(ok(await api.get('/accounting/vouchers?type=payment')).length, 1);
  assert.equal(one("SELECT COUNT(*) AS n FROM events WHERE type = 'voucher.created'").n, 5);
});

test('Chi phí định kỳ: job tạo bù các kỳ bỏ lỡ, cuối tháng, không tạo trùng, tạm dừng/tiếp tục', async () => {
  const { api } = await world();
  const { runDue } = await import('../server/modules/expenses/recurring.js');
  const { setToday } = await import('../server/lib/clock.js');
  try {
    const rec = ok(await api.post('/recurring-expenses', { name: 'Thuê kho', category_id: 'ecat_rent', amount: 3000000, method: 'bank', frequency: 'monthly', day_of_period: 31, start_date: '2027-01-15' }));
    assert.equal(rec.next_run_date, '2027-01-31');
    assert.deepEqual(ok(await api.get(`/recurring-expenses/${rec.id}/preview?count=3`)).map((p) => p.date), ['2027-01-31', '2027-02-28', '2027-03-31']);
    setToday('2027-03-10'); // server tắt từ tháng 1: lần chạy đầu phải tạo bù 2 kỳ
    assert.deepEqual(runDue('2027-03-10'), { created: 2, skipped_locked: 0 });
    assert.deepEqual(runDue('2027-03-10'), { created: 0, skipped_locked: 0 }, 'idempotent');
    const dates = q('SELECT expense_date FROM expenses WHERE recurring_id = ? ORDER BY expense_date', rec.id).map((r) => r.expense_date);
    assert.deepEqual(dates, ['2027-01-31', '2027-02-28']);
    assert.equal(ok(await api.get(`/recurring-expenses/${rec.id}`)).next_run_date, '2027-03-31');
    // Huỷ một kỳ đã tạo: không bị tạo lại
    ok(await api.delete(`/expenses/${q('SELECT id FROM expenses WHERE recurring_id = ? LIMIT 1', rec.id)[0].id}`));
    assert.equal(runDue('2027-03-10').created, 0);
    // Tạm dừng qua tháng 3-4 rồi tiếp tục: không tạo bù thời gian tạm dừng
    ok(await api.post(`/recurring-expenses/${rec.id}/pause`));
    setToday('2027-05-02');
    assert.equal(runDue('2027-05-02').created, 0, 'đang tạm dừng');
    ok(await api.post(`/recurring-expenses/${rec.id}/resume`));
    assert.equal(runDue('2027-05-02').created, 0, 'không bù các kỳ đã qua lúc tạm dừng');
    setToday('2027-05-31');
    assert.equal(runDue('2027-05-31').created, 1);
    // "Tạo ngay kỳ này" cho kỳ đã có → 409; kỳ chưa có thì tạo
    assert.equal((await api.post(`/recurring-expenses/${rec.id}/run`)).status, 409);
    const wk = ok(await api.post('/recurring-expenses', { name: 'Lương tuần', category_id: 'ecat_other', amount: 100000, method: 'cash', frequency: 'weekly', day_of_period: 5, start_date: '2027-05-03' }));
    const made = ok(await api.post(`/recurring-expenses/${wk.id}/run`));
    assert.equal(made.recurring_id, wk.id);
    assert.equal((await api.post(`/recurring-expenses/${wk.id}/run`)).status, 409);
    // Lưu trữ: không chạy nữa, chi phí đã tạo còn nguyên
    ok(await api.delete(`/recurring-expenses/${wk.id}`));
    assert.equal(ok(await api.get('/recurring-expenses')).length, 1);
    assert.equal(one('SELECT COUNT(*) AS n FROM expenses WHERE recurring_id IS NOT NULL').n, 4, 'tháng 1, 2 (một khoản đã huỷ vẫn giữ khoá kỳ), 5 + một kỳ tuần');
    assert.throws(() => getDb().prepare("INSERT INTO expenses (id, category_id, amount, expense_date, method, created_at, updated_at, recurring_id, period_key) VALUES ('x','ecat_rent',1,'2027-01-01','cash','a','a',?, '2027-01')").run(rec.id), /UNIQUE/);
    await sound(api);
  } finally {
    setToday(null);
  }
});

test('Tài sản: khấu hao theo tháng qua đồng hồ giả, trả bằng quỹ/chưa trả, thanh lý; sổ luôn khớp', async () => {
  const { api, nh } = await world();
  const { setToday } = await import('../server/lib/clock.js');
  try {
    setToday('2027-06-15');
    const payable0 = bal('331');
    const bankBefore = balanceOf({ ...q("SELECT * FROM cash_accounts WHERE id = 'cac_bank'")[0], methods: JSON.parse(q("SELECT methods FROM cash_accounts WHERE id = 'cac_bank'")[0].methods) }, FAR).balance;
    const shelf = ok(await api.post('/accounting/assets', { name: 'Kệ trưng bày', kind: 'fixed_asset', cost: 1000000, months: 3, start_date: '2027-01-10', paid_via: 'bank', expense_account_code: '6422', shop_id: nh.id }));
    const rent = ok(await api.post('/accounting/assets', { name: 'Thuê mặt bằng 12 tháng', kind: 'prepaid', cost: 1200000, months: 12, start_date: '2027-02-01', paid_via: 'unpaid' }));
    assert.equal(rent.account_code, '242');
    assert.equal((await api.post('/accounting/assets', { name: 'x', kind: 'prepaid', cost: 5, months: 1, start_date: '2027-02-01', expense_account_code: '632' })).status, 400);
    // 15/06/2027: kệ đã khấu hao hết (T1–T3), thuê đã phân bổ T2–T5 (4 tháng)
    assert.equal(bal('211'), 1000000);
    assert.equal(bal('214'), -1000000);
    assert.equal(bal('242'), 1200000 - 400000);
    assert.equal(bal('331'), payable0 - 1200000, 'chưa trả → phải trả người bán');
    const bankAfter = balanceOf({ ...q("SELECT * FROM cash_accounts WHERE id = 'cac_bank'")[0], methods: JSON.parse(q("SELECT methods FROM cash_accounts WHERE id = 'cac_bank'")[0].methods) }, FAR).balance;
    assert.equal(bankAfter, bankBefore - 1000000, 'mua kệ trả bằng ngân hàng làm giảm số dư quỹ');
    await sound(api);
    const sched = ok(await api.get(`/accounting/assets/${shelf.id}`));
    assert.equal(sched.schedule.reduce((a, p) => a + p.amount, 0), 1000000);
    assert.equal(sched.schedule.filter((p) => p.posted).length, 3);
    // Sang tháng 8: đồng hồ đổi → sổ tự làm mới, thuê đã phân bổ 6 tháng
    setToday('2027-08-01');
    assert.equal(bal('242'), 1200000 - 600000, 'khấu hao làm mới khi qua ngày, không cần sửa tài sản');
    await sound(api);
    const is = ok(await api.get('/accounting/income-statement?from=2027-01-01&to=2027-08-31'));
    assert.equal(is.depreciation_total, 1000000 + 600000);
    assert.equal(is.depreciation.reduce((a, r) => a + r.amount, 0), is.depreciation_total);
    assert.equal(is.operating_profit, is.operating_profit_before_depreciation - is.depreciation_total);
    // Chi phí khấu hao của shop hiện ở KQKD theo shop
    assert.equal(ok(await api.get(`/accounting/income-statement?from=2027-01-01&to=2027-08-31&shop_id=${nh.id}`)).depreciation_total, 1000000);
    // Thanh lý thuê trả trước ngày 01/08: giá trị còn lại 600.000 vào 811; không phân bổ nữa
    const d = ok(await api.post(`/accounting/assets/${rent.id}/dispose`, { date: '2027-08-01' }));
    assert.equal(d.disposed_at, '2027-08-01');
    assert.equal(bal('242'), 0);
    assert.equal((await api.post(`/accounting/assets/${rent.id}/dispose`, {})).status, 409);
    setToday('2027-12-31');
    assert.equal(bal('242'), 0, 'thanh lý rồi không phân bổ thêm');
    // Thanh lý TSCĐ giữa kỳ
    const pc = ok(await api.post('/accounting/assets', { name: 'Máy in', kind: 'fixed_asset', cost: 600000, months: 6, start_date: '2027-03-01', paid_via: 'cash' }));
    const dp = ok(await api.post(`/accounting/assets/${pc.id}/dispose`, { date: '2027-05-15' }));
    assert.equal(dp.remaining, 0);
    flushJournal();
    const lines = q("SELECT l.account_code AS c, SUM(l.debit - l.credit) AS v FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.source_type = 'asset' AND e.source_id = ? GROUP BY l.account_code", pc.id);
    const by = Object.fromEntries(lines.map((l) => [l.c, l.v]));
    assert.equal(by['211'] ?? 0, 0, 'nguyên giá đã ghi giảm');
    assert.equal(by['214'] ?? 0, 0, 'hao mòn luỹ kế đã kết');
    assert.equal(by['811'], 400000, '600.000 − 2 tháng × 100.000');
    ok(await api.delete(`/accounting/assets/${pc.id}`));
    flushJournal();
    assert.equal(q("SELECT 1 FROM journal_entries WHERE source_id = ?", pc.id).length, 0, 'huỷ bản ghi → không còn bút toán');
    await sound(api);
    // Quay đồng hồ về lại: sổ dựng lại đúng
    setToday('2027-02-15');
    assert.equal(bal('214'), -(333334 + 0), 'chỉ T1 đã qua');
    await sound(api);
  } finally {
    setToday(null);
  }
});

test('Khoá sổ: chặn chứng từ tay, chi phí, thanh toán, chuyển quỹ, tài sản; đơn chỉ cảnh báo sau khoá', async () => {
  const { api, nh, wh } = await world();
  const yesterday = addDays(businessDate(), -1);
  const exp = ok(await api.post('/expenses', { category_id: 'ecat_ops', amount: 5000, method: 'cash', expense_date: yesterday }));
  assert.equal((await api.patch('/settings', { accounting_lock_date: 'abc' })).status, 400);
  const ov0 = ok(await api.get('/accounting/overview'));
  assert.ok(!ov0.warnings.some((w) => w.code === 'LOCKED_PERIOD_CHANGED'));
  const lock = ok(await api.post('/accounting/lock', { date: yesterday }));
  assert.equal(lock.lock_date, yesterday);
  assert.equal(lock.changed, false);
  const locked = (r) => {
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.error.code, 'PERIOD_LOCKED');
  };
  locked(await api.post('/expenses', { category_id: 'ecat_ops', amount: 1, method: 'cash', expense_date: yesterday }));
  locked(await api.patch(`/expenses/${exp.id}`, { amount: 6000 }));
  locked(await api.patch(`/expenses/${exp.id}`, { expense_date: businessDate() })); // chuyển khỏi kỳ khoá cũng chặn
  locked(await api.delete(`/expenses/${exp.id}`));
  locked(await api.post('/accounting/vouchers', { type: 'receipt', voucher_date: yesterday, description: 'x', cash_account_id: 'cac_cash', account_code: '711', amount: 1 }));
  locked(await api.post('/accounting/assets', { name: 'x', kind: 'prepaid', cost: 100, months: 1, start_date: yesterday }));
  locked(await api.post('/cash/transfers', { from_account_id: 'cac_cash', to_account_id: 'cac_bank', amount: 1, date: yesterday }));
  const open = ok(await api.post('/expenses', { category_id: 'ecat_ops', amount: 1, method: 'cash', expense_date: businessDate() }));
  assert.ok(open.id, 'hôm nay chưa khoá');
  // Thanh toán trong kỳ khoá
  const p = ok(await api.post('/products', { name: 'A', variants: [{ sku: 'Z1', default_price: 100000 }], shop_ids: [nh.id] })).variants[0];
  ok(await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: p.id, qty: 10, unit_cost: 40000 }] }));
  const order = ok(await api.post('/orders', { shop_id: nh.id, status: 'completed', lines: [{ sku: 'Z1', qty: 1 }], ordered_at: `${yesterday}T04:00:00.000Z` }), 201);
  assert.ok(order.id, 'đơn trong kỳ đã khoá vẫn tạo được');
  const ov = ok(await api.get('/accounting/overview'));
  const w = ov.warnings.find((x) => x.code === 'LOCKED_PERIOD_CHANGED');
  assert.ok(w, 'cảnh báo kỳ đã khoá có thay đổi sau khoá');
  assert.ok(w.changes.some((c) => c.code === '5111'));
  assert.equal(ok(await api.get('/accounting/lock')).changed, true);
  const pay = await api.post(`/orders/${order.id}/payments`, { amount: 1000, method: 'cash', paid_at: `${yesterday}T05:00:00.000Z` });
  locked(pay);
  // Chốt lại số liệu → hết cảnh báo; mở khoá → sửa được
  assert.equal(ok(await api.post('/accounting/lock', { date: yesterday })).changed, false);
  ok(await api.post('/accounting/lock', { date: null }));
  ok(await api.patch(`/expenses/${exp.id}`, { amount: 6000 }));
  assert.equal(ok(await api.get('/accounting/lock')).lock_date, null);
  await sound(api);
});
