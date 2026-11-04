import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { getDb } from '../server/db/index.js';

const options = [
  { name: 'Mùi', values: ['Cam', 'Chanh'] },
  { name: 'Size', values: ['10ml', '30ml'] },
];
const combos = [];
for (const m of ['Cam', 'Chanh']) for (const s of ['10ml', '30ml']) combos.push({ m, s });
const rows = (extra = {}) =>
  combos.map(({ m, s }, i) => ({ sku: `NH-${m.slice(0, 3)}-${s}`.toUpperCase(), option_values: { Mùi: m, Size: s }, default_price: 100000 + i * 1000, opening_qty: 10 + i, opening_cost: 40000 + i * 100, ...extra }));

test('Ma trận 2×2: tạo đủ 4 biến thể, tên tự đặt, niêm yết, tồn đầu kỳ vào sổ cái trong cùng giao dịch', async () => {
  const { api, nh, wh } = await setup();
  const r = await api.post('/products', { name: 'Tinh dầu', options, variants: rows(), shop_ids: [nh.id], opening_warehouse_id: wh.id });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const p = r.body.data;
  assert.deepEqual(p.options, options);
  assert.equal(p.variants.length, 4);
  assert.deepEqual(p.variants.map((v) => v.name), ['Cam / 10ml', 'Cam / 30ml', 'Chanh / 10ml', 'Chanh / 30ml']);
  assert.deepEqual(p.variants[1].option_values, { Mùi: 'Cam', Size: '30ml' });
  assert.ok(p.variants.every((v) => v.listings.length === 1 && v.listings[0].shop_id === nh.id));
  assert.deepEqual(p.variants.map((v) => v.on_hand_total), [10, 11, 12, 13]);
  const mv = getDb().prepare("SELECT type, qty, unit_cost, balance_after FROM stock_movements WHERE variant_id = ?").get(p.variants[3].id);
  assert.deepEqual(mv, { type: 'opening', qty: 13, unit_cost: 40300, balance_after: 13 });
  assert.equal(getDb().prepare('SELECT avg_cost FROM stock_levels WHERE variant_id = ?').get(p.variants[3].id).avg_cost, 40300);
});

test('Tồn đầu kỳ lấy kho mặc định của shop khi không chọn kho; thiếu kho thì lỗi và không tạo gì', async () => {
  const { api, nh, wh } = await setup();
  const ok = await api.post('/products', { name: 'A', variants: [{ sku: 'A1', default_price: 1000, opening_qty: 5, opening_cost: 300 }], shop_ids: [nh.id] });
  assert.equal(ok.status, 201);
  assert.equal(getDb().prepare('SELECT warehouse_id FROM stock_movements WHERE variant_id = ?').get(ok.body.data.variants[0].id).warehouse_id, wh.id);
  const bad = await api.post('/products', { name: 'B', variants: [{ sku: 'B1', default_price: 1000, opening_qty: 5 }] });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'WAREHOUSE_REQUIRED');
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM products WHERE name = 'B'").get().n, 0, 'cả giao dịch bị huỷ');
});

test('SKU trùng trong lô báo đúng dòng; trùng với sản phẩm khác báo 409; giá trị thuộc tính phải nằm trong danh sách', async () => {
  const { api, nh } = await setup();
  const dup = rows();
  dup[2].sku = dup[0].sku.toLowerCase();
  const r = await api.post('/products', { name: 'T', options, variants: dup, shop_ids: [nh.id] });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'DUPLICATE_SKU');
  assert.equal(r.body.error.details.index, 2);
  await api.post('/products', { name: 'Có sẵn', variants: [{ sku: 'DA-CO', default_price: 1 }] });
  const r2 = await api.post('/products', { name: 'T2', options, variants: rows().map((v, i) => (i === 1 ? { ...v, sku: 'da-co' } : v)) });
  assert.equal(r2.status, 409);
  assert.equal(r2.body.error.details.index, 1);
  const r3 = await api.post('/products', { name: 'T3', options, variants: [{ sku: 'X1', option_values: { Mùi: 'Dâu' } }] });
  assert.equal(r3.status, 400);
  assert.equal(r3.body.error.code, 'OPTION_VALUE_INVALID');
  const many = await api.post('/products', { name: 'T4', options: [1, 2, 3, 4].map((n) => ({ name: `T${n}`, values: ['a'] })), variants: [{ sku: 'X2' }] });
  assert.equal(many.status, 400, 'tối đa 3 thuộc tính');
});

test('Sửa ma trận: thêm giá trị sinh dòng mới (có tồn đầu kỳ); bỏ giá trị: có lịch sử thì lưu trữ, chưa dùng thì xoá', async () => {
  const { api, nh } = await setup();
  const p = (await api.post('/products', { name: 'Tinh dầu', options, variants: rows().map((v, i) => (i === 3 ? { ...v, opening_qty: 0 } : v)), shop_ids: [nh.id] })).body.data;
  const [camS, camL, chanhS, chanhL] = p.variants;
  // Bán 1 chai Chanh 10ml: biến thể này có lịch sử. Cần tồn: nhập tồn bằng phiếu nhập
  const wh = getDb().prepare('SELECT id FROM warehouses').get().id;
  await api.post('/purchases', { warehouse_id: wh, receive: true, lines: [{ variant_id: chanhS.id, qty: 5, unit_cost: 1000 }] });
  assert.equal((await api.post('/orders', { shop_id: nh.id, lines: [{ sku: chanhS.sku, qty: 1 }], status: 'completed' })).status, 201);

  const newOptions = [{ name: 'Mùi', values: ['Cam', 'Bưởi'] }, { name: 'Size', values: ['10ml', '30ml'] }];
  const upd = await api.patch(`/products/${p.id}`, {
    options: newOptions,
    variants: [
      { id: chanhS.id, remove: true }, // đã có lịch sử → lưu trữ
      { id: chanhL.id, remove: true }, // chưa dùng → xoá
      { sku: 'NH-BUO-10ML', option_values: { Mùi: 'Bưởi', Size: '10ml' }, default_price: 120000, opening_qty: 7, opening_cost: 50000 },
      { sku: 'NH-BUO-30ML', option_values: { Mùi: 'Bưởi', Size: '30ml' }, default_price: 130000 },
    ],
  });
  assert.equal(upd.status, 200, JSON.stringify(upd.body));
  const after = upd.body.data;
  assert.deepEqual(after.options, newOptions);
  const bySku = Object.fromEntries(after.variants.map((v) => [v.sku, v]));
  assert.ok(bySku[chanhS.sku].archived_at, 'biến thể có lịch sử chỉ lưu trữ');
  assert.equal(bySku[chanhL.sku], undefined, 'biến thể chưa từng dùng bị xoá hẳn');
  assert.equal(bySku['NH-BUO-10ML'].on_hand_total, 7);
  assert.equal(bySku['NH-BUO-10ML'].listings[0].shop_id, nh.id, 'dòng mới tự niêm yết ở các shop của sản phẩm');
  assert.equal(bySku['NH-BUO-30ML'].on_hand_total, 0);
  assert.equal(bySku['NH-CAM-10ML'].on_hand_total, 10, 'dòng cũ giữ nguyên');
  // Tắt bán một dòng
  const off = (await api.patch(`/products/${p.id}`, { variants: [{ id: camL.id, active: false }] })).body.data;
  assert.ok(off.variants.find((v) => v.id === camL.id).archived_at);
  const on = (await api.patch(`/products/${p.id}`, { variants: [{ id: camL.id, active: true }] })).body.data;
  assert.equal(on.variants.find((v) => v.id === camL.id).archived_at, null);
  void camS;
});

test('Lọc sản phẩm theo loại Sản phẩm/Combo; combo không có tồn đầu kỳ', async () => {
  const { api, nh } = await setup();
  const a = (await api.post('/products', { name: 'A', variants: [{ sku: 'A1', default_price: 10 }], shop_ids: [nh.id] })).body.data.variants[0];
  await api.post('/products', { name: 'Combo A', variants: [{ sku: 'CB', kind: 'bundle', default_price: 20, components: [{ variant_id: a.id, qty: 2 }] }], shop_ids: [nh.id] });
  const names = async (t) => (await api.get(`/products?type=${t}`)).body.data.map((p) => p.name);
  assert.deepEqual(await names('combo'), ['Combo A']);
  assert.deepEqual(await names('single'), ['A']);
  const bad = await api.post('/products', { name: 'C2', variants: [{ sku: 'CB2', kind: 'bundle', default_price: 20, components: [{ variant_id: a.id, qty: 1 }], opening_qty: 3 }] });
  assert.equal(bad.status, 400);
});

test('Ngũ hành là trường sản phẩm của shop phong thuỷ: tạo kèm sản phẩm, đọc/ghi theo shop, bỏ cột elements', async () => {
  const { api, pt, nh } = await setup();
  await api.patch(`/shops/${pt.id}`, { industry: 'phong_thuy' });
  const f = (await api.get(`/custom/fields?entity_type=product&shop_id=${pt.id}`)).body.data;
  assert.equal(f.length, 1);
  assert.equal(f[0].key, 'ngu_hanh');
  assert.equal(f[0].role, 'element');
  assert.equal((await api.get(`/custom/fields?entity_type=product&shop_id=${nh.id}`)).body.data.length, 0, 'shop khác không có trường này');
  const p = (await api.post('/products', { name: 'Tỳ hưu', custom: { ngu_hanh: ['Thổ', 'Kim'] }, custom_shop_id: pt.id, variants: [{ sku: 'TH', default_price: 1 }], shop_ids: [pt.id] })).body.data;
  assert.equal(p.elements, undefined);
  assert.deepEqual((await api.get(`/custom/values/product/${p.id}?shop_id=${pt.id}`)).body.data.ngu_hanh, ['Thổ', 'Kim']);
  // Đổi ngành lần nữa không tạo trùng
  await api.patch(`/shops/${pt.id}`, { industry: 'phong_thuy' });
  assert.equal((await api.get(`/custom/fields?entity_type=product&shop_id=${pt.id}`)).body.data.length, 1);
  // Hai shop phong thuỷ: mỗi shop một trường cùng khoá, giá trị không lẫn
  await api.patch(`/shops/${nh.id}`, { industry: 'phong_thuy' });
  await api.put(`/custom/values/product/${p.id}?shop_id=${nh.id}`, { ngu_hanh: ['Mộc'] });
  assert.deepEqual((await api.get(`/custom/values/product/${p.id}?shop_id=${nh.id}`)).body.data.ngu_hanh, ['Mộc']);
  assert.deepEqual((await api.get(`/custom/values/product/${p.id}?shop_id=${pt.id}`)).body.data.ngu_hanh, ['Thổ', 'Kim']);
});

test('Migration 021: shop phong thuỷ có sẵn được tạo trường Ngũ hành hợp và chép products.elements cho sản phẩm niêm yết ở shop đó', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { openDb, migrate, MIGRATIONS_DIR } = await import('../server/db/index.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files.filter((x) => x < '021')) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(tmp, f));
  const conn = openDb(':memory:', tmp);
  const at = 'x';
  conn.prepare("INSERT INTO warehouses (id, code, name, created_at, updated_at) VALUES ('w','K','K',?,?)").run(at, at);
  conn.prepare("INSERT INTO shops (id, code, name, industry, default_warehouse_id, created_at, updated_at) VALUES ('s1','PT','PT','phong_thuy','w',?,?), ('s2','NH','NH','general','w',?,?)").run(at, at, at, at);
  conn.prepare("INSERT INTO products (id, name, elements, created_at, updated_at) VALUES ('p1','Tỳ hưu','[\"Thổ\",\"Kim\"]',?,?), ('p2','Không niêm yết','[\"Mộc\"]',?,?), ('p3','Ở shop khác','[\"Hoả\"]',?,?)").run(at, at, at, at, at, at);
  conn.prepare("INSERT INTO variants (id, product_id, sku, created_at, updated_at) VALUES ('v1','p1','S1',?,?), ('v2','p2','S2',?,?), ('v3','p3','S3',?,?)").run(at, at, at, at, at, at);
  conn.prepare("INSERT INTO shop_listings (id, shop_id, variant_id, price, created_at, updated_at) VALUES ('l1','s1','v1',1,?,?), ('l3','s2','v3',1,?,?)").run(at, at, at, at);
  fs.copyFileSync(path.join(MIGRATIONS_DIR, files.find((x) => x.startsWith('021'))), path.join(tmp, '021_product_options.sql'));
  migrate(conn, tmp);
  const fields = conn.prepare("SELECT shop_id, key, role FROM custom_fields WHERE entity_type = 'product'").all();
  assert.deepEqual(fields, [{ shop_id: 's1', key: 'ngu_hanh', role: 'element' }]);
  const vals = conn.prepare("SELECT entity_id, value_text FROM custom_values WHERE entity_type = 'product'").all();
  assert.deepEqual(vals, [{ entity_id: 'p1', value_text: '["Thổ","Kim"]' }]);
  assert.equal(conn.prepare("SELECT elements FROM products WHERE id = 'p1'").get().elements, '["Thổ","Kim"]', 'giữ cột cũ');
  conn.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('Chuyển sản phẩm một biến thể sang ma trận: biến thể cũ giữ id, SKU, tồn, lịch sử, giá; chỉ thêm option_values và tên tự đặt', async () => {
  const { api, nh } = await setup();
  const p = (await api.post('/products', { name: 'Tinh dầu', variants: [{ sku: 'TD-1', default_price: 99000, opening_qty: 8, opening_cost: 30000 }], shop_ids: [nh.id] })).body.data;
  const old = p.variants[0];
  assert.equal((await api.post('/orders', { shop_id: nh.id, lines: [{ sku: 'TD-1', qty: 2 }], status: 'completed' })).status, 201);
  const opts = [{ name: 'Mùi', values: ['Cam', 'Chanh'] }];
  const r = await api.patch(`/products/${p.id}`, {
    options: opts,
    variants: [
      { id: old.id, option_values: { Mùi: 'Chanh' } },
      { sku: 'TD-CAM', option_values: { Mùi: 'Cam' }, default_price: 99000, opening_qty: 4, opening_cost: 30000 },
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const v = r.body.data.variants;
  const kept = v.find((x) => x.id === old.id);
  assert.equal(kept.sku, 'TD-1');
  assert.deepEqual(kept.option_values, { Mùi: 'Chanh' });
  assert.equal(kept.name, 'Chanh');
  assert.equal(kept.default_price, 99000);
  assert.equal(kept.on_hand_total, 6, 'tồn sau khi bán 2 giữ nguyên');
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM stock_movements WHERE variant_id = ?').get(old.id).n, 2, 'lịch sử kho còn nguyên');
  assert.equal(v.find((x) => x.sku === 'TD-CAM').on_hand_total, 4);
  // Hai biến thể cùng một tổ hợp bị từ chối, không đổi gì
  const dup = await api.patch(`/products/${p.id}`, { variants: [{ id: old.id, option_values: { Mùi: 'Cam' } }] });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'OPTIONS_CONFLICT');
  assert.deepEqual((await api.get(`/products/${p.id}`)).body.data.variants.find((x) => x.id === old.id).option_values, { Mùi: 'Chanh' }, 'giao dịch huỷ trọn gói');
});

test('Thêm thuộc tính mới vào sản phẩm đã có ma trận: biến thể cũ nhận giá trị đầu, giữ id; thiếu giá trị thì 400', async () => {
  const { api, nh } = await setup();
  const p = (await api.post('/products', { name: 'T', options: [{ name: 'Mùi', values: ['Cam', 'Chanh'] }], variants: [{ sku: 'T-CAM', option_values: { Mùi: 'Cam' } }, { sku: 'T-CHANH', option_values: { Mùi: 'Chanh' } }], shop_ids: [nh.id] })).body.data;
  const [cam, chanh] = p.variants;
  const newOpts = [{ name: 'Mùi', values: ['Cam', 'Chanh'] }, { name: 'Size', values: ['10ml', '30ml'] }];
  const missing = await api.patch(`/products/${p.id}`, { options: newOpts });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, 'OPTION_INCOMPLETE');
  const ok = await api.patch(`/products/${p.id}`, {
    options: newOpts,
    variants: [
      { id: cam.id, option_values: { Mùi: 'Cam', Size: '10ml' } },
      { id: chanh.id, option_values: { Mùi: 'Chanh', Size: '10ml' } },
      { sku: 'T-CAM-30', option_values: { Mùi: 'Cam', Size: '30ml' } },
      { sku: 'T-CHANH-30', option_values: { Mùi: 'Chanh', Size: '30ml' } },
    ],
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const v = ok.body.data.variants;
  assert.equal(v.length, 4);
  assert.deepEqual(v.find((x) => x.id === cam.id).option_values, { Mùi: 'Cam', Size: '10ml' });
  assert.equal(v.find((x) => x.id === cam.id).name, 'Cam / 10ml', 'tên tự đặt theo giá trị mới');
});

test('Đổi nhãn thuộc tính và giá trị: cập nhật mọi biến thể (kể cả đã lưu trữ), giữ id, tên tự đặt theo nhãn mới', async () => {
  const { api, nh } = await setup();
  const p = (await api.post('/products', { name: 'T', options, variants: rows({ opening_qty: undefined }), shop_ids: [nh.id] })).body.data;
  const ids = p.variants.map((v) => v.id);
  await api.patch(`/products/${p.id}`, { variants: [{ id: ids[3], active: false }] }); // một biến thể đã tắt, không nằm trong lần gửi sau
  const r = await api.patch(`/products/${p.id}`, {
    options: [{ name: 'Hương', values: ['Cam ngọt', 'Chanh'] }, { name: 'Size', values: ['10ml', '30ml'] }],
    option_renames: [{ from: 'Mùi', to: 'Hương', values: { Cam: 'Cam ngọt' } }],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const v = r.body.data.variants;
  assert.deepEqual(v.map((x) => x.id), ids, 'giữ id và thứ tự');
  assert.deepEqual(v[0].option_values, { Hương: 'Cam ngọt', Size: '10ml' });
  assert.equal(v[0].name, 'Cam ngọt / 10ml');
  assert.deepEqual(v[3].option_values, { Hương: 'Chanh', Size: '30ml' }, 'biến thể đã tắt cũng được đổi nhãn');
  assert.equal(v[0].sku, p.variants[0].sku, 'SKU không đổi');
});

test('Xoá hẳn một thuộc tính: được nếu các biến thể còn lại vẫn khác nhau; trùng thì 409 OPTIONS_CONFLICT và không đổi gì', async () => {
  const { api, nh } = await setup();
  const p = (await api.post('/products', { name: 'T', options, variants: rows({ opening_qty: undefined }), shop_ids: [nh.id] })).body.data;
  const conflict = await api.patch(`/products/${p.id}`, { options: [options[0]] });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'OPTIONS_CONFLICT');
  assert.deepEqual((await api.get(`/products/${p.id}`)).body.data.options, options, 'không đổi gì khi bị từ chối');
  // Bỏ bớt các biến thể Size 30ml trước thì xoá thuộc tính Size được
  const ids = p.variants.map((v) => v.id);
  const ok = await api.patch(`/products/${p.id}`, {
    options: [options[0]],
    variants: [
      { id: ids[0], option_values: { Mùi: 'Cam' } },
      { id: ids[1], remove: true },
      { id: ids[2], option_values: { Mùi: 'Chanh' } },
      { id: ids[3], remove: true },
    ],
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.data.variants.map((x) => x.option_values), [{ Mùi: 'Cam' }, { Mùi: 'Chanh' }]);
});

test('Sản phẩm cũ nhiều biến thể không thuộc tính: gán từng biến thể vào một tổ hợp', async () => {
  const { api, nh } = await setup();
  const p = (await api.post('/products', { name: 'Cũ', variants: [{ sku: 'C1', name: 'Bản đặc biệt' }, { sku: 'C2' }], shop_ids: [nh.id] })).body.data;
  const r = await api.patch(`/products/${p.id}`, { options: [{ name: 'Loại', values: ['A', 'B'] }], variants: [{ id: p.variants[0].id, option_values: { Loại: 'A' } }, { id: p.variants[1].id, option_values: { Loại: 'B' } }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.data.variants.map((v) => v.name), ['Bản đặc biệt', 'B'], 'tên đặt tay giữ nguyên, tên trống thành tên tự đặt');
});

test('Xem trước bỏ biến thể: có lịch sử thì lưu trữ, chưa dùng thì xoá hẳn; không ghi gì', async () => {
  const { api, nh, wh } = await setup();
  const p = (await api.post('/products', { name: 'Xem trước', variants: [{ sku: 'XT-1', default_price: 1000, opening_qty: 5, opening_cost: 100 }, { sku: 'XT-2', default_price: 1000 }], shop_ids: [nh.id], opening_warehouse_id: wh.id })).body.data;
  const [a, b] = p.variants;
  const r = await api.post(`/products/${p.id}/removal-preview`, { variant_ids: [a.id, b.id, 'var_khong_co'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.data.map((x) => [x.sku, x.outcome]), [['XT-1', 'archived'], ['XT-2', 'deleted']]);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM variants WHERE product_id = ?').get(p.id).n, 2, 'chưa xoá gì');
});
