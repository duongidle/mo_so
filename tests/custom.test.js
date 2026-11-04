import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { calc } from '../server/lib/formula.js';

test('M10: bộ tính công thức — đúng, an toàn, không văng lỗi khi chia 0', () => {
  const ctx = { a: 1000, b: 600, z: 0, d: '2026-11-01', 'custom.pack': 50 };
  assert.equal(calc('{a} - {b} - {custom.pack}', ctx), 350);
  assert.equal(calc('2 + 3 * 4', ctx), 14);
  assert.equal(calc('(2 + 3) * 4', ctx), 20);
  assert.equal(calc('{a} / {z}', ctx), null);
  assert.equal(calc('{khong_co} + 1', ctx), null, 'thiếu giá trị → null, không phải 1');
  assert.equal(calc('IF({a} > 500, "cao", "thấp")', ctx), 'cao');
  assert.equal(calc('ROUND(10 / 3, 2)', ctx), 3.33);
  assert.equal(calc('MAX(1, {a}, 3) - MIN(5, 2)', ctx), 998);
  assert.equal(calc('ABS(-7)', ctx), 7);
  assert.equal(calc('DAYS_BETWEEN("2026-11-01", "2026-11-11")', ctx), 10);
  for (const evil of ['process.exit()', 'constructor', '{a}.__proto__', 'a=1;b', '1 +', 'IF(1,2)', 'FOO(1)', '`x`']) {
    assert.throws(() => calc(evil, ctx), undefined, `phải chặn: ${evil}`);
  }
});

test('M10: trường tuỳ chỉnh, công thức trên đơn, chỉ số báo cáo tuỳ chỉnh', async () => {
  const { api, nh, pt, wh } = await setup();
  const p = (await api.post('/products', { name: 'Nước hoa', variants: [{ sku: 'NH-1', default_price: 150000 }], shop_ids: [nh.id, pt.id] })).body.data;
  await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: p.variants[0].id, qty: 10, unit_cost: 50000 }] });
  const o = (await api.post('/orders', { shop_id: nh.id, lines: [{ sku: 'NH-1', qty: 2 }], status: 'completed' })).body.data;

  const mk = (b) => api.post('/custom/fields', b);
  const pack = await mk({ entity_type: 'order', key: 'phi_dong_goi', label: 'Phí đóng gói', type: 'money' });
  assert.equal(pack.status, 201);
  assert.equal((await mk({ entity_type: 'order', key: 'phi_dong_goi', label: 'Trùng', type: 'money' })).status, 409, 'khoá trùng');
  assert.equal((await mk({ entity_type: 'order', key: 'status', label: 'x', type: 'text' })).status, 400, 'không trùng tên cột có sẵn');
  assert.equal((await mk({ entity_type: 'order', key: 'Sai Khoa', label: 'x', type: 'text' })).status, 400);
  assert.equal((await mk({ entity_type: 'order', key: 'loai_goi', label: 'Loại gói', type: 'select' })).status, 400, 'select cần lựa chọn');
  await mk({ entity_type: 'order', key: 'loai_goi', label: 'Loại gói', type: 'select', options: ['Thường', 'Quà'] });

  // Công thức: LN sau đóng gói = tổng − giá vốn − phí đóng gói
  assert.equal((await mk({ entity_type: 'order', key: 'ln', label: 'LN', type: 'formula', formula: '{total_amount} - {cogs_amount} - {custom.khong_co}' })).status, 400);
  assert.equal((await mk({ entity_type: 'order', key: 'ln', label: 'LN', type: 'formula', formula: '{cot_la} + 1' })).status, 400);
  const ln = await mk({ entity_type: 'order', key: 'ln', label: 'LN sau đóng gói', type: 'formula', formula: '{total_amount} - {cogs_amount} - {custom.phi_dong_goi}' });
  assert.equal(ln.status, 201, JSON.stringify(ln.body));

  // Vòng lặp bị chặn
  const a = await mk({ entity_type: 'order', key: 'va', label: 'A', type: 'formula', formula: '{custom.ln} + 1' });
  assert.equal(a.status, 201);
  const cyc = await api.patch(`/custom/fields/${ln.body.data.id}`, { formula: '{custom.va} + 1' });
  assert.equal(cyc.status, 400);
  assert.equal(cyc.body.error.code, 'FORMULA_CYCLE');

  // Chưa nhập phí đóng gói → công thức null (không tự coi là 0)
  assert.equal((await api.get(`/custom/values/order/${o.id}`)).body.data.ln, null);
  const set = await api.put(`/custom/values/order/${o.id}`, { phi_dong_goi: 12000, loai_goi: 'Quà' });
  assert.equal(set.status, 200);
  assert.equal(set.body.data.ln, 300000 - 100000 - 12000);
  assert.equal(set.body.data.va, set.body.data.ln + 1, 'công thức dùng công thức khác');
  assert.equal((await api.put(`/custom/values/order/${o.id}`, { loai_goi: 'Lạ' })).status, 400);
  assert.equal((await api.put(`/custom/values/order/${o.id}`, { phi_dong_goi: 1.5 })).status, 400, 'tiền phải nguyên');
  assert.equal((await api.put(`/custom/values/order/${o.id}`, { ln: 5 })).status, 400, 'công thức không nhập tay');
  assert.equal((await api.put(`/custom/values/order/${o.id}`, { khong_co: 5 })).status, 400);
  assert.equal((await api.put(`/custom/values/order/${o.id}`, { phi_dong_goi: null })).body.data.ln, null, 'xoá giá trị');

  // Trường riêng của shop PT không hiện ở NH
  await mk({ entity_type: 'order', key: 'rieng_pt', label: 'Riêng PT', type: 'text', shop_id: pt.id });
  const keys = async (shop) => (await api.get(`/custom/fields?entity_type=order&shop_id=${shop}`)).body.data.map((f) => f.key);
  assert.ok(!(await keys(nh.id)).includes('rieng_pt'));
  assert.ok((await keys(pt.id)).includes('rieng_pt'));

  // Chỉ số báo cáo tuỳ chỉnh: doanh thu thuần / số đơn; chỉ số riêng shop PT không hiện khi lọc NH
  assert.equal((await api.post('/custom/metrics', { key: 'bad', name: 'x', formula: '{a} +' })).status, 400);
  await api.post('/custom/metrics', { key: 'dt_don', name: 'Doanh thu / đơn', formula: '{net_revenue} / {order_count}', format: 'money' });
  await api.post('/custom/metrics', { key: 'chi_pt', name: 'Chỉ PT', formula: '{order_count}', shop_id: pt.id });
  await api.post('/custom/metrics', { key: 'loi', name: 'Chia 0', formula: '{net_revenue} / ({order_count} - 1)' });
  const m = (await api.get(`/reports/custom-metrics?shop_id=${nh.id}`)).body.data;
  assert.equal(m.find((x) => x.key === 'dt_don').value, 300000);
  assert.ok(!m.some((x) => x.key === 'chi_pt'));
  assert.equal(m.find((x) => x.key === 'loi').value, null, 'chia 0 → null');
});

// ---------- Phase 6: biến, gợi ý, xem trước, vai trò, bắt buộc ----------
test('Hàm mới CONCAT/YEAR/MONTH/COALESCE và lỗi cú pháp có vị trí', () => {
  const ctx = { ten: 'An', ho: null, d: '2026-11-04', x: null };
  assert.equal(calc('CONCAT({ten}, " ", {ho}, "!")', ctx), 'An !', 'CONCAT coi null là chuỗi rỗng');
  assert.equal(calc('YEAR({d})', ctx), 2026);
  assert.equal(calc('MONTH({d})', ctx), 11);
  assert.equal(calc('YEAR({x})', ctx), null);
  assert.equal(calc('YEAR("không phải ngày")', ctx), null);
  assert.equal(calc('COALESCE({x}, {ho}, 7, 9)', ctx), 7);
  assert.equal(calc('COALESCE({x}, {ho})', ctx), null);
  assert.equal(calc('YEAR(TODAY()) - 1990 > 0', ctx), 1);
  const pos = (src) => { try { calc(src, {}); } catch (e) { return e.position; } return 'không lỗi'; };
  assert.equal(pos('1 + FOO(2)'), 4, 'hàm lạ: vị trí tên hàm');
  assert.equal(pos('1 + $'), 4);
  assert.equal(pos('1 +'), 3, 'thiếu vế phải: cuối công thức');
  assert.equal(pos('(1 + 2'), 6);
  assert.equal(pos('1 2'), 2, 'thừa token');
  assert.equal(pos('IF(1,2)'), 0);
});

test('Danh mục biến: có nhãn, bỏ cột kỹ thuật/cột khách cũ, gồm trường tuỳ chỉnh, biến dẫn xuất theo shop', async () => {
  const { api, nh, pt, wh } = await setup();
  const p = (await api.post('/products', { name: 'Nước hoa', variants: [{ sku: 'NH-1', default_price: 100000 }], shop_ids: [nh.id, pt.id] })).body.data;
  await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: p.variants[0].id, qty: 20, unit_cost: 10000 }] });
  const cus = (await api.post('/customers', { name: 'Khách V', phone: '0911555001', shop_id: nh.id })).body.data;
  await api.post('/orders', { shop_id: nh.id, customer_id: cus.id, lines: [{ sku: 'NH-1', qty: 2 }], status: 'completed' });
  await api.post('/orders', { shop_id: nh.id, customer_id: cus.id, lines: [{ sku: 'NH-1', qty: 1 }], status: 'completed' });
  await api.post('/orders', { shop_id: pt.id, customer_id: cus.id, lines: [{ sku: 'NH-1', qty: 5 }], status: 'completed' });
  await api.post('/custom/fields', { entity_type: 'customer', shop_id: nh.id, key: 'nam_sinh', label: 'Năm sinh', type: 'number' });
  await api.post('/custom/fields', { entity_type: 'customer', shop_id: pt.id, key: 'chi_o_pt', label: 'Chỉ ở PT', type: 'number' });

  const vars = (await api.get(`/custom/variables?entity_type=customer&shop_id=${nh.id}`)).body.data;
  const keys = vars.map((v) => v.key);
  for (const bad of ['id', 'birth_date', 'birth_year', 'element_override', 'gender', 'tags', 'created_at', 'updated_at', 'merged_into', 'archived_at']) assert.ok(!keys.includes(bad), `không có ${bad}`);
  for (const good of ['name', 'phone', 'total_spent', 'shop_order_count', 'shop_total_spent', 'shop_last_order_at', 'custom.nam_sinh']) assert.ok(keys.includes(good), `có ${good}`);
  assert.ok(!keys.includes('custom.chi_o_pt'), 'trường của shop khác không lọt sang');
  const v = vars.find((x) => x.key === 'shop_order_count');
  assert.equal(v.ref, '{shop_order_count}');
  assert.ok(v.label && v.type === 'number' && v.group);
  assert.equal((await api.get('/custom/variables?entity_type=customer')).status, 400, 'khách cần shop');

  const orderKeys = (await api.get('/custom/variables?entity_type=order')).body.data.map((x) => x.key);
  assert.ok(orderKeys.includes('net_amount') && orderKeys.includes('cogs_amount'));
  for (const bad of ['id', 'customer_id', 'shop_id', 'created_at', 'tags', 'internal_note']) assert.ok(!orderKeys.includes(bad), `đơn không có ${bad}`);

  // Biến dẫn xuất tính đúng theo từng shop
  const f1 = await api.post('/custom/fields', { entity_type: 'customer', shop_id: nh.id, key: 'so_don_nh', label: 'Số đơn NH', type: 'formula', formula: '{shop_order_count}' });
  assert.equal(f1.status, 201, JSON.stringify(f1.body));
  await api.post('/custom/fields', { entity_type: 'customer', shop_id: nh.id, key: 'chi_nh', label: 'Chi NH', type: 'formula', formula: '{shop_total_spent}' });
  await api.post('/custom/fields', { entity_type: 'customer', shop_id: pt.id, key: 'so_don_pt', label: 'Số đơn PT', type: 'formula', formula: '{shop_order_count} * 10' });
  const a = (await api.get(`/custom/values/customer/${cus.id}?shop_id=${nh.id}`)).body.data;
  const b = (await api.get(`/custom/values/customer/${cus.id}?shop_id=${pt.id}`)).body.data;
  assert.equal(a.so_don_nh, 2);
  assert.equal(a.chi_nh, 300000);
  assert.equal(b.so_don_pt, 10);
  assert.equal(a.so_don_pt, undefined);
});

test('Công thức tham chiếu biến lạ bị chặn kèm vị trí', async () => {
  const { api } = await setup();
  const mk = (b) => api.post('/custom/fields', { entity_type: 'order', key: 'f', label: 'F', type: 'formula', ...b });
  const bad = await mk({ formula: '{net_amount} + {tags_json}' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'INVALID_FORMULA');
  assert.match(bad.body.error.message, /tags_json/);
  assert.equal(bad.body.error.details.position, 15);
  const technical = await mk({ formula: '{customer_id}' });
  assert.equal(technical.status, 400, 'cột kỹ thuật không dùng được');
  const syntax = await mk({ formula: '{net_amount} +' });
  assert.equal(syntax.body.error.details.position, 14);
  const ok = await mk({ formula: 'CONCAT({code}, "-", {status})' });
  assert.equal(ok.status, 201);
});

test('Xem trước công thức: trường (bản ghi mẫu gần nhất/chỉ định), chỉ số báo cáo, lỗi có vị trí', async () => {
  const { api, nh, pt, wh } = await setup();
  const p = (await api.post('/products', { name: 'Nước hoa', variants: [{ sku: 'NH-1', default_price: 100000 }], shop_ids: [nh.id, pt.id] })).body.data;
  await api.post('/purchases', { warehouse_id: wh.id, receive: true, lines: [{ variant_id: p.variants[0].id, qty: 20, unit_cost: 40000 }] });
  const o1 = (await api.post('/orders', { shop_id: nh.id, lines: [{ sku: 'NH-1', qty: 1 }], status: 'completed' })).body.data;
  const o2 = (await api.post('/orders', { shop_id: nh.id, lines: [{ sku: 'NH-1', qty: 3 }], status: 'completed' })).body.data;
  const pv = (b) => api.post('/custom/formula/preview', b);

  const latest = (await pv({ entity_type: 'order', shop_id: nh.id, formula: '{net_amount} - {cogs_amount}' })).body.data;
  assert.equal(latest.value, 300000 - 120000);
  assert.equal(latest.sample.id, o2.id);
  const chosen = (await pv({ entity_type: 'order', formula: '{net_amount} - {cogs_amount}', entity_id: o1.id })).body.data;
  assert.equal(chosen.value, 60000);
  assert.equal(chosen.sample.label, o1.code);
  assert.equal((await pv({ entity_type: 'order', shop_id: pt.id, formula: '{net_amount}' })).body.data.sample, null, 'shop chưa có đơn: không có mẫu');

  const err = (await pv({ entity_type: 'order', formula: '{net_amount} + {khong_co}' })).body.data;
  assert.equal(err.error.position, 15);
  assert.match(err.error.message, /khong_co/);
  assert.equal((await pv({ entity_type: 'order', formula: '1 +' })).body.data.error.position, 3);

  // Trường công thức dùng trường tuỳ chỉnh chưa nhập: null, không văng lỗi
  await api.post('/custom/fields', { entity_type: 'order', key: 'phi', label: 'Phí', type: 'money' });
  assert.equal((await pv({ entity_type: 'order', formula: '{net_amount} - {custom.phi}' })).body.data.value, null);
  assert.equal((await pv({ entity_type: 'order', formula: '{net_amount} - COALESCE({custom.phi}, 0)' })).body.data.value, 300000);

  // Chỉ số báo cáo: tính trên tháng này của shop
  const m = (await pv({ entity_type: 'metric', shop_id: nh.id, formula: '{net_revenue} / {order_count}' })).body.data;
  assert.equal(m.value, 200000);
  assert.equal((await pv({ entity_type: 'metric', formula: '{net_revenue} / {order_count} + {rac}' })).body.data.error.position, 32);

  // Khách cần shop
  const c = (await pv({ entity_type: 'customer', formula: '{name}' })).body;
  assert.equal(c.error.code, 'SHOP_REQUIRED');
});

test('Chỉ số báo cáo: biến lạ bị chặn kèm vị trí, danh mục biến có nhãn', async () => {
  const { api } = await setup();
  const bad = await api.post('/custom/metrics', { key: 'x', name: 'x', formula: '{net_revenue} / {khong_co}' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.details.position, 16);
  assert.match(bad.body.error.message, /khong_co/);
  const vars = (await api.get('/custom/metric-variables')).body.data;
  assert.ok(vars.every((v) => v.ref && v.label && v.type && v.group));
  for (const k of ['net_revenue', 'order_count', 'cogs', 'expenses_amount', 'gross_margin_pct']) assert.ok(vars.some((v) => v.key === k), k);
  assert.equal((await api.post('/custom/metrics', { key: 'ok1', name: 'ok', formula: '{gross_profit} - {expenses_amount}' })).status, 201);
  const fns = (await api.get('/custom/functions')).body.data;
  assert.ok(['CONCAT', 'YEAR', 'MONTH', 'COALESCE', 'IF'].every((n) => fns.some((f) => f.name === n && f.signature && f.example)));
});

test('Vai trò của trường: đúng đối tượng, đúng kiểu, mỗi shop một trường mỗi vai trò, sửa được', async () => {
  const { api, nh } = await setup();
  const mk = (b) => api.post('/custom/fields', { entity_type: 'customer', shop_id: nh.id, ...b });
  const ok = await mk({ key: 'ns', label: 'Ngày sinh', type: 'date', role: 'birth_date' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.data.role, 'birth_date', 'role không bị bỏ khi tạo');
  assert.equal((await mk({ key: 'ns2', label: 'Ngày sinh 2', type: 'date', role: 'birth_date' })).body.error.code, 'DUPLICATE_ROLE');
  assert.equal((await mk({ key: 'ns3', label: 'Sai kiểu', type: 'text', role: 'birth_year' })).body.error.code, 'ROLE_TYPE');
  assert.equal((await mk({ key: 'xx', label: 'Lạ', type: 'text', role: 'bay_bong' })).body.error.code, 'INVALID_ROLE');
  const wrongEntity = await api.post('/custom/fields', { entity_type: 'order', key: 'r', label: 'R', type: 'date', role: 'birth_date' });
  assert.equal(wrongEntity.body.error.code, 'ROLE_NOT_ALLOWED');
  const other = await mk({ key: 'ny', label: 'Năm sinh', type: 'number' });
  assert.equal((await api.patch(`/custom/fields/${other.body.data.id}`, { role: 'birth_year' })).body.data.role, 'birth_year');
  assert.equal((await api.patch(`/custom/fields/${other.body.data.id}`, { role: null })).body.data.role, null, 'gỡ vai trò');
  assert.equal((await api.patch(`/custom/fields/${other.body.data.id}`, { role: 'birth_date' })).body.error.code, 'ROLE_TYPE');
  // Sản phẩm: chỉ vai trò element
  const pe = await api.post('/custom/fields', { entity_type: 'product', key: 'hanh', label: 'Hành', type: 'multiselect', options: ['Kim', 'Mộc'], role: 'element' });
  assert.equal(pe.status, 201);
});

test('Sửa trường: lựa chọn, thứ tự, bắt buộc (có hiệu lực khi lưu giá trị)', async () => {
  const { api, nh } = await setup();
  const sel = (await api.post('/custom/fields', { entity_type: 'customer', shop_id: nh.id, key: 'dip', label: 'Dịp', type: 'select', options: ['A', 'B'] })).body.data;
  const txt = (await api.post('/custom/fields', { entity_type: 'customer', shop_id: nh.id, key: 'ghi', label: 'Ghi chú riêng', type: 'text' })).body.data;
  const upd = await api.patch(`/custom/fields/${sel.id}`, { options: ['A', 'B', 'C'], required: true, sort_order: 5 });
  assert.deepEqual(upd.body.data.options, ['A', 'B', 'C']);
  assert.equal(upd.body.data.required, true);
  assert.equal(upd.body.data.sort_order, 5);
  assert.equal((await api.patch(`/custom/fields/${txt.id}`, { options: ['x'] })).body.error.code, 'NOT_SELECT');
  assert.equal((await api.patch(`/custom/fields/${sel.id}`, { label: 'Dịp mua' })).body.data.required, true, 'PATCH một ô không đụng ô khác (patchOf)');
  const f = await api.post('/custom/fields', { entity_type: 'customer', shop_id: nh.id, key: 'cth', label: 'CT', type: 'formula', formula: '{order_count}', required: true });
  assert.equal(f.body.error.code, 'REQUIRED_FORMULA');

  const cus = (await api.post('/customers', { name: 'Khách R', phone: '0911555002', shop_id: nh.id })).body.data;
  const miss = await api.put(`/custom/values/customer/${cus.id}?shop_id=${nh.id}`, { ghi: 'abc' });
  assert.equal(miss.status, 400);
  assert.equal(miss.body.error.code, 'REQUIRED_FIELD');
  assert.deepEqual(miss.body.error.details.fields, ['dip']);
  assert.equal((await api.put(`/custom/values/customer/${cus.id}?shop_id=${nh.id}`, { dip: 'C' })).status, 200);
  const clear = await api.put(`/custom/values/customer/${cus.id}?shop_id=${nh.id}`, { dip: null });
  assert.equal(clear.body.error.code, 'REQUIRED_FIELD', 'xoá giá trị trường bắt buộc không được');
  await api.patch(`/custom/fields/${sel.id}`, { required: false });
  assert.equal((await api.put(`/custom/values/customer/${cus.id}?shop_id=${nh.id}`, { dip: null })).status, 200);
});
