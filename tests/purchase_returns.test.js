import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { getDb } from '../server/db/index.js';
import { flushJournal, verifyJournal } from '../server/modules/accounting/journal.js';
import { verifyStock } from '../server/modules/inventory/verify.js';
import { writeSetting } from '../server/modules/settings/service.js';
import { businessDate, nowIso } from '../server/lib/time.js';

const ok = (r, s = [200, 201]) => { assert.ok([].concat(s).includes(r.status), JSON.stringify(r.body)); return r.body.data; };
const bal = () => { flushJournal(); return Object.fromEntries(getDb().prepare('SELECT account_code a, SUM(debit)-SUM(credit) b FROM journal_lines GROUP BY account_code').all().map((x) => [x.a, x.b])); };
const today = () => businessDate(nowIso());

async function world() {
  const ctx = await setup();
  const v = ok(await ctx.api.post('/products', { name: 'A', variants: [{ sku: 'A1', default_price: 300000 }], shop_ids: [ctx.nh.id] })).variants[0];
  const sup = ok(await ctx.api.post('/suppliers', { name: 'NCC' }));
  const buy = async (qty, unit_cost, extra = {}) => ok(await ctx.api.post('/purchases', { supplier_id: sup.id, warehouse_id: ctx.wh.id, shop_id: ctx.nh.id, receive: true, lines: [{ variant_id: v.id, qty, unit_cost, ...(extra.line || {}) }], ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'line')) }));
  const sell = async (qty) => ok(await ctx.api.post('/orders', { shop_id: ctx.nh.id, channel_id: 'direct', status: 'completed', lines: [{ variant_id: v.id, qty, unit_price: 300000 }] }));
  const ret = (pu, qty, extra = {}) => ctx.api.post(`/purchases/${pu.id}/returns`, { lines: [{ purchase_line_id: pu.lines[0].id, qty }], ...extra });
  const level = () => getDb().prepare('SELECT on_hand, avg_cost FROM stock_levels WHERE variant_id = ?').get(v.id);
  return { ...ctx, v, sup, buy, sell, ret, level };
}

/** Sau mỗi kịch bản: số nguyên, sổ kho và sổ kế toán sạch, 331 khớp nợ NCC, 156 khớp giá trị tồn trong sai số làm tròn */
async function check(api, sup, { fifo = false } = {}) {
  assert.deepEqual(verifyStock(), []);
  assert.deepEqual(verifyJournal(), []);
  const db = getDb();
  for (const [t, cols] of [['purchases', ['total_amount', 'paid_amount', 'returned_amount', 'allowance_amount', 'carrier_amount']], ['purchase_returns', ['goods_amount', 'stock_value', 'refund_amount']], ['purchase_allowances', ['amount', 'stock_amount', 'sold_amount', 'refund_amount']], ['payments', ['amount']]]) {
    for (const r of db.prepare(`SELECT * FROM ${t}`).all()) for (const c of cols) assert.ok(Number.isInteger(r[c]), `${t}.${c} = ${r[c]}`);
  }
  const b = bal();
  const rows = db.prepare("SELECT total_amount - returned_amount - allowance_amount - paid_amount AS due FROM purchases WHERE status = 'received'").all();
  assert.equal((b['331'] ?? 0) + 0, 0 - rows.reduce((a, r) => a + r.due, 0) + 0);
  const onHand = db.prepare('SELECT COALESCE(SUM(on_hand),0) n FROM stock_levels').get().n;
  const value = fifo ? db.prepare('SELECT COALESCE(SUM(ROUND(qty*1000)*unit_cost/1000.0),0) v FROM stock_layers').get().v : db.prepare('SELECT COALESCE(SUM(MAX(on_hand,0)*avg_cost),0) v FROM stock_levels').get().v;
  const cogs = db.prepare("SELECT COALESCE(SUM(cogs_amount),0) c FROM orders WHERE status IN ('confirmed','shipping','completed','returned')").get().c;
  // 156 = nhập − giá vốn đã bán − xuất trả − giảm giá tồn; so với giá trị tồn: lệch tối đa vài đồng do làm tròn giá bình quân
  assert.ok(Math.abs((b['156'] ?? 0) - value) <= Math.max(5, onHand), `156=${b['156']} giá trị tồn=${value} cogs=${cogs}`);
  const p = (await api.get('/payables')).body;
  const owes = db.prepare("SELECT COALESCE(SUM(MAX(0, paid_amount - (total_amount - returned_amount - allowance_amount))),0) n FROM purchases WHERE status='received'").get().n;
  assert.equal(p.receivable_total, owes);
  assert.equal(p.by_kind.supplier, rows.reduce((a, r) => a + Math.max(0, r.due), 0));
  return b;
}

test('trả một phần, phiếu chưa trả tiền, có chiết khấu + ship trả NCC: nợ giảm theo giá mua, phí ship không hoàn', async () => {
  const { api, sup, buy, ret, level } = await world();
  const pu = await buy(10, 100000, { discount_amount: 100000, shipping_fee: 200000 });
  assert.equal(pu.total_amount, 1100000);
  assert.equal(pu.lines[0].landed_unit_cost, 110000);
  const r = ok(await ret(pu, 4, { reason: 'Hàng lỗi' }));
  assert.match(r.code, /^TN-/);
  assert.equal(r.goods_amount, 360000); // 4/10 của (1.000.000 − chiết khấu 100.000)
  assert.equal(r.stock_value, 440000); // xuất ở giá nhập đã phân bổ 110.000
  const after = ok(await api.get(`/purchases/${pu.id}`));
  assert.equal(after.returned_amount, 360000);
  assert.equal(after.debt, 740000);
  assert.equal(after.lines[0].returnable_qty, 6);
  assert.equal(level().on_hand, 6);
  const b = await check(api, sup);
  assert.equal(b['331'], -740000); assert.equal(b['156'], 660000);
  assert.equal(b['811'], 80000); // phần ship phân bổ vào 4 cái trả, NCC không hoàn
  assert.equal(ok(await api.get('/suppliers')).find((s) => s.id === sup.id).debt, 740000);
  // trả quá số còn lại
  const over = await ret(pu, 7);
  assert.equal(over.status, 400); assert.equal(over.body.error.code, 'RETURN_QTY_TOO_BIG');
  ok(await ret(pu, 6)); // trả nốt
  const done = ok(await api.get(`/purchases/${pu.id}`));
  assert.equal(done.returned_amount, 900000); // đúng bằng giá mua sau chiết khấu, không lệch đồng nào
  assert.equal(done.debt, 200000); // còn nợ phần ship
  assert.equal(level().on_hand, 0);
  await check(api, sup);
});

test('đã trả một phần: phần vượt là NCC còn nợ shop, hiện ở Công nợ phải trả, thu sau được', async () => {
  const { api, sup, buy, ret } = await world();
  const pu = await buy(10, 100000);
  ok(await api.post(`/purchases/${pu.id}/payments`, { amount: 800000, method: 'bank' }));
  ok(await ret(pu, 4)); // credit 400.000: còn nợ 1.000.000 − 400.000 − 800.000 = −200.000
  const after = ok(await api.get(`/purchases/${pu.id}`));
  assert.equal(after.debt, 0); assert.equal(after.supplier_owes, 200000);
  const pay = (await api.get('/payables')).body;
  const row = pay.data.find((x) => x.kind === 'supplier_refund');
  assert.equal(row.amount, 200000);
  assert.equal(pay.total, 0); // khoản phải thu không cộng vào tổng phải trả
  await check(api, sup);
  assert.equal((await api.post(`/purchases/${pu.id}/supplier-refunds`, { amount: 300000, method: 'bank' })).status, 400);
  assert.equal((await api.post(`/purchases/${pu.id}/payments`, { amount: 1, method: 'bank' })).status, 400); // không trả thêm khi NCC đã nợ
  const got = ok(await api.post(`/purchases/${pu.id}/supplier-refunds`, { amount: 200000, method: 'bank' }));
  assert.equal(got.supplier_owes, 0); assert.equal(got.paid_amount, 600000);
  const b = await check(api, sup);
  assert.equal(b['331'], 0);
});

test('đã trả đủ: NCC hoàn ngay tạo khoản thu; huỷ phiếu trả khôi phục kho, nợ và khoản thu', async () => {
  const { api, sup, buy, ret, level } = await world();
  const pu = await buy(10, 100000);
  ok(await api.post(`/purchases/${pu.id}/payments`, { amount: 1000000, method: 'bank' }));
  const r = ok(await ret(pu, 4, { refund: { now: true, method: 'bank' } }));
  assert.equal(r.refund_amount, 400000);
  let p = ok(await api.get(`/purchases/${pu.id}`));
  assert.equal(p.paid_amount, 600000); assert.equal(p.debt, 0); assert.equal(p.supplier_owes, 0);
  const inPay = p.payments.find((x) => x.direction === 'in');
  assert.equal(inPay.amount, 400000);
  // khoản hoàn do phiếu trả tạo ra thì không huỷ lẻ
  const lone = await api.post(`/payments/${inPay.id}/void`, {});
  assert.equal(lone.status, 409); assert.equal(lone.body.error.code, 'PAYMENT_FROM_RETURN');
  await check(api, sup);
  ok(await api.post(`/purchase-returns/${r.id}/void`, { reason: 'Nhầm' }));
  assert.equal((await api.post(`/purchase-returns/${r.id}/void`, {})).status, 409);
  p = ok(await api.get(`/purchases/${pu.id}`));
  assert.equal(p.returned_amount, 0); assert.equal(p.paid_amount, 1000000); assert.equal(p.debt, 0);
  assert.equal(level().on_hand, 10); assert.equal(level().avg_cost, 100000);
  const b = await check(api, sup);
  assert.equal(b['331'], 0); assert.equal(b['156'], 1000000); assert.equal(b['811'] ?? 0, 0);
  // huỷ phiếu nhập sau khi đã huỷ hết phiếu trả: được
  ok(await api.post(`/purchases/${pu.id}/cancel`, { refund_method: 'bank' }));
  await check(api, sup);
});

test('NCC hoàn sau: để treo rồi thu; huỷ khoản thu nhập tay đưa nợ NCC về', async () => {
  const { api, sup, buy, ret } = await world();
  const pu = await buy(10, 100000);
  ok(await api.post(`/purchases/${pu.id}/payments`, { amount: 1000000, method: 'cash' }));
  ok(await ret(pu, 5)); // không refund.now → treo 500.000
  let p = ok(await api.get(`/purchases/${pu.id}`));
  assert.equal(p.supplier_owes, 500000);
  p = ok(await api.post(`/purchases/${pu.id}/supplier-refunds`, { amount: 500000, method: 'cash' }));
  assert.equal(p.supplier_owes, 0);
  const pay = p.payments.find((x) => x.direction === 'in');
  ok(await api.post(`/payments/${pay.id}/void`, { reason: 'Ghi nhầm' }));
  p = ok(await api.get(`/purchases/${pu.id}`));
  assert.equal(p.supplier_owes, 500000);
  await check(api, sup);
});

test('đã bán bớt: không trả vượt tồn; trả đúng số còn; không huỷ được phiếu nhập khi còn phiếu trả', async () => {
  const { api, sup, buy, sell, ret, level } = await world();
  const pu = await buy(10, 100000);
  await sell(7);
  const r1 = await ret(pu, 4);
  assert.equal(r1.status, 409); assert.equal(r1.body.error.code, 'STOCK_NOT_ENOUGH');
  assert.equal(level().on_hand, 3);
  const r = ok(await ret(pu, 3));
  assert.equal(r.goods_amount, 300000);
  assert.equal(level().on_hand, 0);
  const c = await api.post(`/purchases/${pu.id}/cancel`, {});
  assert.equal(c.status, 409); assert.equal(c.body.error.code, 'PURCHASE_HAS_RETURNS');
  const b = await check(api, sup);
  assert.equal(b['331'], -700000); assert.equal(b['156'] ?? 0, 0);
  // đơn đã bán giữ nguyên giá vốn đã chụp
  assert.equal(getDb().prepare("SELECT cogs_amount c FROM orders").get().c, 700000);
});

test('bình quân: kho về 0 thì xuất ở giá bình quân, giá trị tồn không dư', async () => {
  const { api, sup, buy, sell, ret } = await world();
  const a = await buy(10, 100000); const b = await buy(10, 200000); // bình quân 150.000
  await sell(10); // giá vốn 1.500.000, còn 10 × 150.000
  ok(await ret(a, 10)); // kho về 0; giá nhập 100.000 nhưng giá trị tồn thực là 1.500.000
  const lv = getDb().prepare('SELECT on_hand FROM stock_levels').get();
  assert.equal(lv.on_hand, 0);
  const bl = await check(api, sup);
  assert.equal(bl['156'] ?? 0, 0);
  assert.equal(bl['811'], 500000); // 1.500.000 giá trị tồn xuất − 1.000.000 NCC hoàn
  void b;
});

test('FIFO: trả rút lớp giá của chính phiếu; lớp đã bán hết thì lấy lớp khác, giá trị tồn vẫn khớp', async () => {
  const { api, sup, buy, sell, ret } = await world();
  ok(await api.put('/costing-method', { method: 'fifo' }));
  const a = await buy(10, 100000); const b = await buy(10, 120000);
  const r1 = ok(await ret(b, 4)); // lớp của phiếu b: 4 × 120.000
  assert.equal(r1.stock_value, 480000); assert.equal(r1.goods_amount, 480000);
  await check(api, sup, { fifo: true });
  await sell(10); // bán hết lớp a
  const r2 = ok(await ret(a, 3)); // lớp a đã hết: lấy lớp b (120.000)
  assert.equal(r2.goods_amount, 300000); assert.equal(r2.stock_value, 360000);
  const bl = await check(api, sup, { fifo: true });
  assert.equal(bl['811'], 60000);
  ok(await api.post(`/purchase-returns/${r2.id}/void`, {}));
  const layers = getDb().prepare('SELECT ROUND(SUM(qty),3) q FROM stock_layers').get().q;
  assert.equal(layers, 6);
  await check(api, sup, { fifo: true });
});

test('có lô: trả rút lô của dòng, huỷ phiếu trả đưa lại đúng lô', async () => {
  const { api, sup, buy, ret } = await world();
  const pu = await buy(10, 100000, { line: { lot_no: 'L1', expiry_date: '2030-01-01' } });
  const lots = () => getDb().prepare('SELECT lot_no, qty FROM stock_lots').all();
  assert.deepEqual(lots(), [{ lot_no: 'L1', qty: 10 }]);
  const r = ok(await ret(pu, 3));
  assert.deepEqual(lots(), [{ lot_no: 'L1', qty: 7 }]);
  ok(await api.post(`/purchase-returns/${r.id}/void`, {}));
  assert.equal(lots().reduce((a, x) => a + x.qty, 0), 10);
  await check(api, sup);
});

test('ship trả hãng vận chuyển: hàng trả giữ nguyên nợ hãng, phần ship phân bổ vào 811', async () => {
  const { api, sup, buy, ret } = await world();
  const pu = await buy(100, 200000, { shipping_fee: 1000000, shipping_payee: 'carrier' });
  const r = ok(await ret(pu, 10));
  assert.equal(r.goods_amount, 2000000); assert.equal(r.stock_value, 2100000);
  const p = ok(await api.get(`/purchases/${pu.id}`));
  assert.equal(p.debt, 18000000); assert.equal(p.carrier_debt, 1000000);
  const b = await check(api, sup);
  assert.equal(b['811'], 100000); assert.equal(b['3388'], -1000000);
});

test('giảm giá sau nhận: còn tồn toàn bộ → giảm giá vốn tồn kho; đã bán một nửa → chia hai phần; bán hết → thu nhập khác', async () => {
  const { api, sup, buy, sell, level } = await world();
  // 1. còn tồn toàn bộ
  const a = await buy(10, 100000);
  const al = ok(await api.post(`/purchases/${a.id}/allowances`, { amount: 100000, reason: 'Hàng xấu' }));
  assert.match(al.code, /^GG-/);
  assert.equal(al.stock_amount, 100000); assert.equal(al.sold_amount, 0);
  assert.equal(level().avg_cost, 90000);
  let b = await check(api, sup);
  assert.equal(b['331'], -900000); assert.equal(b['156'], 900000); assert.equal(b['711'] ?? 0, 0);
  assert.equal((await api.post(`/purchases/${a.id}/allowances`, { amount: 900001 })).body.error.code, 'ALLOWANCE_TOO_BIG');
  // huỷ phiếu giảm giá: giá vốn tồn về cũ, nợ về cũ
  ok(await api.post(`/purchase-allowances/${al.id}/void`, { reason: 'Nhầm' }));
  assert.equal(level().avg_cost, 100000);
  b = await check(api, sup);
  assert.equal(b['331'], -1000000);
  // 2. bán một nửa rồi giảm
  await sell(5);
  const al2 = ok(await api.post(`/purchases/${a.id}/allowances`, { amount: 100000 }));
  assert.equal(al2.stock_amount, 50000); assert.equal(al2.sold_amount, 50000);
  assert.equal(level().avg_cost, 90000); // (5 × 100.000 − 50.000) / 5
  b = await check(api, sup);
  assert.equal(b['711'], -50000); assert.equal(b['331'], -900000);
  assert.equal(getDb().prepare('SELECT cogs_amount c FROM orders').get().c, 500000); // giá vốn đã chụp không đổi
  // 3. bán hết rồi giảm tiếp
  await sell(5);
  const al3 = ok(await api.post(`/purchases/${a.id}/allowances`, { amount: 50000 }));
  assert.equal(al3.stock_amount, 0); assert.equal(al3.sold_amount, 50000);
  b = await check(api, sup);
  assert.equal(b['711'], -100000);
});

test('giảm giá sau nhận: phiếu đã trả đủ thì thành NCC nợ shop, thu ngay; FIFO giảm đơn giá lớp; không huỷ được phiếu nhập', async () => {
  const { api, sup, buy, level } = await world();
  ok(await api.put('/costing-method', { method: 'fifo' }));
  const a = await buy(10, 100000);
  ok(await api.post(`/purchases/${a.id}/payments`, { amount: 1000000, method: 'bank' }));
  const al = ok(await api.post(`/purchases/${a.id}/allowances`, { amount: 60000, reason: 'Cân thiếu', refund: { now: true, method: 'bank' } }));
  assert.equal(al.refund_amount, 60000);
  assert.equal(getDb().prepare('SELECT unit_cost u FROM stock_layers').get().u, 94000);
  assert.equal(level().avg_cost, 94000);
  const p = ok(await api.get(`/purchases/${a.id}`));
  assert.equal(p.paid_amount, 940000); assert.equal(p.debt, 0); assert.equal(p.supplier_owes, 0);
  const c = await api.post(`/purchases/${a.id}/cancel`, {});
  assert.equal(c.body.error.code, 'PURCHASE_HAS_RETURNS');
  ok(await api.post(`/purchase-allowances/${al.id}/void`, {}));
  assert.equal(getDb().prepare('SELECT unit_cost u FROM stock_layers').get().u, 100000);
  const p2 = ok(await api.get(`/purchases/${a.id}`));
  assert.equal(p2.paid_amount, 1000000);
  await check(api, sup, { fifo: true });
});

test('cân thiếu 3 kg: trả hàng nhập số lượng lẻ, tiền khớp từng đồng', async () => {
  const { api, sup, buy, ret } = await world();
  const pu = await buy(100, 45500);
  const r = ok(await ret(pu, 3));
  assert.equal(r.goods_amount, 136500);
  const r2 = ok(await ret(pu, 0.333));
  assert.equal(r2.goods_amount, 15152); // 0,333 × 45.500 = 15.151,5 → làm tròn
  await check(api, sup);
});

test('khoá sổ kế toán và chốt kho chặn lập và huỷ phiếu trả, giảm giá', async () => {
  const { api, sup, buy, ret } = await world();
  const pu = await buy(10, 100000);
  const r = ok(await ret(pu, 2));
  const al = ok(await api.post(`/purchases/${pu.id}/allowances`, { amount: 10000 }));
  // khoá sổ kế toán đến hôm nay
  ok(await api.post('/accounting/lock', { date: today() }));
  for (const res of [await ret(pu, 1), await api.post(`/purchases/${pu.id}/allowances`, { amount: 1000 }), await api.post(`/purchase-returns/${r.id}/void`, {}), await api.post(`/purchase-allowances/${al.id}/void`, {})]) {
    assert.equal(res.status, 409); assert.equal(res.body.error.code, 'PERIOD_LOCKED');
  }
  ok(await api.post('/accounting/lock', { date: null }));
  // chốt kho đến hôm nay
  writeSetting('stock_lock_date', today());
  for (const res of [await ret(pu, 1), await api.post(`/purchases/${pu.id}/allowances`, { amount: 1000 }), await api.post(`/purchase-returns/${r.id}/void`, {}), await api.post(`/purchase-allowances/${al.id}/void`, {})]) {
    assert.equal(res.status, 409); assert.equal(res.body.error.code, 'STOCK_PERIOD_CLOSED');
  }
  writeSetting('stock_lock_date', null);
  ok(await api.post(`/purchase-returns/${r.id}/void`, {}));
  await check(api, sup);
});

test('chứng từ gộp, danh sách phiếu trả, chi tiết phiếu nhập có lịch sử trả', async () => {
  const { api, buy, ret } = await world();
  const pu = await buy(10, 100000);
  const r = ok(await ret(pu, 2));
  ok(await api.post(`/purchases/${pu.id}/allowances`, { amount: 10000 }));
  const docs = ok(await api.get('/documents?type=purchase_return'));
  assert.equal(docs.length, 1); assert.equal(docs[0].code, r.code); assert.equal(docs[0].amount, 200000);
  assert.equal(ok(await api.get('/documents?type=purchase_allowance')).length, 1);
  const list = (await api.get(`/purchase-returns?purchase_id=${pu.id}`)).body.data;
  assert.equal(list.length, 1);
  const det = ok(await api.get(`/purchase-returns/${r.id}`));
  assert.equal(det.lines.length, 1); assert.equal(det.lines[0].qty, 2);
  const p = ok(await api.get(`/purchases/${pu.id}`));
  assert.equal(p.returns.length, 1); assert.equal(p.allowances.length, 1);
  assert.ok(getDb().prepare("SELECT 1 FROM audit_log WHERE action = 'purchase.returned'").get());
  assert.ok(getDb().prepare("SELECT 1 FROM events WHERE type = 'purchase.returned'").get());
});
