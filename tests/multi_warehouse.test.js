import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setup } from './helpers.js';
import { getDb, openDb, migrate, MIGRATIONS_DIR } from '../server/db/index.js';
import { verifyStats } from '../server/modules/reports/stats.js';
import { verifyStock } from '../server/modules/inventory/verify.js';
import { addDays, businessDate } from '../server/lib/time.js';

const WIDE = () => `from=${addDays(businessDate(), -10)}&to=${businessDate()}`;

/** Hai kho: A (ưu tiên 1) và B; shop NH lấy theo thứ tự A, B. Tồn A: 4 × 10.000, B: 10 × 20.000 cho biến thể đơn. */
async function scenario() {
  const ctx = await setup();
  const { api, nh, wh } = ctx;
  const b = (await api.post('/warehouses', { code: 'K2', name: 'Kho B' })).body.data;
  const put = await api.put(`/shops/${nh.id}/warehouses`, { warehouse_ids: [wh.id, b.id] });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const a = (await api.post('/products', { name: 'Tinh dầu', variants: [{ sku: 'TD-1', default_price: 50000 }], shop_ids: [nh.id] })).body.data.variants[0];
  await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: a.id, qty: 4, unit_cost: 10000 }] });
  await api.post('/purchases', { warehouse_id: b.id, receive: true, lines: [{ variant_id: a.id, qty: 10, unit_cost: 20000 }] });
  return { ...ctx, A: wh, B: b, v: a };
}

const onHand = (wh, variantId) => getDb().prepare('SELECT COALESCE(SUM(on_hand),0) AS n FROM stock_levels WHERE warehouse_id = ? AND variant_id = ?').get(wh, variantId).n;
const allocs = (orderId) =>
  getDb()
    .prepare('SELECT a.* FROM order_line_allocations a JOIN order_lines l ON l.id = a.order_line_id WHERE l.order_id = ? ORDER BY a.rowid')
    .all(orderId);
const remainingCost = () => getDb().prepare('SELECT COALESCE(SUM((a.qty - a.restocked_qty) * a.unit_cost),0) AS v FROM order_line_allocations a JOIN order_lines l ON l.id = a.order_line_id JOIN orders o ON o.id = l.order_id WHERE o.status IN (\'confirmed\',\'shipping\',\'completed\',\'returned\')').get().v;
const clean = () => {
  assert.deepEqual(verifyStock(), [], 'kho + giá vốn khớp sổ');
  assert.deepEqual(verifyStats(), [], 'daily_stats khớp');
};

test('Kho A thiếu thì lấy tiếp từ kho B; giá vốn là tổng đúng từng phần; huỷ hoàn đúng từng kho', async () => {
  const { api, nh, A, B, v } = await scenario();
  const r = await api.post('/orders', { shop_id: nh.id, lines: [{ variant_id: v.id, qty: 7 }], status: 'confirmed' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const o = r.body.data;
  assert.deepEqual(o.lines[0].allocations.map((a) => [a.warehouse_id, a.qty, a.unit_cost]), [[A.id, 4, 10000], [B.id, 3, 20000]]);
  assert.equal(o.lines[0].cogs_amount, 4 * 10000 + 3 * 20000);
  assert.equal(o.cogs_amount, 100000);
  assert.equal(o.lines[0].unit_cost, Math.round(100000 / 7), 'đơn giá chỉ để hiển thị');
  assert.equal(o.warehouse_id, A.id, 'kho chính = ưu tiên 1');
  assert.equal(onHand(A.id, v.id), 0);
  assert.equal(onHand(B.id, v.id), 7);
  clean();

  const c = await api.post(`/orders/${o.id}/status`, { status: 'cancelled' });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(onHand(A.id, v.id), 4);
  assert.equal(onHand(B.id, v.id), 10);
  assert.equal(c.body.data.cogs_amount, 0);
  assert.equal(remainingCost(), 0);
  clean();
});

test('Không đủ tồn ở mọi kho: STOCK_NOT_ENOUGH và không để lại biến động nào', async () => {
  const { api, nh, A, B, v } = await scenario();
  const r = await api.post('/orders', { shop_id: nh.id, lines: [{ variant_id: v.id, qty: 15 }], status: 'confirmed' });
  assert.equal(r.body.error.code, 'STOCK_NOT_ENOUGH');
  assert.equal(onHand(A.id, v.id), 4);
  assert.equal(onHand(B.id, v.id), 10);
  clean();
});

test('Trả một phần: hoàn theo LIFO về đúng kho với giá vốn đã chụp; trả không nhập lại không đổi giá vốn; báo cáo = Σ phân bổ còn lại', async () => {
  const { api, nh, A, B, v } = await scenario();
  const o = (await api.post('/orders', { shop_id: nh.id, lines: [{ variant_id: v.id, qty: 7 }], status: 'completed' })).body.data;
  const line = o.lines[0].id;
  let r = (await api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: line, qty: 2, restock: true }] })).body.data;
  assert.equal(r.cogs_amount, 100000 - 2 * 20000, '2 cái trả lấy từ phân bổ sau cùng (kho B, 20.000)');
  assert.equal(onHand(B.id, v.id), 9);
  assert.equal(onHand(A.id, v.id), 0);
  clean();

  r = (await api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: line, qty: 2, restock: true }] })).body.data;
  assert.equal(r.cogs_amount, 100000 - 40000 - 20000 - 10000, 'còn 1 cái kho B + 1 cái kho A');
  assert.equal(onHand(B.id, v.id), 10);
  assert.equal(onHand(A.id, v.id), 1);
  clean();

  // Hàng hỏng, không nhập lại: giá vốn giữ nguyên
  r = (await api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: line, qty: 1, restock: false }] })).body.data;
  assert.equal(r.cogs_amount, 30000);
  assert.equal(onHand(A.id, v.id), 1);
  clean();

  const ov = (await api.get(`/reports/overview?${WIDE()}`)).body.data.current;
  assert.equal(ov.cogs, remainingCost());
  assert.equal(ov.cogs, 30000);
  const prods = (await api.get('/reports/products?limit=50')).body.data;
  assert.equal(prods.reduce((a, p) => a + p.cogs, 0), ov.cogs);

  // Trả có chọn kho nhận: về kho khác nhưng giá vốn hoàn vẫn là giá đã chụp
  r = (await api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: line, qty: 1, restock: true, warehouse_id: B.id }] })).body.data;
  assert.equal(onHand(B.id, v.id), 11, 'kho nhận là B theo yêu cầu');
  assert.equal(r.cogs_amount, 20000, 'phân bổ còn lại duy nhất là kho A (10.000), giá vốn hoàn vẫn là giá đã chụp');
  assert.equal(r.cogs_amount, remainingCost());
  clean();
  const bad = await api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: line, qty: 9, restock: true }] });
  assert.equal(bad.body.error.code, 'RETURN_QTY');
});

test('Combo có thành phần ở hai kho: mỗi thành phần lấy đúng kho, giá vốn từng phần, huỷ hoàn đúng', async () => {
  const { api, nh, A, B } = await setup().then(async (ctx) => {
    const b = (await ctx.api.post('/warehouses', { code: 'K2', name: 'Kho B' })).body.data;
    await ctx.api.put(`/shops/${ctx.nh.id}/warehouses`, { warehouse_ids: [ctx.wh.id, b.id] });
    return { ...ctx, A: ctx.wh, B: b };
  });
  const x = (await api.post('/products', { name: 'X', variants: [{ sku: 'X1', default_price: 10000 }], shop_ids: [nh.id] })).body.data.variants[0];
  const y = (await api.post('/products', { name: 'Y', variants: [{ sku: 'Y1', default_price: 10000 }], shop_ids: [nh.id] })).body.data.variants[0];
  const buy = (wh, v, qty, cost) => api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: v.id, qty, unit_cost: cost }] });
  await buy(A, x, 3, 1000);
  await buy(B, x, 10, 4000);
  await buy(A, y, 5, 7000);
  const cb = (await api.post('/products', { name: 'Combo', variants: [{ sku: 'CB', kind: 'bundle', default_price: 30000, components: [{ variant_id: x.id, qty: 2 }, { variant_id: y.id, qty: 1 }] }], shop_ids: [nh.id] })).body.data.variants[0];

  const vs = (await api.get(`/variants?shop_id=${nh.id}&q=CB`)).body.data[0];
  assert.equal(vs.on_hand, 5, 'không truyền warehouse_id: tổng các kho của shop, min(13/2, 5/1)');
  assert.equal(vs.on_hand_total, 5);
  const single = (await api.get(`/variants?shop_id=${nh.id}&q=X1`)).body.data[0];
  assert.equal(single.on_hand, 13, 'biến thể đơn cũng dùng tổng, không còn ra 0');
  assert.deepEqual(single.stock_by_warehouse.map((w) => [w.warehouse_id, w.on_hand]), [[A.id, 3], [B.id, 10]]);

  const o = (await api.post('/orders', { shop_id: nh.id, lines: [{ variant_id: cb.id, qty: 3 }], status: 'confirmed' })).body.data;
  const al = o.lines[0].allocations.map((a) => [a.sku, a.warehouse_id, a.qty, a.unit_cost]);
  assert.deepEqual(al, [['X1', A.id, 3, 1000], ['X1', B.id, 3, 4000], ['Y1', A.id, 3, 7000]]);
  assert.equal(o.cogs_amount, 3 * 1000 + 3 * 4000 + 3 * 7000);
  assert.equal(o.lines[0].unit_cost, Math.round(36000 / 3));
  clean();

  // trả 1 combo (LIFO): lấy phần phân bổ sau cùng của từng thành phần
  const r = (await api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: o.lines[0].id, qty: 1, restock: true }] })).body.data;
  assert.equal(r.cogs_amount, 36000 - (2 * 4000 + 7000));
  assert.equal(r.cogs_amount, remainingCost());
  clean();
  const c = (await api.post(`/orders/${o.id}/returns`, { lines: [{ order_line_id: o.lines[0].id, qty: 2, restock: true }] })).body.data;
  assert.equal(c.cogs_amount, 0);
  assert.equal(onHand(A.id, x.id), 3);
  assert.equal(onHand(B.id, x.id), 10);
  assert.equal(onHand(A.id, y.id), 5);
  clean();

  // huỷ đơn combo khác
  const o2 = (await api.post('/orders', { shop_id: nh.id, lines: [{ variant_id: cb.id, qty: 4 }], status: 'confirmed' })).body.data;
  await api.post(`/orders/${o2.id}/status`, { status: 'cancelled' });
  assert.equal(onHand(A.id, x.id), 3);
  assert.equal(onHand(B.id, x.id), 10);
  assert.equal(onHand(A.id, y.id), 5);
  clean();
});

test('Đơn import vượt tồn: phần thiếu dồn vào kho ưu tiên 1 (âm kho), gắn cờ, huỷ hoàn lại đúng', async () => {
  const { api, nh, A, B, v } = await scenario();
  const r = await api.post('/orders', { shop_id: nh.id, lines: [{ variant_id: v.id, qty: 20 }], status: 'confirmed', allow_negative_stock: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const o = r.body.data;
  assert.equal(o.stock_warning, 1);
  assert.deepEqual(o.lines[0].allocations.map((a) => [a.warehouse_id, a.qty, a.unit_cost]), [[A.id, 10, 10000], [B.id, 10, 20000]]);
  assert.equal(onHand(A.id, v.id), -6);
  assert.equal(onHand(B.id, v.id), 0);
  assert.equal(o.cogs_amount, 300000);
  clean();
  await api.post(`/orders/${o.id}/status`, { status: 'cancelled' });
  assert.equal(onHand(A.id, v.id), 4);
  assert.equal(onHand(B.id, v.id), 10);
  clean();
});

test('Phân bổ tay: xem trước, lưu trên đơn nháp, dùng khi xác nhận; tổng sai báo ALLOCATION_MISMATCH', async () => {
  const { api, nh, A, B, v } = await scenario();
  const pv = (await api.post('/orders/allocation-preview', { shop_id: nh.id, lines: [{ variant_id: v.id, qty: 6 }] })).body.data;
  assert.equal(pv.ok, true);
  assert.deepEqual(pv.lines[0].items.map((i) => [i.warehouse_id, i.qty]), [[A.id, 4], [B.id, 2]]);
  assert.deepEqual(pv.stock[0].warehouses.map((w) => w.on_hand), [4, 10]);
  const pvShort = (await api.post('/orders/allocation-preview', { shop_id: nh.id, lines: [{ variant_id: v.id, qty: 50 }] })).body.data;
  assert.equal(pvShort.ok, false);
  assert.equal(pvShort.shortages[0].short_qty, 36);

  const bad = await api.post('/orders', { shop_id: nh.id, lines: [{ variant_id: v.id, qty: 5, allocations: [{ warehouse_id: B.id, qty: 4 }] }] });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'ALLOCATION_MISMATCH');

  const draft = (await api.post('/orders', { shop_id: nh.id, lines: [{ variant_id: v.id, qty: 5, allocations: [{ warehouse_id: B.id, qty: 5 }] }] })).body.data;
  assert.deepEqual(draft.lines[0].planned_allocations, [{ warehouse_id: B.id, qty: 5 }]);
  assert.equal(allocs(draft.id).length, 0, 'đơn nháp chưa phân bổ thật');
  const patched = await api.patch(`/orders/${draft.id}`, { lines: [{ variant_id: v.id, qty: 5, allocations: [{ warehouse_id: A.id, qty: 1 }, { warehouse_id: B.id, qty: 4 }] }] });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  const o = (await api.post(`/orders/${draft.id}/status`, { status: 'confirmed' })).body.data;
  assert.deepEqual(o.lines[0].allocations.map((a) => [a.warehouse_id, a.qty]), [[A.id, 1], [B.id, 4]]);
  assert.equal(o.cogs_amount, 10000 + 4 * 20000);
  assert.equal(onHand(A.id, v.id), 3);
  clean();

  // Kho ngoài danh sách của shop vẫn dùng được, chỉ cảnh báo
  const w3 = (await api.post('/warehouses', { code: 'K3', name: 'Kho C' })).body.data;
  await api.post('/purchases', { warehouse_id: w3.id, receive: true, lines: [{ variant_id: v.id, qty: 2, unit_cost: 5000 }] });
  const pv3 = (await api.post('/orders/allocation-preview', { shop_id: nh.id, lines: [{ variant_id: v.id, qty: 2, allocations: [{ warehouse_id: w3.id, qty: 2 }] }] })).body.data;
  assert.equal(pv3.warnings[0].code, 'WAREHOUSE_OUTSIDE_SHOP');
  const o3 = (await api.post('/orders', { shop_id: nh.id, lines: [{ variant_id: v.id, qty: 2, allocations: [{ warehouse_id: w3.id, qty: 2 }] }], status: 'confirmed' })).body.data;
  assert.equal(o3.cogs_amount, 10000);
  clean();
});

test('API kho của shop: thứ tự ưu tiên, kho đầu đồng bộ default_warehouse_id, có audit', async () => {
  const { api, nh, A, B } = await scenario();
  let l = (await api.get(`/shops/${nh.id}/warehouses`)).body.data;
  assert.deepEqual(l.map((w) => w.warehouse_id), [A.id, B.id]);
  assert.equal((await api.put(`/shops/${nh.id}/warehouses`, { warehouse_ids: [B.id, A.id] })).status, 200);
  const shop = (await api.get(`/shops/${nh.id}`)).body.data;
  assert.equal(shop.default_warehouse_id, B.id);
  assert.deepEqual(shop.warehouse_ids, [B.id, A.id]);
  assert.ok(getDb().prepare("SELECT 1 FROM audit_log WHERE action = 'shop.warehouses_changed'").get());
  assert.equal((await api.put(`/shops/${nh.id}/warehouses`, { warehouse_ids: [B.id, 'whs_nope'] })).status, 400);
  // đổi kho mặc định bằng PATCH = đưa kho đó lên đầu
  await api.patch(`/shops/${nh.id}`, { default_warehouse_id: A.id });
  l = (await api.get(`/shops/${nh.id}/warehouses`)).body.data;
  assert.deepEqual(l.map((w) => w.warehouse_id), [A.id, B.id]);
});

test('Migration 022: đơn đã có (đơn lẻ, combo, trả một phần, đã huỷ, nháp) được chuyển thành phân bổ + cogs_amount đúng', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files.filter((x) => x < '022')) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(tmp, f));
  const conn = openDb(':memory:', tmp);
  const at = '2026-10-01T00:00:00.000Z';
  const run = (sql, ...a) => conn.prepare(sql).run(...a);
  run("INSERT INTO warehouses (id, code, name, created_at, updated_at) VALUES ('w1','K1','K1',?,?)", at, at);
  run("INSERT INTO shops (id, code, name, default_warehouse_id, created_at, updated_at) VALUES ('s1','S1','S1','w1',?,?), ('s2','S2','S2',NULL,?,?)", at, at, at, at);
  run("INSERT INTO products (id, name, created_at, updated_at) VALUES ('p1','P',?,?)", at, at);
  run("INSERT INTO variants (id, product_id, sku, created_at, updated_at) VALUES ('va','p1','A',?,?), ('vb','p1','B',?,?)", at, at, at, at);
  run("INSERT INTO variants (id, product_id, sku, kind, created_at, updated_at) VALUES ('vc','p1','C','bundle',?,?)", at, at);
  const ord = (id, status) => run('INSERT INTO orders (id, code, shop_id, channel_id, warehouse_id, status, ordered_at, business_date, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', id, id, 's1', 'direct', 'w1', status, at, '2026-10-01', at, at);
  const line = (id, o, v, qty, cost, restocked, returned = restocked) =>
    run("INSERT INTO order_lines (id, order_id, variant_id, sku, name, qty, unit_price, line_total, unit_cost, restocked_qty, returned_qty) VALUES (?,?,?,'x','x',?,1000,?,?,?,?)", id, o, v, qty, qty * 1000, cost, restocked, returned);
  ord('o1', 'completed'); line('l1', 'o1', 'va', 5, 3000, 2);        // trả 2 nhập lại: còn 3 × 3000
  ord('o2', 'confirmed'); line('l2', 'o2', 'vc', 3, 7000, 1);        // combo 3 cái, trả 1 nhập lại
  run("INSERT INTO order_line_components (id, order_line_id, variant_id, per_bundle_qty, unit_cost) VALUES ('c1','l2','va',2,2000), ('c2','l2','vb',1,3000)");
  ord('o3', 'cancelled'); line('l3', 'o3', 'va', 4, 2500, 0);        // đã từng xác nhận rồi huỷ
  run("INSERT INTO order_status_history (id, order_id, to_status, created_at) VALUES ('h1','o3','confirmed',?)", at);
  ord('o4', 'draft'); line('l4', 'o4', 'va', 1, 0, 0);
  ord('o5', 'completed'); line('l5', 'o5', 'vb', 2, 1000, 0, 1);     // trả 1 không nhập lại: giá vốn giữ 2 × 1000
  const cogsBefore = conn.prepare("SELECT SUM((qty - restocked_qty) * unit_cost) v FROM order_lines WHERE order_id IN ('o1','o2','o5')").get().v;

  fs.copyFileSync(path.join(MIGRATIONS_DIR, files.find((x) => x.startsWith('022'))), path.join(tmp, files.find((x) => x.startsWith('022'))));
  migrate(conn, tmp);

  const cogs = Object.fromEntries(conn.prepare('SELECT id, cogs_amount FROM order_lines').all().map((r) => [r.id, r.cogs_amount]));
  assert.deepEqual(cogs, { l1: 9000, l2: 14000, l3: 0, l4: 0, l5: 2000 });
  assert.equal(cogs.l1 + cogs.l2 + cogs.l5, cogsBefore, 'tổng giá vốn không đổi sau migration');
  const al = conn.prepare('SELECT order_line_id l, variant_id v, warehouse_id w, qty, unit_cost c, restocked_qty r FROM order_line_allocations ORDER BY order_line_id, variant_id').all();
  assert.deepEqual(al, [
    { l: 'l1', v: 'va', w: 'w1', qty: 5, c: 3000, r: 2 },
    { l: 'l2', v: 'va', w: 'w1', qty: 6, c: 2000, r: 2 },
    { l: 'l2', v: 'vb', w: 'w1', qty: 3, c: 3000, r: 1 },
    { l: 'l3', v: 'va', w: 'w1', qty: 4, c: 2500, r: 4 },
    { l: 'l5', v: 'vb', w: 'w1', qty: 2, c: 1000, r: 0 },
  ]);
  // Σ phân bổ còn lại = cogs_amount
  for (const id of ['l1', 'l2', 'l5']) {
    assert.equal(conn.prepare('SELECT SUM((qty - restocked_qty) * unit_cost) v FROM order_line_allocations WHERE order_line_id = ?').get(id).v, cogs[id]);
  }
  assert.deepEqual(conn.prepare('SELECT shop_id, warehouse_id, priority FROM shop_warehouses').all(), [{ shop_id: 's1', warehouse_id: 'w1', priority: 1 }]);
  conn.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
