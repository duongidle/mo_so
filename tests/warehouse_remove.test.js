import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { getDb } from '../server/db/index.js';
import { verifyStockIntegrity } from '../server/modules/inventory/service.js';

const ok = (r, s = [200, 201]) => { assert.ok([].concat(s).includes(r.status), JSON.stringify(r.body)); return r.body.data; };

async function world() {
  const ctx = await setup();
  const { api, nh, wh } = ctx;
  const k2 = ok(await api.post('/warehouses', { code: 'K2', name: 'Kho B' }));
  ok(await api.put(`/shops/${nh.id}/warehouses`, { warehouse_ids: [wh.id, k2.id] }));
  const v = ok(await api.post('/products', { name: 'A', variants: [{ sku: 'A1', default_price: 100000 }], shop_ids: [nh.id] })).variants[0];
  return { ...ctx, k2, v };
}

test('kho chưa từng dùng: xoá hẳn, gỡ khỏi shop; cần xác nhận', async () => {
  const { api, nh, wh, k2 } = await world();
  const imp = ok(await api.get(`/warehouses/${k2.id}/impact`));
  assert.equal(imp.mode, 'delete'); assert.equal(imp.stock.lines, 0); assert.deepEqual(imp.blockers, []);
  assert.equal((await api.post(`/warehouses/${k2.id}/remove`, {})).body.error.code, 'CONFIRM_REQUIRED');
  const r = ok(await api.post(`/warehouses/${k2.id}/remove`, { confirm: true }));
  assert.equal(r.mode, 'deleted');
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM warehouses WHERE id = ?').get(k2.id).n, 0);
  assert.deepEqual(ok(await api.get(`/shops/${nh.id}/warehouses`)).map((w) => w.warehouse_id), [wh.id]);
  assert.equal(ok(await api.get(`/shops/${nh.id}`)).default_warehouse_id, wh.id);
});

test('kho còn hàng: bắt buộc chuyển sang kho khác, giữ giá vốn, rồi đóng (có lịch sử)', async () => {
  const { api, wh, k2, v } = await world();
  ok(await api.post('/purchases', { warehouse_id: k2.id, receive: true, lines: [{ variant_id: v.id, qty: 10, unit_cost: 40000 }] }));
  const imp = ok(await api.get(`/warehouses/${k2.id}/impact`));
  assert.equal(imp.stock.lines, 1); assert.equal(imp.stock.qty, 10); assert.equal(imp.stock.value, 400000); assert.equal(imp.mode, 'close'); assert.equal(imp.needs_transfer, true);
  const no = await api.post(`/warehouses/${k2.id}/remove`, { confirm: true });
  assert.equal(no.status, 409); assert.equal(no.body.error.code, 'WAREHOUSE_HAS_STOCK');
  assert.equal((await api.post(`/warehouses/${k2.id}/remove`, { confirm: true, transfer_to: k2.id })).status, 400);
  const r = ok(await api.post(`/warehouses/${k2.id}/remove`, { confirm: true, transfer_to: wh.id }));
  assert.equal(r.mode, 'closed'); assert.equal(r.transferred.lines, 1);
  const st = ok(await api.get('/stock')).find((x) => x.variant_id === v.id);
  assert.equal(st.on_hand, 10); assert.equal(st.avg_cost, 40000);
  assert.ok(getDb().prepare('SELECT archived_at FROM warehouses WHERE id = ?').get(k2.id).archived_at);
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM stock_movements WHERE warehouse_id = ?').get(k2.id).n > 0, true, 'lịch sử kho cũ vẫn còn');
  assert.deepEqual(verifyStockIntegrity(), []);
  assert.equal((await api.post(`/warehouses/${k2.id}/remove`, { confirm: true })).body.error.code, 'ALREADY_CLOSED');
});

test('chặn khi còn kiểm kê, phiếu nhập nháp, kho duy nhất của shop, hoặc âm kho', async () => {
  const { api, wh, k2, v, nh } = await world();
  ok(await api.post('/stock-counts', { warehouse_id: k2.id }));
  ok(await api.post('/purchases', { warehouse_id: k2.id, lines: [{ variant_id: v.id, qty: 1, unit_cost: 1000 }] }));
  const r = await api.post(`/warehouses/${k2.id}/remove`, { confirm: true });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'REMOVE_BLOCKED');
  const codes = r.body.error.details.blockers.map((b) => b.code);
  assert.ok(codes.includes('WAREHOUSE_HAS_OPEN_COUNT') && codes.includes('WAREHOUSE_HAS_DRAFT_PURCHASE'));
  // kho duy nhất của shop khác
  const lone = ok(await api.post('/warehouses', { code: 'K3', name: 'Kho C' }));
  const impl = ok(await api.get(`/warehouses/${wh.id}/impact`));
  assert.ok(impl.shops.length >= 1);
  ok(await api.put(`/shops/${nh.id}/warehouses`, { warehouse_ids: [lone.id] }));
  const r2 = await api.post(`/warehouses/${lone.id}/remove`, { confirm: true });
  assert.equal(r2.body.error.details.blockers[0].code, 'WAREHOUSE_LAST');
  // âm kho
  ok(await api.put(`/shops/${nh.id}/warehouses`, { warehouse_ids: [wh.id, lone.id] }));
  getDb().prepare('INSERT INTO stock_levels (warehouse_id, variant_id, on_hand, reserved, avg_cost, updated_at) VALUES (?,?,?,0,0,?)').run(lone.id, v.id, -2, new Date().toISOString());
  const r3 = await api.post(`/warehouses/${lone.id}/remove`, { confirm: true });
  assert.ok(r3.body.error.details.blockers.some((b) => b.code === 'WAREHOUSE_NEGATIVE_STOCK'));
});

test('xoá kế hoạch chia kho của đơn nháp trỏ vào kho bị gỡ', async () => {
  const { api, nh, wh, k2, v } = await world();
  ok(await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: v.id, qty: 5, unit_cost: 1000 }] }));
  const o = ok(await api.post('/orders', { status: 'draft', shop_id: nh.id, lines: [{ sku: 'A1', qty: 2, allocations: [{ warehouse_id: k2.id, qty: 2 }] }] }));
  const imp = ok(await api.get(`/warehouses/${k2.id}/impact`));
  assert.equal(imp.draft_orders_with_plan.length, 1);
  const r = ok(await api.post(`/warehouses/${k2.id}/remove`, { confirm: true }));
  assert.equal(r.cleared_plans, 1);
  assert.equal(getDb().prepare('SELECT planned_allocations p FROM order_lines WHERE order_id = ?').get(o.id).p, null);
});

test('màu giao diện của shop: lưu, đọc, đặt lại; chặn màu thiếu tương phản hoặc nền tối', async () => {
  const { api, nh } = await setup();
  const s = ok(await api.patch(`/shops/${nh.id}`, { ui_colors: { primary: '#7A2E4A', background: '#F8F2F0' } }));
  assert.deepEqual(s.ui_colors, { primary: '#7a2e4a', background: '#f8f2f0' });
  assert.deepEqual(ok(await api.get(`/shops/${nh.id}`)).ui_colors, s.ui_colors);
  // sửa trường khác không làm mất màu
  assert.deepEqual(ok(await api.patch(`/shops/${nh.id}`, { name: 'Tên mới' })).ui_colors, s.ui_colors);
  const low = await api.patch(`/shops/${nh.id}`, { ui_colors: { primary: '#f0c040' } });
  assert.equal(low.status, 400); assert.equal(low.body.error.code, 'COLOR_LOW_CONTRAST');
  const dark = await api.patch(`/shops/${nh.id}`, { ui_colors: { background: '#202020' } });
  assert.equal(dark.body.error.code, 'COLOR_TOO_DARK');
  assert.equal((await api.patch(`/shops/${nh.id}`, { ui_colors: { primary: 'đỏ' } })).status, 400);
  // về mặc định
  assert.equal(ok(await api.patch(`/shops/${nh.id}`, { ui_colors: null })).ui_colors, null);
});
