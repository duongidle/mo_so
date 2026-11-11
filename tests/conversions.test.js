import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { getDb } from '../server/db/index.js';
import { flushJournal, verifyJournal } from '../server/modules/accounting/journal.js';
import { verifyStock } from '../server/modules/inventory/verify.js';
import { writeSetting } from '../server/modules/settings/service.js';
import { lineAmount } from '../server/lib/money.js';
import { addDays, businessDate } from '../server/lib/time.js';

const ok = (r, s = [200, 201]) => { assert.ok([].concat(s).includes(r.status), JSON.stringify(r.body)); return r.body.data; };
const bal = () => { flushJournal(); return Object.fromEntries(getDb().prepare('SELECT account_code a, SUM(debit)-SUM(credit) b FROM journal_lines GROUP BY account_code').all().map((x) => [x.a, x.b])); };
const today = () => businessDate();

/** 20 kg điều (2 lô khác hạn, ship nhập chia vào giá vốn) + hộp rỗng + tem; thành phẩm hộp 500 g và túi 1 kg */
async function world({ fifo = false } = {}) {
  const ctx = await setup();
  const { api, wh, nh } = ctx;
  if (fifo) ok(await api.put('/costing-method', { method: 'fifo' }));
  const kg = ok(await api.post('/products', { name: 'Hạt điều', unit: 'kg', variants: [{ sku: 'DIEU-KG' }] })).variants[0];
  const box = ok(await api.post('/products', { name: 'Hộp rỗng', item_type: 'packaging', unit: 'cái', variants: [{ sku: 'HOP-RONG', opening_qty: 100, opening_cost: 2000 }], opening_warehouse_id: wh.id })).variants[0];
  const tem = ok(await api.post('/products', { name: 'Tem', item_type: 'packaging', unit: 'cái', variants: [{ sku: 'TEM', opening_qty: 100, opening_cost: 500 }], opening_warehouse_id: wh.id })).variants[0];
  const hopP = ok(await api.post('/products', { name: 'Điều hộp 500g', variants: [{ sku: 'DIEU-500', default_price: 150000 }], shop_ids: [nh.id] }));
  const hop = hopP.variants[0];
  const tuiP = ok(await api.post('/products', { name: 'Điều túi 1kg', variants: [{ sku: 'DIEU-1KG', default_price: 280000 }], shop_ids: [nh.id] }));
  const tui = tuiP.variants[0];
  ok(await api.put(`/conversion-recipes/${hop.id}`, { source_variant_id: kg.id, qty_per_unit: 0.5 }));
  ok(await api.put(`/conversion-recipes/${tui.id}`, { source_variant_id: kg.id, qty_per_unit: 1 }));
  ok(await api.put(`/packaging-specs/${hopP.id}`, { lines: [{ material_variant_id: box.id, qty: 1 }, { material_variant_id: tem.id, qty: 1 }] }));
  const sup = ok(await api.post('/suppliers', { name: 'NCC điều' }));
  const d = (n) => addDays(today(), n);
  const buy = (qty, unit_cost, lot_no, expiry_date, extra = {}) => ok(await_(api.post('/purchases', { supplier_id: sup.id, warehouse_id: wh.id, receive: true, ...extra, lines: [{ variant_id: kg.id, qty, unit_cost, lot_no, expiry_date }] })));
  function await_(p) { return p; }
  return { ...ctx, kg, box, tem, hop, tui, hopP, sup, d, buyRaw: async (qty, unit_cost, lot_no, expiry_date, extra = {}) => ok(await api.post('/purchases', { supplier_id: sup.id, warehouse_id: wh.id, receive: true, ...extra, lines: [{ variant_id: kg.id, qty, unit_cost, lot_no, expiry_date }] })) };
}
const level = (v) => getDb().prepare('SELECT on_hand, avg_cost FROM stock_levels WHERE variant_id = ?').get(v.id);
const movs = (convId, type, variantId) => getDb().prepare('SELECT * FROM stock_movements WHERE ref_type = ? AND ref_id = ? AND variant_id = ? ORDER BY rowid').all('conversion', convId, variantId).filter((m) => !type || m.type === type);

async function twoLots(w) {
  await w.buyRaw(12, 200000, 'L-A', w.d(60));
  await w.buyRaw(8, 230000, 'L-B', w.d(120), { shipping_fee: 100000 });
}

async function checkClean(label = '') {
  assert.deepEqual(verifyStock(), [], label);
  assert.deepEqual(verifyJournal(), [], label);
  const db = getDb();
  for (const [t, cols] of [['stock_conversions', ['source_value', 'output_value']], ['stock_conversion_lines', ['amount', 'unit_cost']], ['stock_movements', ['unit_cost']]]) {
    for (const r of db.prepare(`SELECT * FROM ${t}`).all()) for (const c of cols) assert.ok(Number.isInteger(r[c]), `${t}.${c} = ${r[c]}`);
  }
}

test('20 kg (2 lô, có phí nhập) + bao bì → 39 hộp: giá vốn bảo toàn từng đồng, lô/hạn, định mức, 156 không đổi', async () => {
  const w = await world();
  const { api, wh, kg, box, tem, hop } = w;
  await twoLots(w);
  const sg = ok(await api.post('/conversions/suggest', { warehouse_id: wh.id, outputs: [{ variant_id: hop.id, qty: 40 }] }));
  const byId = Object.fromEntries(sg.sources.map((s) => [s.variant_id, s]));
  assert.equal(byId[kg.id].qty, 20); assert.equal(byId[box.id].qty, 40); assert.equal(byId[tem.id].qty, 40);
  const before = bal();
  const kgValueBefore = lineAmount(level(kg).on_hand, level(kg).avg_cost);
  const c = ok(await api.post('/conversions', { warehouse_id: wh.id, note: 'Đóng hết', sources: [{ variant_id: kg.id, qty: 20 }, { variant_id: box.id, qty: 39 }, { variant_id: tem.id, qty: 39 }], outputs: [{ variant_id: hop.id, qty: 39 }] }));
  assert.match(c.code, /^DG-/);
  // Giá trị xuất thật = Σ biến động xuất; giá trị nhập = Σ biến động nhập; hai bên bằng nhau tuyệt đối
  const outV = getDb().prepare("SELECT SUM(ROUND(-qty*1000)*unit_cost/1000.0) v FROM stock_movements WHERE ref_type='conversion' AND ref_id=? AND type='transfer_out'").get(c.id).v;
  const inV = movs(c.id, 'transfer_in', hop.id).reduce((a, m) => a + lineAmount(m.qty, m.unit_cost), 0);
  assert.equal(c.source_value, Math.round(outV));
  assert.equal(c.output_value, c.source_value);
  assert.equal(inV, c.source_value);
  const kgPart = lineAmount(20, Math.round((kgValueBefore + 0) / 20)); // xấp xỉ, kiểm bên dưới bằng khoảng
  assert.ok(Math.abs(c.sources[0].amount - kgValueBefore) <= 20, `kg ${c.sources[0].amount} vs ${kgValueBefore} ${kgPart}`);
  const total = c.source_value;
  const per = total / 39;
  const ins = movs(c.id, 'transfer_in', hop.id);
  assert.ok(ins.length <= 2);
  for (const m of ins) assert.ok(Number.isInteger(m.unit_cost) && Math.abs(m.unit_cost - per) < 1);
  assert.equal(level(hop).on_hand, 39);
  assert.equal(level(kg).on_hand, 0);
  assert.equal(level(box).on_hand, 61);
  // Bao bì vào giá vốn hộp, không ghi chi phí; sổ kế toán không đổi (156 chỉ chuyển mã, không 711/811/6414)
  const after = bal();
  assert.deepEqual(after, before);
  // Lô: FEFO rút cả hai lô; hộp nhận hạn sớm nhất và số lô gộp
  const out = c.outputs[0];
  assert.equal(out.expiry_date, w.d(60));
  assert.equal(out.lot_no, 'L-A, L-B');
  assert.equal(ok(await api.get(`/stock-lots?variant_id=${hop.id}`))[0].qty, 39);
  assert.deepEqual(ok(await api.get(`/stock-lots?variant_id=${kg.id}`)), []);
  // Định mức: 39 hộp × 0,5 kg = 19,5 kg, thực tế 20 kg
  const ksrc = c.sources.find((s) => s.variant_id === kg.id);
  assert.equal(ksrc.norm_qty, 19.5); assert.equal(ksrc.norm_diff, 0.5);
  assert.equal(c.sources.find((s) => s.variant_id === box.id).norm_qty, 39);
  // Bán 10 hộp: giá vốn đơn đúng giá vốn hộp
  const o = ok(await api.post('/orders', { shop_id: w.nh.id, channel_id: 'direct', status: 'completed', lines: [{ variant_id: hop.id, qty: 10, unit_price: 150000 }] }));
  assert.equal(o.cogs_amount, lineAmount(10, level(hop).avg_cost === undefined ? 0 : (getDb().prepare("SELECT unit_cost FROM order_line_allocations WHERE order_line_id = ?").get(o.lines[0].id).unit_cost)));
  assert.ok(Math.abs(o.cogs_amount - Math.round((total * 10) / 39)) <= 10);
  await checkClean();
  // Chi tiết, danh sách, chứng từ, sổ kho
  assert.equal(ok(await api.get(`/conversions/${c.id}`)).outputs.length, 1);
  assert.equal(ok(await api.get('/conversions')).length ?? 1, 1);
  const docs = (await api.get('/documents?type=conversion')).body;
  assert.equal(docs.total, 1); assert.equal(docs.data[0].amount, total);
  assert.ok(getDb().prepare("SELECT 1 FROM audit_log WHERE action = 'inventory.conversion.created'").get());
  assert.ok(getDb().prepare("SELECT 1 FROM events WHERE type = 'conversion.created'").get());
});

test('phần lẻ khi chia: một thành phẩm nhận hai mức giá nguyên, Σ giá trị vào = Σ giá trị ra', async () => {
  const w = await world();
  const { api, wh, kg, hop } = w;
  await w.buyRaw(10, 100001, 'L1', w.d(30)); // 1.000.010 tổng: không chia hết cho 7
  const c = ok(await api.post('/conversions', { warehouse_id: wh.id, sources: [{ variant_id: kg.id, qty: 10 }], outputs: [{ variant_id: hop.id, qty: 7 }] }));
  assert.equal(c.source_value, 1000010);
  const ins = movs(c.id, 'transfer_in', hop.id);
  assert.equal(ins.length, 2);
  assert.deepEqual(ins.map((m) => [m.qty, m.unit_cost]), [[3, 142858], [4, 142859]]); // 3×142.858 + 4×142.859 = 1.000.010
  assert.equal(ins.reduce((a, m) => a + lineAmount(m.qty, m.unit_cost), 0), 1000010);
  assert.equal(c.outputs[0].unit_cost, 142859); // đơn giá trung bình hiển thị = round(1.000.010 / 7)
  await checkClean();
});

test('hộp 500 g và túi 1 kg từ cùng nguồn: chia giá vốn theo hệ số, tổng đúng từng đồng', async () => {
  const w = await world();
  const { api, wh, kg, hop, tui } = w;
  await w.buyRaw(15, 200000, 'L1', w.d(30));
  const c = ok(await api.post('/conversions', { warehouse_id: wh.id, sources: [{ variant_id: kg.id, qty: 15 }], outputs: [{ variant_id: hop.id, qty: 20 }, { variant_id: tui.id, qty: 5 }] }));
  assert.equal(c.source_value, 3000000);
  const [a, b] = [c.outputs.find((o) => o.variant_id === hop.id), c.outputs.find((o) => o.variant_id === tui.id)];
  assert.equal(a.amount + b.amount, 3000000);
  assert.equal(a.amount, 2000000); assert.equal(b.amount, 1000000); // 10 kg và 5 kg
  assert.equal(a.unit_cost, 100000); assert.equal(b.unit_cost, 200000);
  // trọng số do người dùng nhập ghi đè mặc định
  await w.buyRaw(10, 100000, 'L2', w.d(30));
  const c2 = ok(await api.post('/conversions', { warehouse_id: wh.id, sources: [{ variant_id: kg.id, qty: 10 }], outputs: [{ variant_id: hop.id, qty: 10, weight: 1 }, { variant_id: tui.id, qty: 3, weight: 3 }] }));
  assert.equal(c2.outputs.find((o) => o.variant_id === hop.id).amount, 250000);
  assert.equal(c2.outputs.find((o) => o.variant_id === tui.id).amount, 750000);
  await checkClean();
});

test('thiếu nguồn bị chặn, không ghi gì; dịch vụ, combo, trùng nguồn/thành phẩm bị từ chối; số lượng thành phẩm phải nguyên', async () => {
  const w = await world();
  const { api, wh, kg, hop, box } = w;
  await w.buyRaw(5, 100000, 'L1', w.d(30));
  const r = await api.post('/conversions', { warehouse_id: wh.id, sources: [{ variant_id: kg.id, qty: 6 }], outputs: [{ variant_id: hop.id, qty: 12 }] });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'STOCK_NOT_ENOUGH');
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM stock_conversions').get().n, 0);
  assert.equal(level(kg).on_hand, 5);
  assert.equal(getDb().prepare("SELECT COUNT(*) n FROM stock_movements WHERE ref_type = 'conversion'").get().n, 0);
  const frac = await api.post('/conversions', { warehouse_id: wh.id, sources: [{ variant_id: kg.id, qty: 1 }], outputs: [{ variant_id: hop.id, qty: 1.5 }] });
  assert.equal(frac.body.error.code, 'OUTPUT_QTY_INTEGER');
  const same = await api.post('/conversions', { warehouse_id: wh.id, sources: [{ variant_id: hop.id, qty: 1 }], outputs: [{ variant_id: hop.id, qty: 1 }] });
  assert.equal(same.status, 400);
  const svc = ok(await api.post('/products', { name: 'Gói quà', item_type: 'service', variants: [{ sku: 'GOI-QUA', default_price: 10000 }] })).variants[0];
  const s = await api.post('/conversions', { warehouse_id: wh.id, sources: [{ variant_id: kg.id, qty: 1 }], outputs: [{ variant_id: svc.id, qty: 1 }] });
  assert.equal(s.status, 400); assert.equal(s.body.error.code, 'SERVICE_NO_STOCK');
  const out = await api.post('/conversions', { warehouse_id: wh.id, sources: [{ variant_id: kg.id, qty: 1 }], outputs: [{ variant_id: box.id, qty: 1 }] });
  assert.equal(out.body.error.code, 'OUTPUT_NOT_PRODUCT');
  await checkClean();
});

test('chọn lô nguồn: lấy đúng lô đã chọn (không theo FEFO), lô không đủ bị chặn', async () => {
  const w = await world();
  const { api, wh, kg, hop } = w;
  await twoLots(w);
  const lots = ok(await api.get(`/stock-lots?variant_id=${kg.id}`));
  const lb = lots.find((l) => l.lot_no === 'L-B');
  const bad = await api.post('/conversions', { warehouse_id: wh.id, sources: [{ variant_id: kg.id, qty: 9, lot_id: lb.id }], outputs: [{ variant_id: hop.id, qty: 18 }] });
  assert.equal(bad.status, 409); assert.equal(bad.body.error.code, 'LOT_NOT_ENOUGH');
  const c = ok(await api.post('/conversions', { warehouse_id: wh.id, sources: [{ variant_id: kg.id, qty: 4, lot_id: lb.id }], outputs: [{ variant_id: hop.id, qty: 8 }] }));
  assert.equal(c.outputs[0].lot_no, 'L-B'); assert.equal(c.outputs[0].expiry_date, w.d(120));
  const left = ok(await api.get(`/stock-lots?variant_id=${kg.id}`));
  assert.equal(left.find((l) => l.lot_no === 'L-B').qty, 4);
  assert.equal(left.find((l) => l.lot_no === 'L-A').qty, 12);
  // hạn/lô tự nhập đè mặc định
  const c2 = ok(await api.post('/conversions', { warehouse_id: wh.id, sources: [{ variant_id: kg.id, qty: 2 }], outputs: [{ variant_id: hop.id, qty: 4, lot_no: 'TAY', expiry_date: w.d(10) }] }));
  assert.equal(c2.outputs[0].lot_no, 'TAY'); assert.equal(c2.outputs[0].expiry_date, w.d(10));
  await checkClean();
});

test('huỷ phiếu: nguồn về đúng giá, đúng lô; thành phẩm bị rút; sổ sạch', async () => {
  const w = await world();
  const { api, wh, kg, box, hop } = w;
  await twoLots(w);
  const kgBefore = level(kg);
  const lotsBefore = ok(await api.get(`/stock-lots?variant_id=${kg.id}`)).map((l) => [l.lot_no, l.qty, l.expiry_date]).sort();
  const before = bal();
  const c = ok(await api.post('/conversions', { warehouse_id: wh.id, sources: [{ variant_id: kg.id, qty: 20 }, { variant_id: box.id, qty: 40 }], outputs: [{ variant_id: hop.id, qty: 40 }] }));
  assert.equal((await api.post(`/conversions/${c.id}/void`, {})).status, 400); // cần lý do
  const v = ok(await api.post(`/conversions/${c.id}/void`, { reason: 'Đóng nhầm' }));
  assert.ok(v.voided_at);
  assert.equal(level(kg).on_hand, 20); assert.equal(level(kg).avg_cost, kgBefore.avg_cost);
  assert.equal(level(box).on_hand, 100); assert.equal(level(hop).on_hand, 0);
  assert.deepEqual(ok(await api.get(`/stock-lots?variant_id=${kg.id}`)).map((l) => [l.lot_no, l.qty, l.expiry_date]).sort(), lotsBefore);
  assert.deepEqual(ok(await api.get(`/stock-lots?variant_id=${hop.id}`)), []);
  assert.deepEqual(bal(), before);
  assert.equal((await api.post(`/conversions/${c.id}/void`, { reason: 'Lần hai' })).body.error.code, 'ALREADY_VOIDED');
  await checkClean();
});

test('huỷ bị chặn khi thành phẩm đã bán', async () => {
  const w = await world();
  const { api, wh, kg, hop } = w;
  await w.buyRaw(10, 100000, 'L1', w.d(30));
  const c = ok(await api.post('/conversions', { warehouse_id: wh.id, sources: [{ variant_id: kg.id, qty: 10 }], outputs: [{ variant_id: hop.id, qty: 20 }] }));
  ok(await api.post('/orders', { shop_id: w.nh.id, channel_id: 'direct', status: 'completed', lines: [{ variant_id: hop.id, qty: 1, unit_price: 150000 }] }));
  const r = await api.post(`/conversions/${c.id}/void`, { reason: 'Thử' });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'CONVERSION_OUTPUT_USED');
  assert.equal(level(hop).on_hand, 19); assert.equal(level(kg).on_hand, 0);
  await checkClean();
});

test('FIFO: nguồn lấy theo lớp cũ nhất, thành phẩm tạo lớp mới; bán hộp, huỷ phiếu trả lại đúng lớp', async () => {
  const w = await world({ fifo: true });
  const { api, wh, kg, box, hop } = w;
  await w.buyRaw(12, 200000, 'L-A', w.d(60));
  await w.buyRaw(8, 230000, 'L-B', w.d(120));
  // Gộp các lớp cùng đơn giá (phần trả lại tạo lớp riêng cùng giá, cùng tuổi lớp)
  const layersKg = () => Object.entries(getDb().prepare('SELECT qty, unit_cost FROM stock_layers WHERE variant_id = ?').all(kg.id).reduce((a, l) => ({ ...a, [l.unit_cost]: (a[l.unit_cost] ?? 0) + l.qty }), {}));
  const before = layersKg();
  const c = ok(await api.post('/conversions', { warehouse_id: wh.id, sources: [{ variant_id: kg.id, qty: 15 }, { variant_id: box.id, qty: 30 }], outputs: [{ variant_id: hop.id, qty: 30 }] }));
  // 12 kg × 200.000 + 3 kg × 230.000 + 30 hộp × 2.000
  assert.equal(c.source_value, 12 * 200000 + 3 * 230000 + 30 * 2000);
  assert.equal(c.sources[0].slices.length, 2);
  const layers = getDb().prepare("SELECT qty, unit_cost, ref_type FROM stock_layers WHERE variant_id = ?").all(hop.id);
  assert.equal(layers.reduce((a, l) => a + l.qty, 0), 30);
  assert.ok(layers.every((l) => l.ref_type === 'conversion'));
  assert.equal(layers.reduce((a, l) => a + lineAmount(l.qty, l.unit_cost), 0), c.source_value);
  const o = ok(await api.post('/orders', { shop_id: w.nh.id, channel_id: 'direct', status: 'completed', lines: [{ variant_id: hop.id, qty: 10, unit_price: 150000 }] }));
  assert.ok(Math.abs(o.cogs_amount - Math.round((c.source_value * 10) / 30)) <= 10);
  await checkClean('sau bán');
  // huỷ bị chặn vì đã bán
  assert.equal((await api.post(`/conversions/${c.id}/void`, { reason: 'x' })).status, 409);
  ok(await api.post(`/orders/${o.id}/status`, { status: 'cancelled' }));
  ok(await api.post(`/conversions/${c.id}/void`, { reason: 'Đóng nhầm' }));
  assert.deepEqual(layersKg(), before);
  assert.equal(getDb().prepare('SELECT COALESCE(SUM(qty),0) n FROM stock_layers WHERE variant_id = ?').get(hop.id).n, 0);
  await checkClean('sau huỷ');
});

test('chốt kho và khoá sổ: phiếu ghi vào hôm nay nên chạy ở kỳ mở; kỳ bị chặn thì từ chối và không ghi gì', async () => {
  const w = await world();
  const { api, wh, kg, hop } = w;
  await w.buyRaw(10, 100000, 'L1', w.d(30));
  ok(await api.post('/stock-close', { date: addDays(today(), -1) }));
  const c = ok(await api.post('/conversions', { warehouse_id: wh.id, sources: [{ variant_id: kg.id, qty: 4 }], outputs: [{ variant_id: hop.id, qty: 8 }] }));
  assert.equal(c.business_date, today());
  assert.equal(ok(await api.get('/stock-close')).changed, false);
  // kỳ kho chốt tới hôm nay (đặt thẳng cài đặt): biến động hôm nay bị chặn
  writeSetting('stock_lock_date', today());
  const r = await api.post('/conversions', { warehouse_id: wh.id, sources: [{ variant_id: kg.id, qty: 1 }], outputs: [{ variant_id: hop.id, qty: 2 }] });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'STOCK_PERIOD_CLOSED');
  assert.equal((await api.post(`/conversions/${c.id}/void`, { reason: 'x' })).body.error.code, 'STOCK_PERIOD_CLOSED');
  writeSetting('stock_lock_date', null);
  writeSetting('accounting_lock_date', today());
  const r2 = await api.post('/conversions', { warehouse_id: wh.id, sources: [{ variant_id: kg.id, qty: 1 }], outputs: [{ variant_id: hop.id, qty: 2 }] });
  assert.equal(r2.status, 409); assert.equal(r2.body.error.code, 'PERIOD_LOCKED');
  writeSetting('accounting_lock_date', null);
  assert.equal(level(kg).on_hand, 6);
  await checkClean();
});

test('công thức đóng từ: gợi ý đủ nguồn + bao bì, báo thiếu tồn; xoá công thức', async () => {
  const w = await world();
  const { api, wh, hop, kg } = w;
  await w.buyRaw(5, 100000, 'L1', w.d(30));
  const sg = ok(await api.post('/conversions/suggest', { warehouse_id: wh.id, outputs: [{ variant_id: hop.id, qty: 40 }] }));
  const k = sg.sources.find((s) => s.variant_id === kg.id);
  assert.equal(k.qty, 20); assert.equal(k.on_hand, 5); assert.equal(k.enough, false); assert.equal(k.kind, 'recipe');
  const pv = ok(await api.post('/conversions/preview', { warehouse_id: wh.id, sources: [{ variant_id: kg.id, qty: 5 }], outputs: [{ variant_id: hop.id, qty: 10 }] }));
  assert.equal(pv.source_value, 500000); assert.equal(pv.outputs[0].unit_cost, 50000);
  assert.equal(ok(await api.get(`/conversion-recipes?product_id=${w.hopP.id}`)).length, 1);
  ok(await api.delete(`/conversion-recipes/${hop.id}`));
  assert.equal(ok(await api.get(`/conversion-recipes?product_id=${w.hopP.id}`)).length, 0);
});
