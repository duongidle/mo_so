import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { getDb } from '../server/db/index.js';
import { addDays, businessDate } from '../server/lib/time.js';
import { verifyJournal, flushJournal } from '../server/modules/accounting/journal.js';
import { verifyStats } from '../server/modules/reports/stats.js';
import { verifyStock } from '../server/modules/inventory/verify.js';

/**
 * Đơn bán v4: (1) giữ cọc / hoàn cọc khi huỷ đơn, (2) lô hết hạn, (3) sản phẩm dịch vụ không tồn kho, (4) ship đơn sàn nhập tay.
 */
const WIDE = () => `from=${addDays(businessDate(), -3)}&to=${businessDate()}`;
const ok = (r, s = [200, 201]) => { assert.ok([].concat(s).includes(r.status), JSON.stringify(r.body)); return r.body.data; };
const one = (sql, ...p) => getDb().prepare(sql).get(...p);
const bal = (code) => (flushJournal(), one("SELECT COALESCE(SUM(l.debit - l.credit),0) AS v FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.voided_at IS NULL AND l.account_code = ?", code).v);
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function world() {
  const ctx = await setup();
  const { api, nh, wh } = ctx;
  const v = ok(await api.post('/products', { name: 'Nến', variants: [{ sku: 'N1', default_price: 100000 }], shop_ids: [nh.id] })).variants[0];
  const sup = ok(await api.post('/suppliers', { name: 'NCC' }));
  const stockIn = async (qty, lot, exp) => ok(await api.post('/purchases', { supplier_id: sup.id, warehouse_id: wh.id, receive: true, lines: [{ variant_id: v.id, qty, unit_cost: 40000, ...(lot ? { lot_no: lot, expiry_date: exp } : {}) }] }));
  await stockIn(20);
  const order = async (extra = {}) => ok(await api.post('/orders', { shop_id: nh.id, channel_id: 'direct', lines: [{ variant_id: v.id, qty: 1, unit_price: 100000 }], ...extra }));
  return { ...ctx, v, stockIn, order };
}

async function sound(api) {
  assert.deepEqual(verifyJournal(), []);
  assert.deepEqual(verifyStats(), []);
  assert.deepEqual(verifyStock(), []);
  assert.equal(ok(await api.get('/accounting/balance-sheet')).balanced, true);
}

// ---------- Việc 1: giữ cọc ----------
test('huỷ đơn còn tiền đã thu: bắt buộc chọn hoàn hoặc giữ cọc, thiếu thì 409 kèm số tiền', async () => {
  const { api, order } = await world();
  const o = await order({ payments: [{ amount: 100000, method: 'cash' }] });
  const r = await api.post(`/orders/${o.id}/status`, { status: 'cancelled' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'CANCEL_PAYMENT_CHOICE_REQUIRED');
  assert.equal(r.body.error.details.paid_amount, 100000);
  assert.equal(ok(await api.get(`/orders/${o.id}`)).status, 'draft');
  // Đơn không còn tiền: huỷ như cũ
  const free = await order();
  ok(await api.post(`/orders/${free.id}/status`, { status: 'cancelled' }));
});

test('hoàn cọc sau: đơn huỷ nợ khách đúng số đã thu, hiện ở Công nợ phải trả, hoàn tới số nợ', async () => {
  const { api, order } = await world();
  const o = await order({ payments: [{ amount: 100000, method: 'cash' }] });
  const c = ok(await api.post(`/orders/${o.id}/status`, { status: 'cancelled', paid_action: 'refund' }));
  assert.equal(c.refund_owed_amount, 100000);
  assert.equal(c.forfeited_amount, 0);
  const debts = ok(await api.get('/payables')).filter((d) => d.kind === 'refund');
  assert.equal(debts.length, 1);
  assert.equal(debts[0].amount, 100000);
  assert.equal(ok(await api.get(`/reports/cashflow?${WIDE()}`)).customer_refund_owed, 100000);
  assert.equal((await api.post(`/orders/${o.id}/payments`, { direction: 'out', amount: 100001, method: 'cash' })).status, 400);
  const after = ok(await api.post(`/orders/${o.id}/payments`, { direction: 'out', amount: 100000, method: 'cash' }));
  assert.equal(after.refund_owed_amount, 0);
  assert.equal(after.payment_status, 'refunded');
  assert.equal(ok(await api.get('/payables')).filter((d) => d.kind === 'refund').length, 0);
  await sound(api);
});

test('hoàn cọc ngay (đơn xác nhận) kèm phương thức: tồn về lại, không còn nợ', async () => {
  const { api, order, v } = await world();
  const o = await order({ status: 'confirmed', payments: [{ amount: 60000, method: 'bank' }] });
  const c = ok(await api.post(`/orders/${o.id}/status`, { status: 'cancelled', paid_action: 'refund', refund: { method: 'bank' } }));
  assert.equal(c.paid_amount, 0);
  assert.equal(c.refund_owed_amount, 0);
  assert.equal(c.payment_status, 'refunded');
  assert.equal(ok(await api.get('/stock')).find((x) => x.variant_id === v.id).on_hand, 20);
  await sound(api);
});

test('giữ cọc: thành doanh thu "Cọc giữ lại" của shop/kênh/ngày, vào lãi gộp, sổ kế toán Có 5119, mọi tổng khớp', async () => {
  const { api, order, nh } = await world();
  const before = ok(await api.get(`/reports/overview?${WIDE()}`)).current;
  const o = await order({ payments: [{ amount: 100000, method: 'cash' }] });
  const c = ok(await api.post(`/orders/${o.id}/status`, { status: 'cancelled', paid_action: 'forfeit' }));
  assert.equal(c.forfeited_amount, 100000);
  assert.equal(c.refund_owed_amount, 0);
  assert.equal(c.gross_profit, 100000);
  const ov = ok(await api.get(`/reports/overview?${WIDE()}`)).current;
  assert.equal(ov.forfeit - before.forfeit, 100000);
  assert.equal(ov.gross_profit - before.gross_profit, 100000);
  assert.equal(ov.order_count, before.order_count); // đơn huỷ không phải đơn bán
  // Tổng theo shop, theo kênh, theo ngày đều khớp tổng quan
  const shops = (await api.get(`/reports/shops?${WIDE()}`)).body.data;
  const chans = (await api.get(`/reports/channels?${WIDE()}`)).body.data;
  const sumOf = (rows, k) => rows.reduce((x, r) => x + r[k], 0);
  assert.equal(shops.find((r) => r.shop_id === nh.id).forfeit, 100000);
  assert.equal(chans.find((r) => r.channel_id === 'direct').forfeit, 100000);
  assert.equal(sumOf(shops, 'forfeit'), ov.forfeit);
  assert.equal(sumOf(chans, 'forfeit'), ov.forfeit);
  assert.equal(sumOf(shops, 'gross_profit'), ov.gross_profit);
  // Sổ kế toán
  assert.equal(bal('5119'), -100000);
  assert.equal(bal('131'), 0);
  const is = ok(await api.get(`/accounting/income-statement?${WIDE()}`));
  assert.equal(is.revenue_forfeit, 100000);
  assert.equal(is.gross_profit, ov.gross_profit);
  await sound(api);
});

test('giữ một phần cọc: phần còn lại là nợ khách, hoàn ngay được; huỷ khoản thu làm số giữ vượt số đã thu bị chặn', async () => {
  const { api, order } = await world();
  const o = await order({ payments: [{ amount: 100000, method: 'cash' }] });
  assert.equal((await api.post(`/orders/${o.id}/status`, { status: 'cancelled', paid_action: 'forfeit', forfeit_amount: 100001 })).status, 400);
  assert.equal((await api.post(`/orders/${o.id}/status`, { status: 'cancelled', paid_action: 'refund', forfeit_amount: 10 })).status, 400);
  const c = ok(await api.post(`/orders/${o.id}/status`, { status: 'cancelled', paid_action: 'forfeit', forfeit_amount: 30000, refund: { method: 'cash' } }));
  assert.equal(c.forfeited_amount, 30000);
  assert.equal(c.paid_amount, 30000);
  assert.equal(c.refund_owed_amount, 0);
  assert.equal(bal('5119'), -30000);
  const pay = c.payments.find((p) => p.direction === 'in');
  const r = await api.post(`/payments/${pay.id}/void`, { reason: 'nhầm' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'PAYMENT_BELOW_FORFEIT');
  // Đơn nháp có cọc cũng giữ được; không hoàn quá phần nợ
  const o2 = await order({ payments: [{ amount: 50000, method: 'cash' }] });
  const c2 = ok(await api.post(`/orders/${o2.id}/status`, { status: 'cancelled', paid_action: 'forfeit', forfeit_amount: 20000 }));
  assert.equal(c2.refund_owed_amount, 30000);
  assert.equal((await api.post(`/orders/${o2.id}/payments`, { direction: 'out', amount: 30001, method: 'cash' })).status, 400);
  ok(await api.post(`/orders/${o2.id}/payments`, { direction: 'out', amount: 30000, method: 'cash' }));
  await sound(api);
});

test('đơn sàn đã thu vẫn huỷ như cũ, không bắt chọn', async () => {
  const { api, order } = await world();
  const o = await order({ channel_id: 'shopee', external_id: 'SP-C1', platform_fee_amount: 5000, payments: [{ amount: 95000, method: 'shopee_payout' }] });
  ok(await api.post(`/orders/${o.id}/status`, { status: 'cancelled' }));
});

// ---------- Việc 2: lô hết hạn ----------
test('lô hết hạn: xác nhận bị chặn LOT_EXPIRED, vượt bằng allow_expired và gắn cảnh báo; preview báo trước', async () => {
  const { api, order, stockIn, v, wh } = await world();
  await stockIn(5, 'L-OLD', inDays(-30));
  await stockIn(5, 'L-SOON', inDays(7));
  const prev = ok(await api.post('/orders/allocation-preview', { shop_id: (await api.get('/shops')).body.data[0].id, lines: [{ variant_id: v.id, qty: 25 }] }));
  assert.ok(prev.warnings.some((w) => w.code === 'LOT_EXPIRED' && w.lot_no === 'L-OLD'));
  assert.ok(prev.warnings.some((w) => w.code === 'LOT_EXPIRING' && w.lot_no === 'L-SOON'));
  const d = await order({ lines: [{ variant_id: v.id, qty: 22, unit_price: 100000 }] });
  // 20 tồn không lô đứng đầu? FEFO: lô có hạn trước, hàng không lô bỏ qua → lô quá hạn bị chạm
  const r = await api.post(`/orders/${d.id}/status`, { status: 'confirmed' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'LOT_EXPIRED');
  assert.equal(r.body.error.details.lots[0].lot_no, 'L-OLD');
  assert.equal(ok(await api.get(`/orders/${d.id}`)).status, 'draft');
  const c = ok(await api.post(`/orders/${d.id}/status`, { status: 'confirmed', allow_expired: true }));
  assert.equal(c.expired_lot_warning, 1);
  // Tạo thẳng đơn hoàn thành cũng bị chặn khi chạm lô quá hạn (còn 8 tồn, trong đó 3 từ lô cũ... lô cũ đã hết ở trên)
  assert.deepEqual(verifyStock(), []);
  void wh;
});

test('xuất huỷ lô hết hạn: phiếu hàng hỏng đúng số còn lại, trừ đúng lô, sau đó bán bình thường', async () => {
  const { api, order, stockIn, v } = await world();
  await stockIn(5, 'L-OLD', inDays(-2));
  await stockIn(5, 'L-NEW', inDays(90));
  assert.equal((await api.post('/orders', { shop_id: (await api.get('/shops')).body.data[0].id, status: 'confirmed', lines: [{ variant_id: v.id, qty: 1, unit_price: 1 }] })).body.error.code, 'LOT_EXPIRED');
  const lots = ok(await api.get('/stock-lots'));
  const old = lots.find((l) => l.lot_no === 'L-OLD');
  const fresh = lots.find((l) => l.lot_no === 'L-NEW');
  assert.equal((await api.post(`/stock-lots/${fresh.id}/write-off`, {})).body.error.code, 'LOT_NOT_EXPIRED');
  const w = ok(await api.post(`/stock-lots/${old.id}/write-off`, {}));
  assert.equal(w.qty, 5);
  const after = ok(await api.get('/stock-lots'));
  assert.deepEqual(after.map((l) => [l.lot_no, l.qty]), [['L-NEW', 5]]);
  assert.equal(ok(await api.get('/stock')).find((x) => x.variant_id === v.id).on_hand, 25);
  assert.equal((await api.post(`/stock-lots/${old.id}/write-off`, {})).status, 404);
  const o = await order({ status: 'confirmed' });
  assert.equal(o.expired_lot_warning, 0);
  await sound(api);
});

// ---------- Việc 3: dịch vụ ----------
test('dịch vụ: bán không cần tồn, không biến động kho, giá vốn 0, không vào kho/kiểm kê, trả = hoàn tiền', async () => {
  const { api, nh, wh, order, v } = await world();
  const s = ok(await api.post('/products', { name: 'Khai quang', item_type: 'service', variants: [{ sku: 'DV-KQ', default_price: 200000 }], shop_ids: [nh.id] }));
  assert.equal(s.item_type, 'service');
  const sv = s.variants[0];
  // Không nhập kho / điều chỉnh / kiểm kê / chuyển kho
  assert.equal((await api.post('/products', { name: 'DV2', item_type: 'service', variants: [{ sku: 'DV-2', default_price: 1, opening_qty: 3, opening_cost: 1 }], opening_warehouse_id: wh.id })).body.error.code, 'SERVICE_NO_STOCK');
  const sup = ok(await api.post('/suppliers', { name: 'NCC2' }));
  const pr = await api.post('/purchases', { supplier_id: sup.id, warehouse_id: wh.id, receive: true, lines: [{ variant_id: sv.id, qty: 1, unit_cost: 1 }] });
  assert.equal(pr.body.error.code, 'SERVICE_NO_STOCK');
  assert.equal((await api.post('/stock-adjustments', { warehouse_id: wh.id, kind: 'adjust', lines: [{ variant_id: sv.id, change: 1, unit_cost: 1 }] })).body.error.code, 'SERVICE_NO_STOCK');
  assert.equal(ok(await api.get('/stock')).some((x) => x.variant_id === sv.id), false);
  // Bán cùng hàng: không đòi tồn, không phân bổ
  const prev = ok(await api.post('/orders/allocation-preview', { shop_id: nh.id, lines: [{ variant_id: sv.id, qty: 5 }, { variant_id: v.id, qty: 1 }] }));
  assert.equal(prev.ok, true);
  assert.equal(prev.lines[0].is_service, true);
  assert.deepEqual(prev.lines[0].items, []);
  const o = await order({ status: 'completed', lines: [{ variant_id: v.id, qty: 1, unit_price: 100000 }, { variant_id: sv.id, qty: 1, unit_price: 200000 }], payments: [{ amount: 300000, method: 'cash' }] });
  const dv = o.lines.find((l) => l.variant_id === sv.id);
  assert.equal(dv.cogs_amount, 0);
  assert.equal(dv.allocations.length, 0);
  assert.equal(o.cogs_amount, 40000);
  assert.equal(one("SELECT COUNT(*) AS n FROM stock_movements WHERE variant_id = ?", sv.id).n, 0);
  // Tìm khi tạo đơn
  const found = ok(await api.get(`/variants?shop_id=${nh.id}&q=DV-KQ`));
  assert.equal(found[0].is_service, 1);
  // Trả dịch vụ = hoàn tiền, không nhập kho, không phiếu hàng huỷ
  const ret = ok(await api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: dv.id, qty: 1, restock: false }], refund: { amount: 200000, method: 'cash' } }));
  assert.equal(ret.write_offs.length, 0);
  assert.equal(ret.returned_goods_amount, 200000);
  assert.equal(one("SELECT COUNT(*) AS n FROM stock_movements WHERE variant_id = ?", sv.id).n, 0);
  assert.equal(ok(await api.get(`/products?item_type=service&shop_id=${nh.id}`)).length, 1);
  assert.equal(ok(await api.get(`/products?item_type=product&shop_id=${nh.id}`)).some((p) => p.name === 'Khai quang'), false);
  // Báo cáo theo sản phẩm vẫn tính doanh thu dịch vụ
  const prod = ok(await api.get(`/reports/products?${WIDE()}`));
  assert.ok(JSON.stringify(prod).includes('DV-KQ'));
  await sound(api);
});

test('dịch vụ: không đổi loại khi đã có lịch sử, không làm thành phần combo, nhập hàng loạt nhận loại Dịch vụ', async () => {
  const { api, nh, order, v } = await world();
  const s = ok(await api.post('/products', { name: 'Chỉnh size', item_type: 'service', variants: [{ sku: 'DV-CS', default_price: 50000 }], shop_ids: [nh.id] }));
  const sv = s.variants[0];
  // Chưa có lịch sử: đổi qua lại được
  assert.equal(ok(await api.patch(`/products/${s.id}`, { item_type: 'product' })).item_type, 'product');
  assert.equal(ok(await api.patch(`/products/${s.id}`, { item_type: 'service' })).item_type, 'service');
  await order({ status: 'completed', lines: [{ variant_id: sv.id, qty: 1, unit_price: 50000 }] });
  const r = await api.patch(`/products/${s.id}`, { item_type: 'product' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'SERVICE_TYPE_LOCKED');
  const combo = await api.post('/products', { name: 'Combo', variants: [{ sku: 'CB1', kind: 'bundle', default_price: 1, components: [{ variant_id: sv.id, qty: 1 }, { variant_id: v.id, qty: 1 }] }], shop_ids: [nh.id] });
  assert.equal(combo.status, 400);
  // Nhập hàng loạt
  const imp = ok(await api.post('/products/import', { shop_ids: [nh.id], rows: [{ name: 'Tư vấn', sku: 'DV-TV', price: 100000, item_type: 'Dịch vụ' }, { name: 'Tư vấn 2', sku: 'DV-TV2', price: 1, qty: 2, cost: 1, item_type: 'Dịch vụ' }] }));
  assert.equal(imp.created.length, 1);
  assert.equal(imp.skipped.length, 1);
  assert.equal(ok(await api.get(`/products?item_type=service&shop_id=${nh.id}`)).some((p) => p.name === 'Tư vấn'), true);
});

// ---------- Việc 4: ship đơn sàn ----------
test('đơn sàn nhập tay: từ chối phí ship khách trả; chấp nhận khi kèm ship shop chịu bằng đúng số đó', async () => {
  const { api, nh, v } = await world();
  const body = { shop_id: nh.id, channel_id: 'shopee', status: 'completed', external_id: 'SP-S1', lines: [{ variant_id: v.id, qty: 2, unit_price: 100000 }], platform_fee_amount: 24000 };
  const bad = await api.post('/orders', { ...body, shipping_fee: 30000 });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'MARKETPLACE_SHIPPING_FEE');
  const fine = ok(await api.post('/orders', { ...body, external_id: 'SP-S2', shipping_fee: 30000, seller_shipping_amount: 30000 }));
  assert.equal(fine.net_amount, 200000 - 24000);
  const plain = ok(await api.post('/orders', { ...body, external_id: 'SP-S3' }));
  assert.equal(plain.net_amount, 176000);
  assert.equal((await api.patch(`/orders/${plain.id}`, { shipping_fee: 5000 })).status, 400);
});

test('đơn sàn cũ có phí ship khách trả: trả TOÀN BỘ thì số cần thu về 0 (tự hoàn ship), trả một phần chưa hoàn ship', async () => {
  const { api, nh, v } = await world();
  const mk = async (ext) => {
    const o = ok(await api.post('/orders', { shop_id: nh.id, channel_id: 'shopee', status: 'completed', external_id: ext, lines: [{ variant_id: v.id, qty: 2, unit_price: 100000 }], platform_fee_amount: 24000 }));
    // Dựng đơn kiểu cũ (ship 30.000 nằm trong số shop nhận) bằng SQL, vì API không còn cho tạo
    getDb().prepare('UPDATE orders SET shipping_fee = 30000, total_amount = total_amount + 30000, net_amount = net_amount + 30000 WHERE id = ?').run(o.id);
    return ok(await api.get(`/orders/${o.id}`));
  };
  const o = await mk('SP-LEG1');
  assert.equal(o.net_amount, 206000);
  const part = ok(await api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: o.lines[0].id, qty: 1, restock: true }] }));
  assert.equal(part.returned_shipping_amount, 0);
  const full = ok(await api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: o.lines[0].id, qty: 1, restock: true }] }));
  assert.equal(full.returned_shipping_amount, 30000);
  assert.equal(full.amount_due, 0);
  assert.equal(full.status, 'returned');
  assert.equal(ok(await api.get(`/reports/cashflow?${WIDE()}`)).marketplace_pending, 0);
  assert.deepEqual(verifyJournal(), []);
  assert.deepEqual(verifyStats(), []);
});
