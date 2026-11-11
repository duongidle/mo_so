import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

const ok = (r, s = [200, 201]) => { assert.ok([].concat(s).includes(r.status), JSON.stringify(r.body)); return r.body.data; };

async function world() {
  const ctx = await setup();
  const v = ok(await ctx.api.post('/products', { name: 'A', variants: [{ sku: 'A1', default_price: 200000 }], shop_ids: [ctx.nh.id] })).variants[0];
  const sup = ok(await ctx.api.post('/suppliers', { name: 'NCC' }));
  ok(await ctx.api.post('/purchases', { supplier_id: sup.id, warehouse_id: ctx.wh.id, receive: true, lines: [{ variant_id: v.id, qty: 20, unit_cost: 100000 }] }));
  const order = async (extra = {}, status = 'completed', qty = 3) => ok(await ctx.api.post('/orders', { shop_id: ctx.nh.id, channel_id: 'direct', status, shipping_fee: 30000, lines: [{ variant_id: v.id, qty, unit_price: 200000 }], ...extra }));
  const onHand = async () => ok(await ctx.api.get('/stock')).find((x) => x.variant_id === v.id).on_hand;
  return { ...ctx, v, order, onHand };
}

test('đơn đang giao không huỷ được; đơn xác nhận vẫn huỷ được', async () => {
  const { api, order, onHand } = await world();
  const o = await order({}, 'shipping');
  const r = await api.post(`/orders/${o.id}/status`, { status: 'cancelled' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'CANCEL_SHIPPING');
  assert.equal(await onHand(), 17);
  const o2 = await order({}, 'confirmed');
  ok(await api.post(`/orders/${o2.id}/status`, { status: 'cancelled' }));
});

test('giao không thành: phiếu trả chờ hàng về, kho chưa cộng, nhận hàng mới nhập kho', async () => {
  const { api, order, onHand } = await world();
  const o = await order({}, 'shipping');
  assert.equal(await onHand(), 17);
  const lines = o.lines.map((l) => ({ order_line_id: l.id, qty: l.qty, restock: true }));
  const res = ok(await api.post(`/orders/${o.id}/returns`, { lines, reason_code: 'customer_refused', reason: 'Khách không nghe máy', shipping_refund_amount: 30000, awaiting_goods: true }));
  assert.equal(res.status, 'returned');
  assert.equal(res.returns[0].awaiting_goods, true);
  assert.equal(res.returns[0].reason_code, 'customer_refused');
  assert.equal(await onHand(), 17); // hàng chưa về
  const done = ok(await api.post(`/orders/${o.id}/returns/${res.returns[0].id}/receive`, {}));
  assert.equal(done.returns[0].awaiting_goods, false);
  assert.equal(await onHand(), 20);
  assert.equal(done.cogs_amount, 0);
});

test('giao không thành, hàng về hỏng: lập phiếu hàng huỷ, không nhập kho, giá vốn giữ lại', async () => {
  const { api, order, onHand } = await world();
  const o = await order({}, 'shipping');
  const res = ok(await api.post(`/orders/${o.id}/returns`, { lines: o.lines.map((l) => ({ order_line_id: l.id, qty: l.qty, restock: true })), reason_code: 'damaged_in_transit', awaiting_goods: true }));
  const done = ok(await api.post(`/orders/${o.id}/returns/${res.returns[0].id}/receive`, { damaged_line_ids: o.lines.map((l) => l.id) }));
  assert.equal(await onHand(), 17);
  assert.equal(done.write_offs.length, 1);
  assert.equal(done.write_offs[0].total_cost, 300000);
  assert.match(done.write_offs[0].code, /^HH-/);
  assert.equal(done.cogs_amount, 300000); // hàng hỏng: giá vốn không hoàn, là khoản lỗ trong lãi gộp
});

test('trả hàng bỏ nhập kho tự lập phiếu hàng huỷ; lý do sai mã bị từ chối', async () => {
  const { api, order, onHand } = await world();
  const o = await order();
  const mk = (extra) => api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: o.lines[0].id, qty: 1, restock: false }], ...extra });
  assert.equal((await mk({ reason_code: 'khong_co' })).status, 400);
  const res = ok(await mk({ reason_code: 'defective' }));
  assert.equal(res.write_offs.length, 1);
  assert.equal(res.write_offs[0].total_cost, 100000);
  assert.equal(await onHand(), 17);
  const rep = ok(await api.get('/reports/return-reasons?from=2000-01-01&to=2100-01-01'));
  assert.equal(rep.rows.find((r) => r.reason_code === 'defective').returns_count, 1);
  assert.equal(rep.write_offs.count, 1);
  const { verifyJournal } = await import('../server/modules/accounting/journal.js');
  assert.deepEqual(verifyJournal().filter((x) => x), []);
});

test('ship shop chịu: nhập ở đơn ngoài sàn, ghi trả hãng vận chuyển nhiều đợt, không trả quá', async () => {
  const { api, order } = await world();
  const o = await order({ seller_shipping_amount: 30000 });
  assert.equal(o.seller_shipping_amount, 30000);
  let d = ok(await api.get(`/orders/${o.id}`));
  assert.equal(d.seller_shipping_due, 30000);
  assert.equal((await api.post(`/orders/${o.id}/seller-shipping-payments`, { amount: 40000 })).status, 400);
  d = ok(await api.post(`/orders/${o.id}/seller-shipping-payments`, { amount: 10000, method: 'cash' }));
  assert.equal(d.seller_shipping_due, 20000);
  d = ok(await api.post(`/orders/${o.id}/seller-shipping-payments`, { amount: 20000, method: 'bank' }));
  assert.equal(d.seller_shipping_due, 0);
  assert.equal(d.seller_shipping_paid_amount, 30000);
  assert.equal(d.paid_amount, 0); // không lẫn vào tiền khách trả
  const { verifyJournal } = await import('../server/modules/accounting/journal.js');
  assert.deepEqual(verifyJournal().filter((x) => x), []);
  const r = await api.post(`/orders/${o.id}/status`, { status: 'cancelled' });
  assert.equal(r.status, 409);
});

test('danh sách chứng từ gộp, lọc theo loại và mã', async () => {
  const { api, order, wh } = await world();
  const o = await order();
  ok(await api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: o.lines[0].id, qty: 1, restock: false }] }));
  const all = await api.get('/documents?limit=100');
  const types = new Set(all.body.data.map((d) => d.type));
  for (const t of ['order', 'purchase', 'return', 'write_off']) assert.ok(types.has(t), t);
  assert.equal(all.body.total, all.body.data.length);
  const only = ok(await api.get('/documents?type=return'));
  assert.ok(only.every((d) => d.type === 'return'));
  const byCode = ok(await api.get(`/documents?q=${encodeURIComponent(o.code)}`));
  assert.ok(byCode.some((d) => d.id === o.id));
  void wh;
});

test('danh sách lý do trả hàng ở giao diện khớp với máy chủ', async () => {
  const { readFileSync } = await import('node:fs');
  const { RETURN_REASONS } = await import('../server/lib/returnReasons.js');
  const web = readFileSync(new URL('../web/src/lib/returnReasons.js', import.meta.url), 'utf8');
  for (const r of RETURN_REASONS) {
    assert.ok(web.includes(`['${r.code}', '${r.label}']`), r.code);
  }
});

test('danh sách chứng từ lọc theo shop lấy cả phiếu kho của các kho trong shop', async () => {
  const { api, nh, wh, v } = await world();
  const wh2 = ok(await api.post('/warehouses', { name: 'Kho phụ', code: 'KP' }));
  ok(await api.post('/transfers', { from_warehouse_id: wh.id, to_warehouse_id: wh2.id, lines: [{ variant_id: v.id, qty: 1 }] }));
  const mine = ok(await api.get(`/documents?shop_id=${nh.id}&type=transfer`));
  assert.equal(mine.length, 1);
  const other = ok(await api.get('/documents?shop_id=shp_khong_co&type=transfer'));
  assert.equal(other.length, 0);
});

test('sửa đơn đã xác nhận: đổi sản phẩm/số lượng thì kho trừ lại đúng, giữ khoản đã thu', async () => {
  const { api, order, onHand, v } = await world();
  const o = await order({ payments: [{ amount: 100000, method: 'cash' }] }, 'confirmed', 3);
  assert.equal(await onHand(), 17);
  const r = ok(await api.patch(`/orders/${o.id}`, { lines: [{ variant_id: v.id, qty: 5, unit_price: 200000 }] }));
  assert.equal(await onHand(), 15);
  assert.equal(r.lines[0].qty, 5);
  assert.equal(r.cogs_amount, 500000);
  assert.equal(r.paid_amount, 100000);
  assert.equal(r.total_amount, 1000000 + 30000);
  const { verifyStock } = await import('../server/modules/inventory/verify.js');
  assert.deepEqual(verifyStock(), []);
  // đơn đã giao đi thì không sửa sản phẩm
  ok(await api.post(`/orders/${o.id}/status`, { status: 'shipping' }));
  assert.equal((await api.patch(`/orders/${o.id}`, { lines: [{ variant_id: v.id, qty: 1, unit_price: 200000 }] })).status, 409);
  // quá tồn: lỗi và không đổi gì
  const o2 = await order({}, 'confirmed', 1);
  assert.equal((await api.patch(`/orders/${o2.id}`, { lines: [{ variant_id: v.id, qty: 99, unit_price: 200000 }] })).status, 409);
  assert.equal((ok(await api.get(`/orders/${o2.id}`))).lines[0].qty, 1);
  assert.equal(await onHand(), 14);
});

test('tách đơn giao từng phần: phần còn lại thành đơn nháp mới, tiền và giảm giá chia khớp', async () => {
  const { api, order, onHand } = await world();
  const o = await order({ discount_amount: 10000 }, 'confirmed', 4);
  const res = ok(await api.post(`/orders/${o.id}/split`, { lines: [{ order_line_id: o.lines[0].id, qty: 1 }] }));
  assert.equal(res.parent.lines[0].qty, 3);
  assert.equal(res.child.lines[0].qty, 1);
  assert.equal(res.child.status, 'draft');
  assert.equal(res.parent.discount_amount + res.child.discount_amount, 10000);
  assert.equal(res.parent.goods_revenue + res.child.goods_revenue, 4 * 200000 - 10000);
  assert.equal(res.child.shipping_fee, 0);
  assert.match(res.child.note, /Tách từ/);
  assert.equal(await onHand(), 17); // chỉ 3 cái của đơn gốc đã trừ kho
  assert.equal((await api.post(`/orders/${o.id}/split`, { lines: [{ order_line_id: res.parent.lines[0].id, qty: 3 }] })).status, 400);
});

test('giữ hàng cho đơn nháp: đơn khác không bán phần đang giữ; hết hạn hoặc bỏ giữ thì bán được', async () => {
  const { api, order, v } = await world();
  const d = await order({}, 'draft', 18);
  ok(await api.post(`/orders/${d.id}/reserve`, { reserve: true, until: '2999-01-01' }));
  const st = ok(await api.get('/stock')).find((x) => x.variant_id === v.id);
  assert.equal(st.reserved_qty, 18);
  const other = await order({}, 'draft', 5);
  const r = await api.post(`/orders/${other.id}/status`, { status: 'confirmed' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'STOCK_RESERVED');
  ok(await api.post(`/orders/${d.id}/reserve`, { reserve: false }));
  ok(await api.post(`/orders/${other.id}/status`, { status: 'confirmed' }));
});

test('thời hạn trả hàng và tra cứu bảo hành', async () => {
  const { api, order, v } = await world();
  ok(await api.patch('/settings', { return_window_days: 7 }));
  const o = await order({}, 'completed', 1);
  const { getDb } = await import('../server/db/index.js');
  getDb().prepare("UPDATE orders SET completed_at = ? WHERE id = ?").run(new Date(Date.now() - 10 * 86400000).toISOString(), o.id);
  const body = { lines: [{ order_line_id: o.lines[0].id, qty: 1, restock: true }] };
  const late = await api.post(`/orders/${o.id}/returns`, body);
  assert.equal(late.status, 409);
  assert.equal(late.body.error.code, 'RETURN_WINDOW_EXPIRED');
  ok(await api.post(`/orders/${o.id}/returns`, { ...body, allow_late: true }));
  // bảo hành
  const pid = getDb().prepare('SELECT product_id FROM variants WHERE id = ?').get(v.id).product_id;
  ok(await api.patch(`/products/${pid}`, { warranty_days: 30 }));
  const o2 = await order({ customer: { name: 'Lan', phone: '0912345678' } }, 'completed', 2);
  const w = ok(await api.get('/orders/warranty?q=0912345678'));
  assert.equal(w.length, 1);
  assert.equal(w[0].order_code, o2.code);
  assert.equal(w[0].in_warranty, true);
  assert.ok(w[0].days_left >= 29 && w[0].days_left <= 30);
});

test('vận chuyển: giao đơn cho hãng, đối soát COD trừ phí, hãng báo hoàn lập phiếu trả', async () => {
  const { api, order, onHand } = await world();
  const car = ok(await api.post('/carriers', { name: 'GHN', tracking_url: 'https://ghn.vn/{code}' }));
  // đơn 1: COD 3×200k + ship 30k = 630k, ship shop tự trả hãng 25k
  const o1 = await order({ seller_shipping_amount: 25000 }, 'confirmed', 3);
  const s1 = ok(await api.post(`/orders/${o1.id}/ship`, { carrier_id: car.id, tracking_code: 'ghn001' }));
  assert.equal(s1.order.status, 'shipping');
  assert.equal(s1.shipment.cod_amount, 630000);
  assert.equal(s1.shipment.tracking_link, 'https://ghn.vn/GHN001');
  assert.equal((await api.post(`/orders/${o1.id}/ship`, { carrier_id: car.id, tracking_code: 'GHN001' })).status, 409);
  // đơn 2: sẽ bị hoàn
  const o2 = await order({}, 'confirmed', 2);
  ok(await api.post(`/orders/${o2.id}/ship`, { carrier_id: car.id, tracking_code: 'GHN002' }));
  assert.equal(await onHand(), 15);
  const sum = ok(await api.get('/shipments/summary'));
  assert.equal(sum.in_transit.n, 2);
  const rows = [
    { tracking_code: 'GHN001', outcome: 'delivered', cod_amount: 630000, ship_fee: 25000, cod_fee: 6000 },
    { tracking_code: 'GHN002', outcome: 'returned', ship_fee: 20000, return_fee: 15000 },
    { tracking_code: 'GHN999', outcome: 'delivered', cod_amount: 1 },
  ];
  const pv = ok(await api.post('/carrier-statements/preview', { carrier_id: car.id, rows }));
  assert.equal(pv.summary.applied, 2);
  assert.equal(pv.summary.problems, 1);
  assert.equal(pv.lines[2].result, 'not_found');
  const st = ok(await api.post('/carrier-statements', { carrier_id: car.id, rows }));
  assert.equal(st.total_cod, 630000);
  assert.equal(st.total_fees, 25000 + 6000 + 20000 + 15000);
  assert.equal(st.net_amount, 630000 - 66000);
  const d1 = ok(await api.get(`/orders/${o1.id}`));
  assert.equal(d1.status, 'completed');
  assert.equal(d1.paid_amount, 630000);
  assert.equal(d1.seller_shipping_due, 0); // phí giao 25k của hãng bù khoản ship shop chịu
  const d2 = ok(await api.get(`/orders/${o2.id}`));
  assert.equal(d2.status, 'returned');
  assert.equal(d2.returns[0].awaiting_goods, true);
  assert.equal(await onHand(), 15); // hàng hoàn chưa về
  assert.equal(ok(await api.get('/shipments?bucket=done')).length, 2);
  // đối soát lại cùng mã: bị bỏ qua
  const again = ok(await api.post('/carrier-statements/preview', { carrier_id: car.id, rows: rows.slice(0, 1) }));
  assert.equal(again.lines[0].result, 'already_reconciled');
  // chi phí 41k (6k COD + 20k + 15k) vào chi phí vận chuyển, sổ kế toán vẫn cân
  const exp = ok(await api.get('/expenses'));
  assert.ok(exp.some((e) => e.amount === 41000 && e.method === 'carrier_payout'));
  const { verifyJournal } = await import('../server/modules/accounting/journal.js');
  assert.deepEqual(verifyJournal().filter((x) => x), []);
});

test('huỷ cả phiếu đối soát hãng: hoàn tác COD, phí, phiếu trả chờ hàng, trạng thái đơn và vận đơn; đối soát lại được', async () => {
  const { api, order, onHand } = await world();
  const car = ok(await api.post('/carriers', { name: 'GHN' }));
  const o1 = await order({ seller_shipping_amount: 25000 }, 'confirmed', 3);
  ok(await api.post(`/orders/${o1.id}/ship`, { carrier_id: car.id, tracking_code: 'V001' }));
  const o2 = await order({}, 'confirmed', 2);
  ok(await api.post(`/orders/${o2.id}/ship`, { carrier_id: car.id, tracking_code: 'V002' }));
  const rows = [
    { tracking_code: 'V001', outcome: 'delivered', cod_amount: 630000, ship_fee: 25000, cod_fee: 6000 },
    { tracking_code: 'V002', outcome: 'returned', ship_fee: 20000, return_fee: 15000 },
  ];
  const st = ok(await api.post('/carrier-statements', { carrier_id: car.id, rows }));
  const stock = await onHand();
  const pv = ok(await api.get(`/carrier-statements/${st.id}/void-preview`));
  assert.equal(pv.can_void, true);
  assert.equal(pv.undo.payments, 2); // thu COD + phí giao bù ship shop chịu
  assert.equal(pv.undo.expenses, 1);
  assert.equal(pv.undo.returns, 1);
  assert.equal(pv.undo.orders_reopened, 1);
  assert.equal(pv.undo.shipments, 2);
  // lý do bắt buộc
  assert.equal((await api.post(`/carrier-statements/${st.id}/void`, {})).status, 400);
  const v = ok(await api.post(`/carrier-statements/${st.id}/void`, { reason: 'Hãng gửi nhầm bảng' }));
  assert.ok(v.voided_at);
  const d1 = ok(await api.get(`/orders/${o1.id}`));
  assert.equal(d1.status, 'shipping');
  assert.equal(d1.paid_amount, 0);
  assert.equal(d1.seller_shipping_due, 25000);
  const d2 = ok(await api.get(`/orders/${o2.id}`));
  assert.equal(d2.status, 'shipping');
  assert.equal(d2.returns.length, 0);
  assert.equal(d2.returned_amount, 0);
  assert.equal(d2.lines[0].returned_qty, 0);
  assert.equal(await onHand(), stock);
  const exp = ok(await api.get('/expenses'));
  assert.equal(exp.filter((e) => e.method === 'carrier_payout').length, 0); // chi phí đã huỷ nên không còn trong danh sách mặc định
  const ships = ok(await api.get('/shipments?bucket=in_transit'));
  assert.equal(ships.length, 2);
  assert.equal(ok(await api.get('/shipments?bucket=done')).length, 0);
  // huỷ lần hai bị từ chối; huỷ lẻ khoản do đối soát tạo ra cũng chỉ dẫn về huỷ cả phiếu
  assert.equal((await api.post(`/carrier-statements/${st.id}/void`, { reason: 'lần hai' })).status, 409);
  // đối soát lại bảng đúng: được, và sổ kế toán vẫn cân
  const again = ok(await api.post('/carrier-statements', { carrier_id: car.id, rows }));
  assert.equal(again.total_cod, 630000);
  assert.equal(ok(await api.get(`/orders/${o1.id}`)).status, 'completed');
  const { verifyJournal } = await import('../server/modules/accounting/journal.js');
  assert.deepEqual(verifyJournal().filter((x) => x), []);
});

test('huỷ phiếu đối soát hãng bị chặn khi đảo ngược sẽ làm sai số liệu', async () => {
  const { api, order } = await world();
  const car = ok(await api.post('/carriers', { name: 'GHN' }));
  const o = await order({}, 'confirmed', 2);
  ok(await api.post(`/orders/${o.id}/ship`, { carrier_id: car.id, tracking_code: 'B001' }));
  const st = ok(await api.post('/carrier-statements', { carrier_id: car.id, rows: [{ tracking_code: 'B001', outcome: 'delivered', cod_amount: 430000 }] }));
  // đơn đã có phiếu trả sau đối soát → không đưa đơn về đang giao được
  ok(await api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: o.lines[0].id, qty: 1, restock: true }] }));
  const pv = ok(await api.get(`/carrier-statements/${st.id}/void-preview`));
  assert.equal(pv.can_void, false);
  assert.ok(pv.blockers.some((b) => b.code === 'HAS_RETURNS'));
  const r = await api.post(`/carrier-statements/${st.id}/void`, { reason: 'thử huỷ' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'STATEMENT_VOID_BLOCKED');
  // không đổi gì
  assert.equal(ok(await api.get(`/orders/${o.id}`)).status, 'completed');
  assert.equal(ok(await api.get(`/carrier-statements/${st.id}`)).voided_at, null);
  // khoản COD không huỷ lẻ được, lời nhắn chỉ về huỷ cả phiếu
  const pay = ok(await api.get('/payments?ref_type=order')).find((p) => p.method === 'carrier_payout');
  const one = await api.post(`/payments/${pay.id}/void`, {});
  assert.equal(one.status, 409);
  assert.match(one.body.error.message, /phiếu đối soát/);
});

test('huỷ phiếu đối soát hãng: kỳ đã khoá sổ thì chặn; phiếu lập trước khi có bản ghi tác động không huỷ tự động', async () => {
  const { api, order } = await world();
  const car = ok(await api.post('/carriers', { name: 'GHN' }));
  const o = await order({}, 'confirmed', 1);
  ok(await api.post(`/orders/${o.id}/ship`, { carrier_id: car.id, tracking_code: 'L001' }));
  const day = '2020-01-15';
  const st = ok(await api.post('/carrier-statements', { carrier_id: car.id, date: day, rows: [{ tracking_code: 'L001', outcome: 'delivered', cod_amount: 230000, cod_fee: 3000 }] }));
  ok(await api.post('/accounting/lock', { date: '2020-01-31' }));
  const pv = ok(await api.get(`/carrier-statements/${st.id}/void-preview`));
  assert.equal(pv.can_void, false);
  assert.ok(pv.blockers.some((b) => b.code === 'PERIOD_LOCKED'));
  assert.equal((await api.post(`/carrier-statements/${st.id}/void`, { reason: 'thử huỷ' })).status, 409);
  assert.equal(ok(await api.get(`/orders/${o.id}`)).status, 'completed');
  // phiếu cũ (không có bản ghi tác động)
  const { getDb } = await import('../server/db/index.js');
  getDb().prepare('UPDATE carrier_statements SET effects_tracked = 0 WHERE id = ?').run(st.id);
  const legacy = await api.post(`/carrier-statements/${st.id}/void`, { reason: 'phiếu cũ' });
  assert.equal(legacy.status, 409);
  assert.equal(legacy.body.error.code, 'STATEMENT_LEGACY');
});

test('đối soát sàn: trả lệch thì cộng phần lệch vào phí sàn của đơn, đơn hết treo, lãi đúng', async () => {
  const { api, nh, v } = await world();
  const imp = await api.post('/imports/orders/commit', { shop_id: nh.id, channel_id: 'shopee', orders: [{ external_id: 'SP-1', status: 'completed', ordered_at: new Date(Date.now() - 12 * 86400000).toISOString(), platform_fee_amount: 20000, lines: [{ sku: 'A1', qty: 1, unit_price: 200000 }] }] });
  assert.equal(imp.status, 200, JSON.stringify(imp.body));
  const { getDb } = await import('../server/db/index.js');
  getDb().prepare("UPDATE orders SET completed_at = ? WHERE external_id = 'SP-1'").run(new Date(Date.now() - 12 * 86400000).toISOString());
  const pend = (await api.get('/reconciliation/pending?channel_id=shopee')).body;
  assert.equal(pend.count, 1);
  assert.equal(pend.data[0].pending_amount, 180000);
  assert.equal(pend.overdue_count, 1); // quá 10 ngày chưa nhận tiền
  const res = ok(await api.post('/reconciliation/payouts', { channel_id: 'shopee', settle_difference: true, items: [{ external_id: 'SP-1', amount: 165000 }] }));
  assert.equal(res.results[0].fee_delta, 15000);
  assert.equal(res.results[0].still_pending, 0);
  assert.equal((await api.get('/reconciliation/pending?channel_id=shopee')).body.count, 0);
  const order = ok(await api.get(`/orders?q=SP-1`))[0];
  const d = ok(await api.get(`/orders/${order.id}`));
  assert.equal(d.platform_fee_amount, 35000);
  assert.equal(d.net_amount, 165000);
  const adj = (await api.get('/reconciliation/adjustments')).body;
  assert.equal(adj.total_fee_delta, 15000);
  void v;
});

test('giá theo kênh: đơn kênh có giá riêng lấy giá đó, kênh khác lấy giá niêm yết; tìm sản phẩm theo kênh', async () => {
  const { api, nh, v } = await world();
  ok(await api.put('/channel-prices', [{ shop_id: nh.id, channel_id: 'shopee', variant_id: v.id, price: 230000 }]));
  const o1 = ok(await api.post('/orders', { shop_id: nh.id, channel_id: 'shopee', lines: [{ variant_id: v.id, qty: 1 }] }));
  assert.equal(o1.lines[0].unit_price, 230000);
  const o2 = ok(await api.post('/orders', { shop_id: nh.id, channel_id: 'direct', lines: [{ variant_id: v.id, qty: 1 }] }));
  assert.equal(o2.lines[0].unit_price, 200000);
  const s = ok(await api.get(`/variants?shop_id=${nh.id}&channel_id=shopee&q=A1`));
  assert.equal(s[0].price, 230000);
  assert.equal(s[0].price_source, 'channel');
  assert.equal(ok(await api.get(`/variants?shop_id=${nh.id}&q=A1`))[0].price, 200000);
  ok(await api.put('/channel-prices', [{ shop_id: nh.id, channel_id: 'shopee', variant_id: v.id, price: null }]));
  assert.equal(ok(await api.get(`/channel-prices?variant_id=${v.id}`)).length, 0);
});

test('khuyến mãi: mua X tặng Y, mã voucher, giới hạn lượt dùng, không cộng dồn thì chọn cái tốt nhất', async () => {
  const { api, nh, v } = await world();
  const buy3 = ok(await api.post('/loyalty/promotions', { name: 'Mua 2 tặng 1', kind: 'buy_x_get_y', buy_qty: 2, free_qty: 1, variant_ids: [v.id] }));
  const pct = ok(await api.post('/loyalty/promotions', { name: 'Giảm 10%', kind: 'order_percent', value: 10 }));
  const vc = ok(await api.post('/loyalty/promotions', { name: 'Voucher 50k', kind: 'order_amount', value: 50000, code: 'giam50', min_subtotal: 500000, usage_limit: 1 }));
  assert.equal(vc.code, 'GIAM50');
  const cart = (qty, code) => ({ shop_id: nh.id, channel_id: 'direct', code, lines: [{ variant_id: v.id, qty, unit_price: 200000 }] });
  // 3 cái: mua 2 tặng 1 giảm 200k, giảm 10% = 60k → chọn mua 2 tặng 1 (không cộng dồn)
  let ev = ok(await api.post('/loyalty/promotions/evaluate', cart(3)));
  assert.equal(ev.applied.length, 1);
  assert.equal(ev.applied[0].id, buy3.id);
  assert.equal(ev.total_discount, 200000);
  assert.equal(ev.line_discounts[0], 200000);
  // 1 cái: chỉ còn giảm 10%
  ev = ok(await api.post('/loyalty/promotions/evaluate', cart(1)));
  assert.equal(ev.applied[0].id, pct.id);
  assert.equal(ev.order_discount, 20000);
  // Voucher: chưa đủ tối thiểu → báo lý do
  ev = ok(await api.post('/loyalty/promotions/evaluate', cart(2, 'GIAM50')));
  assert.equal(ev.code_status.ok, false);
  // 4 cái + mã: voucher 50k không cộng dồn, nên vẫn chọn khuyến mãi giảm nhiều nhất
  const o = ok(await api.post('/orders', { shop_id: nh.id, channel_id: 'direct', auto_promotions: true, lines: [{ variant_id: v.id, qty: 4, unit_price: 200000 }] }));
  assert.equal(o.discount_amount + o.line_discount_amount, 200000);
  assert.equal(o.goods_revenue, 600000);
  const stats = ok(await api.get('/loyalty/promotions')).find((p) => p.id === buy3.id);
  assert.equal(stats.uses, 1);
  assert.equal(stats.discount_given, 200000);
  // mã sai bị từ chối khi tạo đơn
  const bad = await api.post('/orders', { shop_id: nh.id, channel_id: 'direct', promotion_code: 'KHONGCO', lines: [{ variant_id: v.id, qty: 1, unit_price: 200000 }] });
  assert.equal(bad.status, 400);
  // voucher dùng 1 lần: đơn đầu dùng hết lượt
  await api.put(`/loyalty/promotions/${buy3.id}`, { name: 'Mua 2 tặng 1', kind: 'buy_x_get_y', buy_qty: 2, free_qty: 1, variant_ids: [v.id], active: false });
  await api.put(`/loyalty/promotions/${pct.id}`, { name: 'Giảm 10%', kind: 'order_percent', value: 10, active: false });
  const o2 = ok(await api.post('/orders', { shop_id: nh.id, channel_id: 'direct', promotion_code: 'GIAM50', lines: [{ variant_id: v.id, qty: 3, unit_price: 200000 }] }));
  assert.equal(o2.discount_amount, 50000);
  const again = ok(await api.post('/loyalty/promotions/evaluate', cart(3, 'GIAM50')));
  assert.equal(again.code_status.ok, false);
  assert.match(again.code_status.reason, /hết lượt/);
});

test('lô và hạn dùng: nhập có hạn, xuất lấy lô hết hạn sớm trước, chuyển kho mang lô theo, cảnh báo sắp hết hạn', async () => {
  const { api, nh, wh, v, order } = await world();
  const sup = ok(await api.post('/suppliers', { name: 'NCC2' }));
  const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const mk = (qty, lot, exp) => api.post('/purchases', { supplier_id: sup.id, warehouse_id: wh.id, receive: true, lines: [{ variant_id: v.id, qty, unit_cost: 100000, lot_no: lot, expiry_date: exp }] });
  ok(await mk(5, 'L-LATE', inDays(200)));
  ok(await mk(5, 'L-SOON', inDays(10)));
  ok(await mk(5, 'L-GONE', inDays(-3)));
  const lots = ok(await api.get('/stock-lots'));
  assert.deepEqual(lots.map((l) => l.lot_no), ['L-GONE', 'L-SOON', 'L-LATE']);
  assert.deepEqual(lots.map((l) => l.status), ['expired', 'expiring', 'ok']);
  const sum = ok(await api.get('/stock-lots/summary'));
  assert.equal(sum.expired.qty, 5);
  assert.equal(sum.expiring.lots, 1);
  // bán 7 cái: lấy hết lô quá hạn (5) rồi 2 từ lô sắp hết. Chạm lô quá hạn thì bị chặn, phải xác nhận vượt (allow_expired)
  await order({ allow_expired: true }, 'completed', 7);
  const after = ok(await api.get('/stock-lots'));
  assert.deepEqual(after.map((l) => [l.lot_no, l.qty]), [['L-SOON', 3], ['L-LATE', 5]]);
  // chuyển 4 sang kho khác: 3 từ L-SOON + 1 từ L-LATE đi theo
  const wh2 = ok(await api.post('/warehouses', { name: 'Kho B', code: 'KB' }));
  ok(await api.post('/transfers', { from_warehouse_id: wh.id, to_warehouse_id: wh2.id, lines: [{ variant_id: v.id, qty: 4 }] }));
  const at2 = ok(await api.get(`/stock-lots?warehouse_id=${wh2.id}`));
  assert.deepEqual(at2.map((l) => [l.lot_no, l.qty]), [['L-SOON', 3], ['L-LATE', 1]]);
  assert.equal(ok(await api.get(`/stock-lots?within_days=30`)).length, 1);
  const { verifyStock } = await import('../server/modules/inventory/verify.js');
  assert.deepEqual(verifyStock(), []);
  void nh;
});

test('nhập sản phẩm hàng loạt: nhóm biến thể theo tên, tạo danh mục, tồn đầu kỳ, bỏ dòng lỗi', async () => {
  const { api, nh, wh } = await world();
  const rows = [
    { name: 'Nến thơm', sku: 'nen-1', variant_name: 'Lavender', price: '99.000'.replace(/\./g, ''), cost: 40000, qty: 10, category: 'Nến', brand: 'Moso', warranty_days: 30 },
    { name: 'Nến thơm', sku: 'NEN-2', variant_name: 'Cam', price: 99000, cost: 40000, qty: 5 },
    { name: 'Hộp quà', sku: 'HQ-1', price: 0, cost: 5000, qty: 100, item_type: 'Đóng gói', category: 'Nến' },
    { name: 'Lỗi SKU', sku: 'A1', price: 1000 },
    { name: 'Thiếu giá vốn', sku: 'TGV-1', price: 1000, qty: 3 },
    { name: 'Kho lạ', sku: 'KL-1', price: 1000, qty: 3, cost: 100, warehouse: 'Kho không có' },
    { name: '', sku: 'X' },
  ];
  const pv = ok(await api.post('/products/import/preview', { rows, warehouse_id: wh.id, shop_ids: [nh.id] }));
  assert.equal(pv.summary.products, 2);
  assert.equal(pv.summary.variants, 3);
  assert.equal(pv.summary.errors, 4);
  assert.deepEqual(pv.new_categories, ['Nến']);
  assert.ok(pv.errors.some((e) => /đã có trong hệ thống/.test(e.message)));
  const res = ok(await api.post('/products/import', { rows, warehouse_id: wh.id, shop_ids: [nh.id] }));
  assert.equal(res.summary.created, 2);
  assert.equal(res.summary.skipped, 4);
  const stock = ok(await api.get('/stock?q=NEN'));
  assert.equal(stock.length, 2);
  assert.equal(stock.reduce((a, s) => a + s.on_hand, 0), 15);
  const cats = ok(await api.get('/categories'));
  assert.equal(cats.filter((c) => c.name === 'Nến').length, 1); // hai sản phẩm cùng danh mục chỉ tạo một lần
  const nen = ok(await api.get('/products?q=Nến')).find((p) => p.name === 'Nến thơm');
  assert.equal(nen.variants.length, 2);
  assert.equal(nen.warranty_days, 30);
  const hop = ok(await api.get('/products?item_type=packaging&unlisted=1')).find((p) => p.name === 'Hộp quà');
  assert.ok(hop);
  // chạy lại: SKU đã có nên không tạo trùng
  const again = ok(await api.post('/products/import', { rows: rows.slice(0, 2), warehouse_id: wh.id }));
  assert.equal(again.summary.created, 0);
});

test('nhắc nợ: hạn mặc định, quá hạn, sắp đến hạn, đã nhắc thì ẩn; nợ nhà cung cấp theo hạn', async () => {
  const { api, nh, v, order, wh } = await world();
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const mk = (due, tag) => order({ due_date: due, customer: { name: `Khách ${tag}`, phone: `09000000${tag}` }, payments: [{ amount: 50000, method: 'cash' }] }, 'completed', 1);
  const late = await mk(day(-5), '01');
  await mk(day(2), '02'); // sắp đến hạn
  await mk(day(30), '03'); // còn xa: không hiện
  let d = (await api.get('/loyalty/debts')).body;
  assert.equal(d.customers.data.length, 2);
  assert.equal(d.customers.data[0].bucket, 'overdue');
  assert.equal(d.customers.data[0].days_overdue, 5);
  assert.equal(d.customers.data[0].debt, 200000 + 30000 - 50000);
  assert.equal(d.customers.overdue_count, 1);
  // soạn tin có điền mã đơn, số nợ, hạn
  const tpl = ok(await api.get('/loyalty/templates?kind=debt'))[0];
  const msg = ok(await api.post('/loyalty/render', { template_id: tpl.id, customer_id: late.customer_id, order_id: late.id }));
  assert.match(msg.message, new RegExp(late.code));
  assert.match(msg.message, /180\.000/);
  assert.deepEqual(msg.unresolved, []);
  // đã nhắc → ẩn tới ngày hẹn
  ok(await api.post('/loyalty/debts/action', { order_id: late.id, days: 3 }));
  d = (await api.get('/loyalty/debts')).body;
  assert.equal(d.customers.data.length, 1);
  // thu đủ → hết nợ
  const other = d.customers.data[0];
  ok(await api.post(`/orders/${other.id}/payments`, { amount: other.debt, method: 'cash' }));
  assert.equal((await api.get('/loyalty/debts')).body.customers.data.length, 0);
  // hạn mặc định theo cài đặt cho đơn không đặt hạn
  ok(await api.patch('/settings', { payment_terms_days: 7 }));
  const auto = await order({ payments: [] }, 'completed', 1);
  assert.equal(ok(await api.get(`/orders/${auto.id}`)).due_date, day(7));
  // nợ nhà cung cấp
  const sup = ok(await api.post('/suppliers', { name: 'NCC nợ' }));
  const pur = ok(await api.post('/purchases', { supplier_id: sup.id, warehouse_id: wh.id, receive: true, due_date: day(-1), lines: [{ variant_id: v.id, qty: 2, unit_cost: 100000 }] }));
  assert.equal((await api.get('/loyalty/debts')).body.suppliers, undefined, 'nợ nhà cung cấp không nằm ở Loyalty');
  const pay = (await api.get('/payables')).body;
  const sp = pay.data.find((r) => r.kind === 'supplier' && r.code === pur.code);
  assert.equal(sp.bucket, 'overdue');
  assert.equal(sp.amount, 200000);
  assert.equal(pay.overdue.count >= 1, true);
  // trả hết thì biến mất khỏi danh sách
  ok(await api.post(`/purchases/${pur.id}/payments`, { amount: 200000, method: 'cash' }));
  assert.equal((await api.get('/payables')).body.data.some((r) => r.code === pur.code), false);
  void nh;
});

test('nhật ký thay đổi: lọc theo đối tượng/hành động, có tên tiếng Việt, nhãn đối tượng và các trường đổi', async () => {
  const { api, order } = await world();
  const o = await order({ note: 'ghi chú cũ' }, 'confirmed', 1);
  ok(await api.patch(`/orders/${o.id}`, { note: 'ghi chú mới' }));
  const res = (await api.get(`/system/audit?entity_type=order&entity_id=${o.id}`)).body;
  assert.ok(res.data.length >= 2);
  const upd = res.data.find((r) => r.action === 'order.updated');
  assert.equal(upd.action_label, 'Sửa đơn');
  assert.equal(upd.entity_label, o.code);
  assert.equal(upd.actor, 'Chủ shop');
  const ch = upd.changes.find((c) => c.field === 'note');
  assert.deepEqual([ch.from, ch.to], ['ghi chú cũ', 'ghi chú mới']);
  assert.ok(res.facets.actions.some((a) => a.v === 'order.created' && a.label === 'Tạo đơn'));
  const only = (await api.get('/system/audit?action=order.created')).body;
  assert.ok(only.data.every((r) => r.action === 'order.created'));
  const page = (await api.get('/system/audit?limit=1')).body;
  assert.equal(page.data.length, 1);
  assert.ok(page.next_cursor);
});

test('thông báo: cấu hình che token, tạo một lần mỗi ngày, gửi Telegram và sự kiện webhook, đánh dấu đã đọc', async () => {
  const { api, order } = await world();
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  await order({ due_date: day(-3), customer: { name: 'Khách nợ', phone: '0900000111' } }, 'completed', 1);
  // cần đủ token và chat id nếu chọn Telegram
  const bad = await api.put('/notifications/config', { rules: { debts_due: { enabled: true, channels: ['inapp', 'telegram'] } } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'TELEGRAM_INCOMPLETE');
  const cfg = ok(await api.put('/notifications/config', { telegram: { bot_token: '123456:SECRET-TOKEN-ABCD', chat_id: '-1001' }, rules: { debts_due: { enabled: true, channels: ['inapp', 'telegram', 'webhook'] }, daily_summary: { enabled: false } } }));
  assert.equal(cfg.telegram.has_token, true);
  assert.equal(cfg.telegram.token_hint, '…ABCD');
  assert.ok(!JSON.stringify(cfg).includes('SECRET-TOKEN'));
  assert.ok(!JSON.stringify(ok(await api.get('/notifications/config'))).includes('SECRET-TOKEN'));
  assert.ok(!JSON.stringify(ok(await api.get('/settings'))).includes('SECRET-TOKEN'));
  const aud = JSON.stringify((await api.get('/system/audit?action=notifications.updated')).body);
  assert.ok(aud.includes('notifications.updated') && !aud.includes('SECRET-TOKEN'));
  // chạy quy tắc với Telegram giả
  const { runNotifications } = await import('../server/modules/notifications/service.js');
  const calls = [];
  const fake = async (url, opt) => { calls.push({ url, body: JSON.parse(opt.body) }); return { ok: true, status: 200 }; };
  const made = await runNotifications({ fetchImpl: fake });
  const debt = made.find((n) => n.kind === 'debts_due');
  assert.ok(debt);
  assert.match(debt.title, /1 khoản khách nợ/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /bot123456:SECRET-TOKEN-ABCD\/sendMessage/);
  assert.equal(calls[0].body.chat_id, '-1001');
  assert.deepEqual(JSON.parse(made.find((n) => n.kind === 'debts_due').deliveries), { telegram: 'sent', webhook: 'queued' });
  const { getDb } = await import('../server/db/index.js');
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'notification.created'").get().n, 1);
  // chạy lại cùng ngày: không tạo trùng, không gửi lại
  assert.equal((await runNotifications({ fetchImpl: fake })).length, 0);
  assert.equal(calls.length, 1);
  // hộp thông báo và đọc
  const list = (await api.get('/notifications')).body;
  assert.equal(list.unread, 1);
  assert.equal(ok(await api.post('/notifications/read', { all: true })).unread, 0);
  // Telegram lỗi: ghi lỗi, không làm hỏng thông báo
  const failing = async () => { throw new Error('net'); };
  getDb().prepare("DELETE FROM notifications").run();
  const again = await runNotifications({ fetchImpl: failing });
  assert.match(JSON.parse(again[0].deliveries).telegram, /^error/);
  // gửi thử trong app
  const t = ok(await api.post('/notifications/test', { channels: ['inapp'] }));
  assert.equal(t.kind, 'test');
});

test('in nhãn giao hàng: mã vạch mã vận đơn, người nhận, thu hộ; in nhiều nhãn', async () => {
  const { api, order } = await world();
  const car = ok(await api.post('/carriers', { name: 'GHN' }));
  const o = await order({ shipping_address: '12 Lê Lợi, Q1', customer: { name: 'Chị Lan', phone: '0912345678' }, note: 'Gọi trước khi giao' }, 'confirmed', 2);
  ok(await api.post(`/orders/${o.id}/ship`, { carrier_id: car.id, tracking_code: 'ghn123' }));
  const res = await api.get(`/orders/${o.id}/label`);
  assert.equal(res.status, 200);
  const html = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
  assert.match(html, /GHN123/);
  assert.match(html, /<svg[^>]*aria-label="Mã vạch GHN123"/);
  assert.match(html, /Chị Lan/);
  assert.match(html, /12 Lê Lợi/);
  assert.match(html, /Thu hộ \(COD\): <b>430\.000/);
  assert.match(html, /Gọi trước khi giao/);
  const o2 = await order({}, 'completed', 1); // chưa có vận đơn: in mã đơn, đã thu nên không COD
  const two = (await api.get(`/orders/labels?ids=${o.id},${o2.id}`)).body;
  assert.equal((String(two).match(/class="label"/g) || []).length, 2);
  assert.equal((await api.get('/orders/labels')).status, 400);
  const { code128Symbols } = await import('../server/lib/code128.js');
  assert.deepEqual(code128Symbols('Hi'), [104, 40, 73, 84, 106]);
});

test('quà tặng kèm khác sản phẩm: đủ điều kiện thì thêm dòng giá 0, trừ kho, vào giá vốn; hết quà thì không tặng', async () => {
  const { api, nh, wh, v, order } = await world();
  const gift = ok(await api.post('/products', { name: 'Móc khoá', variants: [{ sku: 'MK1', default_price: 20000, opening_qty: 3, opening_cost: 5000, opening_warehouse_id: wh.id }], shop_ids: [nh.id] })).variants[0];
  assert.equal((await api.post('/loyalty/promotions', { name: 'Tặng không điều kiện', kind: 'gift', gift_variant_id: gift.id, gift_qty: 1 })).status, 400);
  const promo = ok(await api.post('/loyalty/promotions', { name: 'Đơn từ 400k tặng móc khoá', kind: 'gift', min_subtotal: 400000, gift_variant_id: gift.id, gift_qty: 1 }));
  const cart = (qty) => ({ shop_id: nh.id, channel_id: 'direct', lines: [{ variant_id: v.id, qty, unit_price: 200000 }] });
  let ev = ok(await api.post('/loyalty/promotions/evaluate', cart(1)));
  assert.equal(ev.gifts.length, 0); // chưa đủ 400k
  ev = ok(await api.post('/loyalty/promotions/evaluate', cart(2)));
  assert.equal(ev.gifts.length, 1);
  assert.equal(ev.gifts[0].sku, 'MK1');
  assert.equal(ev.total_discount, 0);
  const o = ok(await api.post('/orders', { ...cart(2), auto_promotions: true, status: 'completed' }));
  assert.equal(o.lines.length, 2);
  const g = o.lines.find((l) => l.is_gift);
  assert.equal(g.sku, 'MK1');
  assert.equal(g.line_total, 0);
  assert.equal(o.total_amount, 400000); // quà không tính tiền
  assert.equal(o.cogs_amount, 2 * 100000 + 5000); // giá vốn quà nằm trong giá vốn đơn
  assert.equal(ok(await api.get('/stock?q=MK1'))[0].on_hand, 2);
  const stats = ok(await api.get('/loyalty/promotions')).find((p) => p.id === promo.id);
  assert.equal(stats.uses, 1);
  assert.equal(stats.discount_given, 20000); // giá trị quà đã tặng
  // sửa đơn nháp giữ cờ quà tặng
  const d = ok(await api.post('/orders', { ...cart(2), auto_promotions: true }));
  const edited = ok(await api.patch(`/orders/${d.id}`, { lines: d.lines.map((l) => ({ variant_id: l.variant_id, qty: l.qty, unit_price: l.unit_price, is_gift: !!l.is_gift })) }));
  assert.equal(edited.lines.filter((l) => l.is_gift).length, 1);
  // hết quà: 1 cái còn lại bị đơn nháp trên trừ khi xác nhận; tặng nốt rồi hết
  ok(await api.post(`/orders/${d.id}/status`, { status: 'confirmed' }));
  ok(await api.post('/orders', { ...cart(2), auto_promotions: true, status: 'confirmed' })); // quà cuối
  ev = ok(await api.post('/loyalty/promotions/evaluate', cart(2)));
  assert.equal(ev.gifts.length, 0);
  assert.ok(ev.rejected.some((r) => /hết hàng/.test(r.reason)));
  void order;
});

test('đơn huỷ đã nhận cọc: hoàn lại được tới số đã thu, không quá', async () => {
  const { api, order } = await world();
  const o = await order({ payments: [{ amount: 100000, method: 'cash' }] }, 'confirmed', 1);
  ok(await api.post(`/orders/${o.id}/status`, { status: 'cancelled', paid_action: 'refund' }));
  assert.equal(ok(await api.get(`/orders/${o.id}`)).paid_amount, 100000);
  assert.equal((await api.post(`/orders/${o.id}/payments`, { direction: 'out', amount: 100001, method: 'cash' })).status, 400);
  ok(await api.post(`/orders/${o.id}/payments`, { direction: 'out', amount: 100000, method: 'cash' }));
  const after = ok(await api.get(`/orders/${o.id}`));
  assert.equal(after.paid_amount, 0);
  assert.equal(after.payment_status, 'refunded');
});

test('huỷ khoản thu ghi nhầm: đơn tính lại số đã thu, khoản đã huỷ không tính, huỷ hai lần bị chặn', async () => {
  const { api, order } = await world();
  const o = await order({ payments: [{ amount: 100000, method: 'cash' }] });
  const o2 = ok(await api.post(`/orders/${o.id}/payments`, { amount: 500000, method: 'bank' })); // ghi nhầm số tiền
  assert.equal(o2.paid_amount, 600000);
  const wrong = o2.payments.find((p) => p.amount === 500000);
  const after = ok(await api.post(`/payments/${wrong.id}/void`, { reason: 'Nhập nhầm' })).data;
  assert.equal(after.paid_amount, 100000);
  assert.equal(after.payment_status, 'partial');
  assert.ok(after.payments.find((p) => p.id === wrong.id).voided_at);
  const again = await api.post(`/payments/${wrong.id}/void`, {});
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'ALREADY_VOIDED');
});

test('huỷ khoản thu khi đã có khoản hoàn dựa trên nó bị chặn; khoản hoàn từ phiếu trả hàng không huỷ riêng được', async () => {
  const { api, order } = await world();
  const o = await order({}, 'completed'); // chưa thu
  const paid = ok(await api.post(`/orders/${o.id}/payments`, { amount: o.total_amount, method: 'cash' }));
  const pay = paid.payments[0];
  const ret = ok(await api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: o.lines[0].id, qty: 1, restock: true }], refund: { amount: 100000, method: 'cash' } }));
  const refund = ret.payments.find((p) => p.direction === 'out');
  const r1 = await api.post(`/payments/${refund.id}/void`, {});
  assert.equal(r1.status, 409);
  assert.equal(r1.body.error.code, 'PAYMENT_FROM_RETURN');
  const manual = ok(await api.post(`/orders/${o.id}/payments`, { amount: 50000, method: 'cash', direction: 'out' }));
  assert.ok(manual.payments.some((p) => p.direction === 'out' && p.amount === 50000));
  // thu 630k, hoàn theo phiếu trả 100k, hoàn tay 50k → huỷ khoản thu 630k làm đã thu âm
  const r2 = await api.post(`/payments/${pay.id}/void`, {});
  assert.equal(r2.status, 409);
  assert.equal(r2.body.error.code, 'PAYMENT_HAS_REFUND');
  const tay = manual.payments.find((p) => p.direction === 'out' && p.amount === 50000);
  const back = ok(await api.post(`/payments/${tay.id}/void`, {})).data; // huỷ khoản hoàn tay: đã thu tăng lại
  assert.equal(back.paid_amount, o.total_amount - 100000);
});

test('huỷ khoản trả nhà cung cấp và trả ship ghi nhầm: số đã trả và công nợ tính lại; phiếu đã huỷ thì không', async () => {
  const { api, v, wh } = await world();
  const sup = ok(await api.post('/suppliers', { name: 'NCC2' }));
  const p = ok(await api.post('/purchases', { supplier_id: sup.id, warehouse_id: wh.id, receive: true, shipping_fee: 40000, shipping_payee: 'carrier', lines: [{ variant_id: v.id, qty: 2, unit_cost: 100000 }] }));
  assert.equal(p.total_amount, 200000);
  const a = ok(await api.post(`/purchases/${p.id}/payments`, { amount: 150000, method: 'bank' }));
  assert.equal(a.paid_amount, 150000);
  const b = ok(await api.post(`/purchases/${p.id}/carrier-payments`, { amount: 40000, method: 'cash' }));
  assert.equal(b.carrier_debt, 0);
  const vp = ok(await api.post(`/payments/${a.payments[0].id}/void`, { reason: 'Sai số' }));
  assert.equal(vp.kind, 'purchase');
  assert.equal(vp.data.paid_amount, 0);
  assert.equal(vp.data.debt, 200000);
  const vc = ok(await api.post(`/payments/${b.carrier_payments[0].id}/void`, {}));
  assert.equal(vc.data.carrier_paid_amount, 0);
  assert.equal(vc.data.carrier_debt, 40000);
  // huỷ phiếu chưa trả: không còn khoản nào để huỷ lẻ
  const c = ok(await api.post(`/purchases/${p.id}/cancel`, {}));
  assert.equal(c.status, 'cancelled');
  assert.equal((await api.post(`/payments/${a.payments[0].id}/void`, {})).status, 409);
});

test('khoản đối soát hãng vận chuyển không huỷ lẻ được; loại lạ bị từ chối', async () => {
  const { api, order } = await world();
  const o = await order({}, 'completed');
  const paid = ok(await api.post(`/orders/${o.id}/payments`, { amount: 100000, method: 'cod' })); // cod vẫn huỷ được
  assert.equal(ok(await api.post(`/payments/${paid.payments[0].id}/void`, {})).data.paid_amount, 0);
  const cp = ok(await api.post(`/orders/${o.id}/payments`, { amount: 10000, method: 'carrier_payout' }));
  const r = await api.post(`/payments/${cp.payments.find((p) => !p.voided_at).id}/void`, {});
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'PAYMENT_NOT_VOIDABLE');
  assert.equal((await api.post('/payments/pay_khong_co/void', {})).status, 404);
});

test('sửa phiếu nhập nháp rồi nhận hàng: dòng, phí và kho theo bản sửa', async () => {
  const { api, v, wh, onHand } = await world();
  const d = ok(await api.post('/purchases', { warehouse_id: wh.id, lines: [{ variant_id: v.id, qty: 5, unit_cost: 100000 }] }));
  assert.equal(d.status, 'draft');
  const e = ok(await api.patch(`/purchases/${d.id}`, { lines: [{ variant_id: v.id, qty: 8, unit_cost: 90000 }], shipping_fee: 8000, due_date: '2027-01-10' }));
  assert.equal(e.lines[0].qty, 8);
  assert.equal(e.total_amount, 8 * 90000 + 8000);
  assert.equal(e.due_date, '2027-01-10');
  const before = await onHand();
  ok(await api.post(`/purchases/${d.id}/receive`));
  assert.equal(await onHand(), before + 8);
  assert.equal((await api.patch(`/purchases/${d.id}`, { note: 'x' })).status, 409); // đã nhận thì không sửa
});

test('tiền sàn trả ghi nhầm: huỷ được, đơn hiện lại tiền treo; đã đối soát lệch thì chặn', async () => {
  const { api, ctx, v } = await world().then((w) => ({ ...w, ctx: w }));
  const mk = async () => ok(await api.post('/orders', { shop_id: ctx.nh.id, channel_id: 'shopee', status: 'completed', external_id: 'SP' + Math.random().toString(36).slice(2, 8), platform_fee_amount: 10000, lines: [{ variant_id: v.id, qty: 1, unit_price: 200000 }] }));
  const o = await mk();
  const rec = ok(await api.post('/reconciliation/payouts', { channel_id: 'shopee', items: [{ order_id: o.id, amount: 190000 }] }));
  assert.equal(rec.recorded, 1);
  let got = ok(await api.get(`/orders/${o.id}`));
  const pay = got.payments.find((p) => p.method === 'shopee_payout');
  assert.equal(got.paid_amount, 190000);
  const after = ok(await api.post(`/payments/${pay.id}/void`, { reason: 'Nhập nhầm' })).data;
  assert.equal(after.paid_amount, 0);
  const o2 = await mk();
  ok(await api.post('/reconciliation/payouts', { channel_id: 'shopee', settle_difference: true, items: [{ order_id: o2.id, amount: 180000 }] }));
  got = ok(await api.get(`/orders/${o2.id}`));
  const r = await api.post(`/payments/${got.payments.find((p) => p.method === 'shopee_payout').id}/void`, {});
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'PAYOUT_HAS_ADJUSTMENT');
});
