import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { getDb } from '../server/db/index.js';
import { verifyStats, rebuildStats, readStats } from '../server/modules/reports/stats.js';
import { addDays, businessDate } from '../server/lib/time.js';

/** Bảng đệm daily_stats luôn khớp bảng đơn sau mọi kiểu thay đổi đơn */
test('daily_stats khớp bảng đơn sau mỗi thao tác: tạo, sửa, đổi ngày, trạng thái, trả hàng, huỷ, import, và cả khi sửa thẳng DB', async () => {
  const { api, nh, pt, wh } = await setup();
  const a = (await api.post('/products', { name: 'A', variants: [{ sku: 'A1', default_price: 100000 }], shop_ids: [nh.id, pt.id] })).body.data.variants[0];
  await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: a.id, qty: 100, unit_cost: 40000 }] });
  const ok = (label) => assert.deepEqual(verifyStats(), [], label);
  const day = (n) => `${addDays(businessDate(), -n)}T04:00:00.000Z`;

  const o1 = (await api.post('/orders', { shop_id: nh.id, lines: [{ sku: 'A1', qty: 3 }], status: 'completed', payments: [{ amount: 300000 }], ordered_at: day(2) })).body.data;
  ok('tạo đơn hoàn thành');
  const draft = (await api.post('/orders', { shop_id: nh.id, lines: [{ sku: 'A1', qty: 1 }] })).body.data;
  ok('đơn nháp không vào thống kê');
  await api.post(`/orders/${draft.id}/status`, { status: 'confirmed' });
  ok('nháp → xác nhận');
  await api.post(`/orders/${draft.id}/status`, { status: 'cancelled' });
  ok('huỷ');
  await api.patch(`/orders/${o1.id}`, { platform_fee_amount: 12345, shipping_fee: 5000 });
  ok('sửa phí');
  await api.patch(`/orders/${o1.id}`, { ordered_at: day(5) });
  ok('đổi ngày đặt (đơn chuyển sang ô ngày khác, ô cũ phải được tính lại)');
  assert.equal(readStats({ from: day(2).slice(0, 10), to: day(2).slice(0, 10) }).order_count, 0, 'ô ngày cũ trống');
  assert.equal(readStats({ from: day(5).slice(0, 10), to: day(5).slice(0, 10) }).order_count, 1);
  await api.post(`/orders/${o1.id}/returns`, { lines: [{ order_line_id: o1.lines[0].id, qty: 1, restock: true }], refund: { amount: 50000 } });
  ok('trả hàng một phần');
  await api.post(`/orders/${o1.id}/returns`, { lines: [{ order_line_id: o1.lines[0].id, qty: 2, restock: false }] });
  ok('trả nốt (đơn thành returned)');
  await api.post('/orders', { shop_id: pt.id, channel_id: 'shopee', external_id: 'SP1', lines: [{ sku: 'A1', qty: 2 }], platform_fee_amount: 9000, status: 'completed' });
  ok('đơn sàn ở shop khác');

  // Import (upsert đổi trạng thái đơn đã có)
  const imp = await api.post('/imports/orders', { shop_id: pt.id, channel_id: 'shopee', orders: [{ external_id: 'SP1', status: 'cancelled', lines: [{ sku: 'A1', qty: 2 }] }, { external_id: 'SP2', status: 'completed', lines: [{ sku: 'A1', qty: 1 }], platform_fee_amount: 3000 }] });
  void imp;
  ok('import');

  // Bất kỳ đường nào khác sửa bảng đơn (kể cả SQL trực tiếp) cũng được trigger bắt
  getDb().prepare("UPDATE orders SET cogs_amount = cogs_amount + 777 WHERE id = ?").run(o1.id);
  ok('sửa thẳng DB');
  getDb().pragma('foreign_keys = OFF'); // chỉ để thử trigger xoá (hệ thống không xoá cứng đơn)
  getDb().prepare('DELETE FROM orders WHERE id = ?').run(o1.id);
  getDb().pragma('foreign_keys = ON');
  ok('xoá đơn');

  // Dựng lại từ đầu cho cùng kết quả
  const before = readStats({ from: '2000-01-01', to: '2100-01-01' }, 'shop_channel');
  rebuildStats();
  assert.deepEqual(readStats({ from: '2000-01-01', to: '2100-01-01' }, 'shop_channel'), before);
  ok('sau khi dựng lại');
});

test('daily_stats: kiểm tra phát hiện được ô bị sửa tay, và dựng lại sửa được', async () => {
  const { api, nh, wh } = await setup();
  const a = (await api.post('/products', { name: 'A', variants: [{ sku: 'A1', default_price: 100000 }], shop_ids: [nh.id] })).body.data.variants[0];
  await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: a.id, qty: 10, unit_cost: 40000 }] });
  await api.post('/orders', { shop_id: nh.id, lines: [{ sku: 'A1', qty: 2 }], status: 'completed', payments: [{ amount: 200000 }] });
  assert.deepEqual(verifyStats(), []);
  getDb().prepare('UPDATE daily_stats SET net_revenue = net_revenue + 1').run();
  const bad = verifyStats();
  assert.equal(bad.length, 1);
  assert.deepEqual(bad[0].columns, ['net_revenue']);
  rebuildStats();
  assert.deepEqual(verifyStats(), []);
  // Báo cáo đọc từ bảng đệm cho đúng số
  assert.equal((await api.get('/reports/overview')).body.data.current.net_revenue, 200000);
});
