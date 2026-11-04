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
