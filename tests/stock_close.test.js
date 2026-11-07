import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { addDays, businessDate } from '../server/lib/time.js';

const ok = (r, s = [200, 201]) => { assert.ok([].concat(s).includes(r.status), JSON.stringify(r.body)); return r.body.data; };
const day = (n) => addDays(businessDate(), -n);
const at = (n) => `${day(n)}T04:00:00.000Z`;

async function world() {
  const ctx = await setup();
  const v = ok(await ctx.api.post('/products', { name: 'A', variants: [{ sku: 'A1', default_price: 100000 }], shop_ids: [ctx.nh.id] })).variants[0];
  const sup = ok(await ctx.api.post('/suppliers', { name: 'NCC' }));
  const pur = ok(await ctx.api.post('/purchases', { supplier_id: sup.id, warehouse_id: ctx.wh.id, receive: true, lines: [{ variant_id: v.id, qty: 10, unit_cost: 40000 }] }));
  return { ...ctx, v, pur };
}
const stockOf = async (api, v) => ok(await api.get('/stock')).find((x) => x.variant_id === v.id).on_hand;

test('chốt kho: xem trước, chụp tồn, chặn ghi lùi ngày, mở lại', async () => {
  const { api, wh, v, nh } = await world();
  // không chốt ngày hôm nay hoặc tương lai
  assert.equal((await api.post('/stock-close', { date: day(0) })).status, 409);
  const pv = ok(await api.get(`/stock-close/preview?date=${day(1)}`));
  assert.equal(pv.can_close, true);
  // phiếu nhập được ghi ngày hôm nay nên chưa có tồn ở hôm qua
  assert.equal(pv.total_qty, 0);
  assert.equal((await api.post('/stock-close', { date: day(1) })).status, 201);
  assert.equal(ok(await api.get('/stock-close')).lock_date, day(1));
  // ghi biến động ngày ≤ ngày chốt (điều chỉnh có ngày không có → dùng đơn lùi ngày để kiểm kẹp ngày bên dưới)
  // chốt lần hai không lùi được
  assert.equal((await api.post('/stock-close', { date: day(3) })).status, 409);
  // Đơn import đặt trong kỳ đã chốt vẫn vào được, trừ kho ghi vào ngày đầu kỳ mở (số kỳ đã chốt không đổi)
  const imp = await api.post('/imports/orders/commit', { shop_id: nh.id, channel_id: 'shopee', orders: [{ external_id: 'SP-OLD', status: 'completed', ordered_at: at(5), lines: [{ sku: 'A1', qty: 2 }] }] });
  assert.equal(imp.status, 200, JSON.stringify(imp.body));
  assert.equal(await stockOf(api, v), 8);
  const { getDb } = await import('../server/db/index.js');
  const mv = getDb().prepare("SELECT business_date, note FROM stock_movements WHERE type = 'sale_out'").get();
  assert.equal(mv.business_date, addDays(day(1), 1));
  assert.match(mv.note || '', /kỳ kho đã chốt/);
  // snapshot không đổi: không có thay đổi sau chốt
  assert.equal(ok(await api.get('/stock-close')).changed, false);
  // mở lại cần lý do
  assert.equal((await api.post('/stock-close/reopen', { date: null, reason: '' })).status, 400);
  const st = ok(await api.post('/stock-close/reopen', { date: null, reason: 'Nhập sót' }));
  assert.equal(st.lock_date, null);
  const list = ok(await api.get('/stock-closes'));
  assert.equal(list.length, 1); assert.ok(list[0].reopened_at);
});

test('biến động không phải đơn vào kỳ đã chốt bị chặn; kỳ mở vẫn chạy bình thường', async () => {
  const { api, wh, v } = await world();
  ok(await api.post('/stock-close', { date: day(1) }), 201);
  // hôm nay vẫn nhập, điều chỉnh, chuyển kho bình thường
  ok(await api.post('/stock-adjustments', { warehouse_id: wh.id, kind: 'adjust', reason: 'Đếm lại', lines: [{ variant_id: v.id, change: -1 }] }));
  assert.equal(await stockOf(api, v), 9);
});

test('ảnh chụp tồn đúng số và phát hiện thay đổi sau chốt', async () => {
  const { api, wh, v, nh } = await world();
  // đơn ngày 3 ngày trước (lúc chưa chốt): bán 3
  assert.equal((await api.post('/imports/orders/commit', { shop_id: nh.id, channel_id: 'shopee', orders: [{ external_id: 'SP-3', status: 'completed', ordered_at: at(3), lines: [{ sku: 'A1', qty: 3 }] }] })).status, 200);
  const pv = ok(await api.get(`/stock-close/preview?date=${day(1)}`));
  // phiếu nhập ghi hôm nay, đơn ghi ngày đặt: tồn đến hôm qua = −3 (âm kho) và có cảnh báo
  assert.equal(pv.total_qty, -3);
  assert.ok(pv.warnings.some((w) => w.code === 'NEGATIVE_STOCK'));
  const c = ok(await api.post('/stock-close', { date: day(1), note: 'Thử' }));
  assert.equal(c.lines.length, 1); assert.equal(c.lines[0].qty, -3);
  assert.equal(c.total_value, c.lines[0].value);
  assert.equal(ok(await api.get('/stock-close')).changed, false);
  // sửa thẳng sổ kho (ngoài đường API) để mô phỏng thay đổi trái phép
  const { getDb } = await import('../server/db/index.js');
  getDb().prepare("UPDATE stock_movements SET qty = qty - 1 WHERE ref_type = 'order'").run();
  const st = ok(await api.get('/stock-close'));
  assert.equal(st.changed, true); assert.equal(st.changes[0].now_qty, -4);
});

test('kiểm kê đang mở chặn chốt kho', async () => {
  const { api, wh } = await world();
  ok(await api.post('/stock-counts', { warehouse_id: wh.id }));
  const r = await api.post('/stock-close', { date: day(1) });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'CLOSE_BLOCKED');
});
