import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { getDb } from '../server/db/index.js';
import { normalizeStatus } from '../server/modules/imports/service.js';

async function seed(api, nh, wh, stock = 20) {
  const p = (await api.post('/products', { name: 'Hàng', variants: [{ sku: 'SP-A', default_price: 100000 }, { sku: 'SP-B', default_price: 50000 }], shop_ids: [nh.id] })).body.data;
  await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: p.variants.map((v) => ({ variant_id: v.id, qty: stock, unit_cost: 30000 })) });
  return p;
}
const onHand = async (api, sku) => (await api.get(`/stock?q=${sku}`)).body.data[0].on_hand;
const base = (nh) => ({ shop_id: nh.id, channel_id: 'shopee', profile_id: 'imp_shopee', file_name: 'f.xlsx' });

test('normalizeStatus: nguyên văn → không phân biệt hoa thường → tiền tố khai báo; không đoán theo chuỗi con', () => {
  const map = { 'Hoàn thành': 'completed', 'Người mua xác nhận đã nhận được hàng*': 'completed', 'Trả hàng/Hoàn tiền': 'returned' };
  assert.equal(normalizeStatus('Hoàn thành', map), 'completed');
  assert.equal(normalizeStatus('hoàn THÀNH', map), 'completed');
  assert.equal(normalizeStatus('Người mua xác nhận đã nhận được hàng, tuy nhiên Người mua vẫn có thể gửi yêu cầu Trả hàng/Hoàn tiền tới ngày 18-11-2026', map), 'completed');
  assert.equal(normalizeStatus('Người mua xác nhận đã nhận được hàng, tuy nhiên', {}), null, 'không có tiền tố khai báo thì không đoán');
  assert.equal(normalizeStatus('Yêu cầu Trả hàng/Hoàn tiền', map), null, 'không đoán "returned" từ chuỗi con');
  assert.equal(normalizeStatus('Đã giao', {}), 'completed', 'bảng mặc định vẫn khớp nguyên văn');
  assert.equal(normalizeStatus('Người mua xác nhận', {}), null);
  assert.equal(normalizeStatus('', map), 'completed');
  // tên dạng NFD vẫn khớp
  assert.equal(normalizeStatus('Hoàn thành'.normalize('NFD'), map), 'completed');
});

test('Mẫu imp_shopee sau migration 046: phí, giảm giá, trả hàng, trạng thái; không còn ship người mua trả', async () => {
  const { api } = await setup();
  const p = (await api.get('/imports/profiles')).body.data.find((x) => x.id === 'imp_shopee');
  assert.deepEqual([...p.column_map.platform_fee].sort(), ['Phí Dịch Vụ', 'Phí cố định', 'Phí thanh toán', 'Phí xử lý giao dịch']);
  assert.deepEqual([...p.column_map.order_discount].sort(), ['Giảm giá từ Combo của Shop', 'Mã giảm giá của Shop']);
  assert.equal(p.column_map.shipping_fee, undefined);
  assert.equal(p.column_map.return_status, 'Trạng thái Trả hàng/Hoàn tiền');
  assert.equal(p.column_map.returned_qty, 'Số lượng sản phẩm được hoàn trả');
  assert.equal(p.column_map.external_id, 'Mã đơn hàng', 'giữ các khoá cũ');
  assert.equal(p.status_map['Người mua xác nhận đã nhận được hàng*'], 'completed');
  assert.equal(p.status_map['Đã nhận được hàng'], 'completed');
  assert.equal(p.status_map['Hoàn thành'], 'completed');
  assert.deepEqual(p.options.return_approved, ['Đã Chấp Thuận Yêu Cầu']);
  assert.match(p.options.note, /Phí vận chuyển người mua trả/);
});

test('Migration 046 giữ cột người dùng đã thêm vào phí sàn', async () => {
  const { api } = await setup();
  const p = (await api.get('/imports/profiles')).body.data.find((x) => x.id === 'imp_shopee');
  // dựng lại trạng thái trước migration: mẫu cũ + một cột người dùng thêm, rồi chạy lại đúng câu lệnh migration
  const db = getDb();
  db.prepare("UPDATE import_profiles SET column_map = ? WHERE id = 'imp_shopee'").run(JSON.stringify({ ...p.column_map, shipping_fee: 'Phí vận chuyển mà người mua trả'.normalize('NFD'), platform_fee: ['Phí cố định', 'Phí tự thêm'], return_status: undefined }));
  const fs = await import('node:fs');
  db.exec(fs.readFileSync(new URL('../server/db/migrations/046_shopee_import_v2.sql', import.meta.url), 'utf8'));
  const q = (await api.get('/imports/profiles')).body.data.find((x) => x.id === 'imp_shopee');
  assert.ok(q.column_map.platform_fee.includes('Phí tự thêm'));
  assert.ok(q.column_map.platform_fee.includes('Phí xử lý giao dịch'));
  assert.equal(q.column_map.shipping_fee, undefined, 'tên NFD cũng bị bỏ');
  assert.ok(q.column_map.return_status);
});

test('Trả hàng từ file: phiếu trả chờ hàng về, đúng dòng, đúng số lượng, import lại không lập trùng', async () => {
  const { api, nh, wh } = await setup();
  await seed(api, nh, wh);
  const o = { external_id: 'SP-RET', status: 'Hoàn thành', lines: [{ sku: 'SP-A', qty: 3, unit_price: 100000, return_status: 'đã chấp thuận yêu cầu', returned_qty: 1 }, { sku: 'SP-B', qty: 1, unit_price: 50000 }] };
  const c = await api.post('/imports/orders/commit', { ...base(nh), orders: [o] });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.data.summary.created, 1);
  const ord = (await api.get(`/orders/${c.body.data.results[0].order_id}`)).body.data;
  assert.equal(ord.returns.length, 1);
  assert.equal(ord.returns[0].goods_received_at, null, 'chờ hàng về');
  assert.equal(ord.lines.find((l) => l.sku === 'SP-A').returned_qty, 1);
  assert.equal(ord.lines.find((l) => l.sku === 'SP-B').returned_qty, 0);
  assert.equal(ord.status, 'completed', 'trả một phần giữ completed');
  assert.equal(await onHand(api, 'SP-A'), 17, 'chưa cộng tồn');

  // Import lại: không lập thêm
  const again = await api.post('/imports/orders/commit', { ...base(nh), orders: [o] });
  assert.equal(again.body.data.summary.unchanged, 1, JSON.stringify(again.body.data));
  assert.equal((await api.get(`/orders/${ord.id}`)).body.data.returns.length, 1);

  // File sau đó ghi hoàn trả nhiều hơn: chỉ lập phần chênh
  const more = { ...o, lines: [{ ...o.lines[0], returned_qty: 3 }, o.lines[1]] };
  const upd = await api.post('/imports/orders/commit', { ...base(nh), orders: [more] });
  assert.equal(upd.body.data.summary.updated, 1);
  const o2 = (await api.get(`/orders/${ord.id}`)).body.data;
  assert.equal(o2.returns.length, 2);
  assert.equal(o2.returns[1].goods_amount, 200000);
  assert.equal(o2.lines.find((l) => l.sku === 'SP-A').returned_qty, 3);
  assert.equal(await onHand(api, 'SP-A'), 17);

  // Trạng thái trả hàng chưa chấp thuận → không lập phiếu
  const pending = await api.post('/imports/orders/commit', { ...base(nh), orders: [{ external_id: 'SP-PEND', status: 'Hoàn thành', lines: [{ sku: 'SP-B', qty: 1, unit_price: 50000, return_status: 'Đang xử lý', returned_qty: 1 }] }] });
  assert.equal((await api.get(`/orders/${pending.body.data.results[0].order_id}`)).body.data.returns.length, 0);
  assert.equal((await api.get('/stock-integrity')).body.ok, true);
});

test('Trạng thái returned từ status_map (mẫu chuẩn) chuyển sang chờ hàng về, không cộng tồn ngay; import lại không trùng', async () => {
  const { api, nh, wh } = await setup();
  await seed(api, nh, wh);
  const o = { external_id: 'SP-R2', status: 'Trả hàng/Hoàn tiền', platform_fee_amount: 20000, lines: [{ sku: 'SP-A', qty: 2, unit_price: 100000 }] };
  const c = await api.post('/imports/orders/commit', { ...base(nh), orders: [o] });
  const ord = (await api.get(`/orders/${c.body.data.results[0].order_id}`)).body.data;
  assert.equal(ord.status, 'returned');
  assert.equal(ord.returns[0].goods_received_at, null);
  assert.equal(ord.platform_fee_refunded_amount, 20000, 'trả toàn bộ: Shopee hoàn đủ phí sàn (mặc định theo tỷ lệ)');
  assert.equal(ord.amount_due, 0);
  assert.equal(await onHand(api, 'SP-A'), 18);
  const again = await api.post('/imports/orders/commit', { ...base(nh), orders: [o] });
  assert.equal(again.body.data.summary.unchanged, 1);
  assert.equal((await api.get(`/orders/${ord.id}`)).body.data.returns.length, 1);

  // Đơn đã trả hết, file lần sau ghi "Hoàn thành" kèm trả hàng đã chấp thuận: khớp, không báo xung đột
  const o3 = { external_id: 'SP-R3', status: 'Hoàn thành', lines: [{ sku: 'SP-B', qty: 1, unit_price: 50000, return_status: 'Đã Chấp Thuận Yêu Cầu', returned_qty: 1 }] };
  const c3 = await api.post('/imports/orders/commit', { ...base(nh), orders: [o3] });
  assert.equal((await api.get(`/orders/${c3.body.data.results[0].order_id}`)).body.data.status, 'returned');
  const a3 = await api.post('/imports/orders/commit', { ...base(nh), orders: [o3] });
  assert.equal(a3.body.data.summary.error, 0, JSON.stringify(a3.body.data));
  assert.equal(a3.body.data.summary.unchanged, 1);
});

test('Import lại đơn đã có: dòng hàng/giảm giá khác thì sửa được thì sửa, không thì cảnh báo rõ', async () => {
  const { api, nh, wh } = await setup();
  await seed(api, nh, wh);
  const o = { external_id: 'SP-DIFF', status: 'Chờ lấy hàng', lines: [{ sku: 'SP-A', qty: 2, unit_price: 100000 }], discount_amount: 0 };
  const c = await api.post('/imports/orders/commit', { ...base(nh), orders: [o] });
  const id = c.body.data.results[0].order_id;
  assert.equal((await api.get(`/orders/${id}`)).body.data.status, 'confirmed');

  // đã xác nhận: sửa được dòng + giảm giá đơn
  const r = await api.post('/imports/orders/commit', { ...base(nh), orders: [{ ...o, lines: [{ sku: 'SP-A', qty: 3, unit_price: 90000 }], discount_amount: 5000 }] });
  assert.equal(r.body.data.summary.updated, 1, JSON.stringify(r.body.data));
  const after = (await api.get(`/orders/${id}`)).body.data;
  assert.equal(after.lines[0].qty, 3);
  assert.equal(after.lines[0].unit_price, 90000);
  assert.equal(after.discount_amount, 5000);
  assert.equal(await onHand(api, 'SP-A'), 17);

  // đang giao: không sửa được → cảnh báo, không im lặng
  await api.post(`/orders/${id}/status`, { status: 'shipping' });
  const w = await api.post('/imports/orders/preview', { ...base(nh), orders: [{ ...o, status: 'Đang giao', lines: [{ sku: 'SP-A', qty: 5, unit_price: 90000 }], discount_amount: 5000 }] });
  const row = w.body.data.results[0];
  assert.match(row.warning, /SP-A: SL 3→5/);
  assert.match(row.warning, /không sửa tự động/);
  assert.equal((await api.get(`/orders/${id}`)).body.data.lines[0].qty, 3, 'xem trước không ghi');

  // Không gửi giảm giá đơn (file không có cột) thì không so sánh
  const same = await api.post('/imports/orders/preview', { ...base(nh), orders: [{ external_id: 'SP-DIFF', status: 'Đang giao', lines: [{ sku: 'SP-A', qty: 3, unit_price: 90000 }] }] });
  assert.equal(same.body.data.results[0].action, 'unchanged');
  assert.equal(same.body.data.results[0].warning, null);
});
