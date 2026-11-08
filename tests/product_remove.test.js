import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { getDb } from '../server/db/index.js';
import { verifyStockIntegrity } from '../server/modules/inventory/service.js';
import { flushJournal, verifyJournal } from '../server/modules/accounting/journal.js';

const ok = (r, s = [200, 201]) => { assert.ok([].concat(s).includes(r.status), JSON.stringify(r.body)); return r.body.data; };
const mk = async (api, nh, name, sku) => ok(await api.post('/products', { name, variants: [{ sku, default_price: 100000 }], shop_ids: [nh.id] }));

test('sản phẩm chưa từng dùng: xoá hẳn, cần xác nhận, SKU được giải phóng', async () => {
  const { api, nh } = await setup();
  const p = await mk(api, nh, 'Mẫu thử', 'T1');
  const imp = ok(await api.get(`/products/${p.id}/removal-impact`));
  assert.equal(imp.mode, 'delete'); assert.deepEqual(imp.blockers, []); assert.equal(imp.needs_write_off, false);
  assert.equal((await api.post(`/products/${p.id}/remove`, {})).body.error.code, 'CONFIRM_REQUIRED');
  assert.equal(ok(await api.post(`/products/${p.id}/remove`, { confirm: true })).mode, 'deleted');
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM products WHERE id = ?').get(p.id).n, 0);
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM variants WHERE sku = ?').get('T1').n, 0);
  await mk(api, nh, 'Mẫu thử 2', 'T1'); // tạo lại cùng SKU được
});

test('sản phẩm đã có lịch sử: chỉ ngừng kinh doanh, ẩn khỏi danh sách, khôi phục được', async () => {
  const { api, nh, wh } = await setup();
  const p = await mk(api, nh, 'Đã bán', 'S1');
  ok(await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: p.variants[0].id, qty: 5, unit_cost: 40000 }] }));
  ok(await api.post('/orders', { status: 'completed', shop_id: nh.id, lines: [{ sku: 'S1', qty: 5 }], payments: [{ amount: 500000, method: 'cash' }] }));
  const imp = ok(await api.get(`/products/${p.id}/removal-impact`));
  assert.equal(imp.mode, 'archive'); assert.equal(imp.history.orders, 1); assert.equal(imp.stock.lines, 0);
  const r = ok(await api.post(`/products/${p.id}/remove`, { confirm: true }));
  assert.equal(r.mode, 'archived');
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM order_lines WHERE sku = ?').get('S1').n, 1, 'lịch sử đơn còn nguyên');
  assert.ok(!ok(await api.get('/products')).some((x) => x.id === p.id), 'ẩn khỏi danh sách');
  assert.ok(ok(await api.get('/products?archived=only')).some((x) => x.id === p.id), 'hiện ở tab đã ngừng');
  assert.equal((await api.post(`/products/${p.id}/remove`, { confirm: true })).body.error.code, 'ALREADY_ARCHIVED');
  assert.equal((await api.patch(`/products/${p.id}`, { archived: true })).body.error.code, 'USE_REMOVE');
  assert.equal(ok(await api.get('/reports/overview')).current.order_count, 1);
  const back = ok(await api.post(`/products/${p.id}/restore`));
  assert.equal(back.restored_variants, 1);
  assert.ok(ok(await api.get('/products')).some((x) => x.id === p.id));
  assert.equal(getDb().prepare('SELECT active FROM shop_listings WHERE variant_id = ?').get(p.variants[0].id).active, 1);
});

test('còn hàng: phải xác nhận xuất huỷ; hệ thống lập phiếu hàng hỏng, tồn về 0, sổ kế toán khớp', async () => {
  const { api, nh, wh } = await setup();
  const p = await mk(api, nh, 'Còn hàng', 'H1');
  ok(await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: p.variants[0].id, qty: 10, unit_cost: 40000 }] }));
  const imp = ok(await api.get(`/products/${p.id}/removal-impact`));
  assert.equal(imp.needs_write_off, true); assert.equal(imp.stock.qty, 10); assert.equal(imp.stock.value, 400000);
  const no = await api.post(`/products/${p.id}/remove`, { confirm: true });
  assert.equal(no.status, 409); assert.equal(no.body.error.code, 'PRODUCT_HAS_STOCK');
  const r = ok(await api.post(`/products/${p.id}/remove`, { confirm: true, write_off: true }));
  assert.equal(r.mode, 'archived'); assert.equal(r.written_off.qty, 10);
  assert.equal(getDb().prepare('SELECT COALESCE(SUM(on_hand),0) n FROM stock_levels WHERE variant_id = ?').get(p.variants[0].id).n, 0);
  assert.equal(getDb().prepare("SELECT COUNT(*) n FROM stock_movements WHERE type = 'damage_out' AND variant_id = ?").get(p.variants[0].id).n, 1);
  assert.deepEqual(verifyStockIntegrity(), []);
  flushJournal(); assert.deepEqual(verifyJournal(), []);
});

test('chặn khi là thành phần combo, còn trong đơn nháp hoặc phiếu nhập nháp', async () => {
  const { api, nh, wh } = await setup();
  const a = await mk(api, nh, 'Thành phần', 'C1');
  ok(await api.post('/products', { name: 'Combo X', variants: [{ sku: 'CBX', kind: 'bundle', default_price: 150000, components: [{ variant_id: a.variants[0].id, qty: 2 }] }], shop_ids: [nh.id] }));
  const r1 = await api.post(`/products/${a.id}/remove`, { confirm: true });
  assert.equal(r1.status, 409); assert.ok(r1.body.error.details.blockers.some((b) => b.code === 'PRODUCT_IN_COMBO'));
  const b = await mk(api, nh, 'Nháp', 'D1');
  ok(await api.post('/purchases', { warehouse_id: wh.id, lines: [{ variant_id: b.variants[0].id, qty: 1, unit_cost: 1000 }] }));
  ok(await api.post('/orders', { status: 'draft', shop_id: nh.id, lines: [{ sku: 'D1', qty: 1 }] }));
  const r2 = await api.post(`/products/${b.id}/remove`, { confirm: true });
  const codes = r2.body.error.details.blockers.map((x) => x.code);
  assert.ok(codes.includes('PRODUCT_IN_DRAFT_ORDER') && codes.includes('PRODUCT_IN_DRAFT_PURCHASE'));
});

test('gỡ combo chưa từng bán thì xoá hẳn và thành phần hết bị combo chặn', async () => {
  const { api, nh } = await setup();
  const a = await mk(api, nh, 'Thành phần', 'E1');
  const combo = ok(await api.post('/products', { name: 'Combo Y', variants: [{ sku: 'CBY', kind: 'bundle', default_price: 150000, components: [{ variant_id: a.variants[0].id, qty: 1 }] }], shop_ids: [nh.id] }));
  assert.equal(ok(await api.post(`/products/${combo.id}/remove`, { confirm: true })).mode, 'deleted');
  assert.deepEqual(ok(await api.get(`/products/${a.id}/removal-impact`)).blockers, []);
});

test('sản phẩm chưa gắn shop nào: tìm được bằng unlisted=only dù đang lọc theo shop, và xoá được', async () => {
  const { api, nh } = await setup();
  const listed = await mk(api, nh, 'Đã gắn shop', 'L1');
  const lone = ok(await api.post('/products', { name: 'Vật tư lẻ', item_type: 'supply', variants: [{ sku: 'VT1', default_price: 0 }], shop_ids: [] }));
  assert.ok(!ok(await api.get(`/products?shop_id=${nh.id}`)).some((x) => x.id === lone.id), 'lọc theo shop thì không thấy');
  const only = ok(await api.get('/products?unlisted=only'));
  assert.deepEqual(only.map((x) => x.id), [lone.id]);
  assert.ok(!only.some((x) => x.id === listed.id));
  assert.equal(ok(await api.post(`/products/${lone.id}/remove`, { confirm: true })).mode, 'deleted');
  assert.deepEqual(ok(await api.get('/products?unlisted=only')), []);
});
