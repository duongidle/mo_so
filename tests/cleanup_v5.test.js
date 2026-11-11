import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { getDb } from '../server/db/index.js';
import { addDays, businessDate } from '../server/lib/time.js';
import { verifyJournal } from '../server/modules/accounting/journal.js';
import { verifyStock } from '../server/modules/inventory/verify.js';

/** Dọn các điểm còn dở: nhãn/liên kết sổ kế toán, sửa đơn với lô hết hạn, import chạm lô hết hạn, trả hàng nhập hai dòng cùng biến thể, trạng thái thanh toán đơn huỷ */
const ok = (r, s = [200, 201]) => { assert.ok([].concat(s).includes(r.status), JSON.stringify(r.body)); return r.body.data; };
const today = () => businessDate();

async function world() {
  const ctx = await setup();
  const { api, nh, wh } = ctx;
  const v = ok(await api.post('/products', { name: 'Hạt', unit: 'kg', variants: [{ sku: 'HAT', default_price: 100000 }], shop_ids: [nh.id] })).variants[0];
  const sup = ok(await api.post('/suppliers', { name: 'NCC' }));
  const buy = async (lines, extra = {}) => ok(await api.post('/purchases', { supplier_id: sup.id, warehouse_id: wh.id, receive: true, lines: lines.map((l) => ({ variant_id: v.id, unit_cost: 40000, ...l })), ...extra }));
  return { ...ctx, v, sup, buy };
}

test('3a: bút toán trả hàng nhập và NCC giảm giá có nguồn mở được chứng từ gốc (phiếu nhập)', async () => {
  const { api, buy } = await world();
  const pu = await buy([{ qty: 10 }]);
  ok(await api.post(`/purchases/${pu.id}/returns`, { lines: [{ purchase_line_id: pu.lines[0].id, qty: 2 }] }));
  ok(await api.post(`/purchases/${pu.id}/allowances`, { amount: 10000 }));
  const j = (await api.get('/accounting/journal?source_type=purchase_return')).body.data;
  assert.equal(j.length, 1);
  assert.equal(j[0].source_path, `/purchases/${pu.id}`);
  const j2 = (await api.get('/accounting/journal?source_type=purchase_allowance')).body.data;
  assert.equal(j2.length, 1);
  assert.equal(j2[0].source_path, `/purchases/${pu.id}`);
  // Phiếu đóng gói không có bút toán nên không có nguồn riêng; mọi nguồn đang có đều có đường dẫn
  const all = (await api.get('/accounting/journal?limit=200')).body.data;
  for (const e of all) if (['order', 'return', 'purchase_return', 'purchase_allowance', 'expense'].includes(e.source_type)) assert.ok(e.source_path, e.source_type);
});

test('3b: sửa đơn đã xác nhận chạm lô hết hạn → LOT_EXPIRED, gửi allow_expired thì sửa được', async () => {
  const { api, nh, v, buy } = await world();
  await buy([{ qty: 5, lot_no: 'CU', expiry_date: addDays(today(), -2) }]);
  const o = ok(await api.post('/orders', { shop_id: nh.id, channel_id: 'direct', lines: [{ variant_id: v.id, qty: 1, unit_price: 100000 }] }));
  // đơn nháp chưa trừ kho nên xác nhận bị chặn trước
  assert.equal((await api.post(`/orders/${o.id}/status`, { status: 'confirmed' })).body.error.code, 'LOT_EXPIRED');
  ok(await api.post(`/orders/${o.id}/status`, { status: 'confirmed', allow_expired: true }));
  const body = { shop_id: nh.id, channel_id: 'direct', lines: [{ variant_id: v.id, qty: 2, unit_price: 100000 }] };
  const r = await api.patch(`/orders/${o.id}`, body);
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'LOT_EXPIRED');
  assert.equal(ok(await api.get(`/orders/${o.id}`)).lines[0].qty, 1); // không đổi gì
  ok(await api.patch(`/orders/${o.id}`, { ...body, allow_expired: true }));
  assert.equal(ok(await api.get(`/orders/${o.id}`)).lines[0].qty, 2);
  assert.deepEqual(verifyStock(), []);
});

test('3c: import đơn sàn chạm lô hết hạn không bị chặn, chỉ gắn cờ cảnh báo', async () => {
  const { api, nh, buy } = await world();
  await buy([{ qty: 5, lot_no: 'CU', expiry_date: addDays(today(), -2) }]);
  const r = await api.post('/imports/orders/commit', { shop_id: nh.id, channel_id: 'shopee', orders: [{ external_id: 'SP-EXP-1', status: 'completed', ordered_at: new Date().toISOString(), lines: [{ sku: 'HAT', qty: 2 }] }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const o = getDb().prepare("SELECT status, expired_lot_warning FROM orders WHERE external_id = 'SP-EXP-1'").get();
  assert.equal(o.status, 'completed');
  assert.equal(o.expired_lot_warning, 1);
  assert.equal(getDb().prepare('SELECT SUM(on_hand) n FROM stock_levels').get().n, 3);
  // Đơn tạo tay cùng lô thì vẫn bị chặn: chỉ đơn import (đã xảy ra trên sàn) được miễn
  const manual = ok(await api.post('/orders', { shop_id: nh.id, channel_id: 'direct', lines: [{ sku: 'HAT', qty: 1, unit_price: 100000 }] }));
  assert.equal((await api.post(`/orders/${manual.id}/status`, { status: 'confirmed' })).body.error.code, 'LOT_EXPIRED');
  assert.deepEqual(verifyStock(), []);
});

test('3d: phiếu trả hàng nhập có hai dòng cùng một biến thể: mỗi dòng tính riêng, tổng đúng, không trả vượt', async () => {
  const { api, buy, v } = await world();
  const pu = await buy([{ qty: 10, unit_cost: 40000 }, { qty: 6, unit_cost: 50000 }]);
  assert.equal(pu.lines.length, 2);
  assert.ok(pu.lines.every((l) => l.variant_id === v.id));
  const r = ok(await api.post(`/purchases/${pu.id}/returns`, { lines: [{ purchase_line_id: pu.lines[0].id, qty: 3 }, { purchase_line_id: pu.lines[1].id, qty: 2 }] }));
  assert.equal(r.goods_amount, 3 * 40000 + 2 * 50000);
  assert.equal(r.lines.length, 2);
  assert.equal(getDb().prepare('SELECT on_hand FROM stock_levels WHERE variant_id = ?').get(v.id).on_hand, 16 - 5);
  const after = ok(await api.get(`/purchases/${pu.id}`));
  assert.deepEqual(after.lines.map((l) => l.returnable_qty), [7, 4]);
  // cùng một dòng phiếu nhập xuất hiện hai lần trong một phiếu trả: cộng dồn rồi kiểm vượt
  const dup = await api.post(`/purchases/${pu.id}/returns`, { lines: [{ purchase_line_id: pu.lines[1].id, qty: 3 }, { purchase_line_id: pu.lines[1].id, qty: 2 }] });
  assert.equal(dup.status, 400); assert.equal(dup.body.error.code, 'RETURN_QTY_TOO_BIG');
  assert.equal(getDb().prepare('SELECT on_hand FROM stock_levels WHERE variant_id = ?').get(v.id).on_hand, 11);
  assert.deepEqual(verifyStock(), []); assert.deepEqual(verifyJournal(), []);
});

test('3e: đơn huỷ còn tiền: trạng thái "paid" nhưng danh sách trả đủ số để hiện "Còn phải hoàn khách" / "Giữ cọc"; hoàn hết thì "refunded"', async () => {
  const { api, nh, v, buy } = await world();
  await buy([{ qty: 20 }]);
  const mk = async () => ok(await api.post('/orders', { shop_id: nh.id, channel_id: 'direct', lines: [{ variant_id: v.id, qty: 1, unit_price: 100000 }], payments: [{ amount: 100000, method: 'cash' }] }));
  const row = async (id) => (await api.get('/orders?limit=50')).body.data.find((o) => o.id === id);
  const a = await mk();
  ok(await api.post(`/orders/${a.id}/status`, { status: 'cancelled', paid_action: 'refund' }));
  let r = await row(a.id);
  assert.equal(r.payment_status, 'paid');
  assert.equal(r.refund_owed_amount, 100000); assert.equal(r.forfeited_amount, 0);
  // hoàn đủ → refunded
  ok(await api.post(`/orders/${a.id}/payments`, { amount: 100000, method: 'cash', direction: 'out' }));
  r = await row(a.id);
  assert.equal(r.payment_status, 'refunded'); assert.equal(r.refund_owed_amount, 0);
  const b = await mk();
  ok(await api.post(`/orders/${b.id}/status`, { status: 'cancelled', paid_action: 'forfeit', forfeit_amount: 100000 }));
  r = await row(b.id);
  assert.equal(r.refund_owed_amount, 0); assert.equal(r.forfeited_amount, 100000); assert.equal(r.payment_status, 'paid');
  const c = await mk();
  ok(await api.post(`/orders/${c.id}/status`, { status: 'cancelled', paid_action: 'forfeit', forfeit_amount: 30000, refund: { method: 'cash' } }));
  r = await row(c.id);
  assert.equal(r.payment_status, 'paid'); // 30.000 giữ lại, 70.000 đã hoàn ngay
  assert.equal(r.forfeited_amount, 30000);
});
